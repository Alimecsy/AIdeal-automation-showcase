import { PrismaClient } from "@aideal/db";
import type { Prisma } from "@aideal/db";
import { env } from "@aideal/env";
import type { AiJobPayload, DocumentExtractionJobPayload, IntakeFinalizationJobPayload, ResearchJobPayload, SopEvaluationJobPayload } from "@aideal/shared";
import { randomUUID } from "node:crypto";
import { generateText } from "./ai-adapter";
import { extractDocument, readDocument, writeExtractedText } from "./document-extraction";
import { evaluateSop, toEvaluationJson } from "./sop-evaluation";
import { assignResearchSourceIds, collectResearch, synthesizeResearch } from "./research";
import { UsageRecorder } from "./usage";
import { publishWorkerNotification, workerNotificationEventId } from "./notifications";
import { InternalApiDealTransitions, type DealTransitions } from "./deal-transitions";

export const RETRY_BASE_DELAY_MS = 1_000;
export const RETRY_MAX_DELAY_MS = 30_000;
export const JOB_LEASE_MS = 5 * 60_000;
export const JOB_HEARTBEAT_MS = Math.floor(JOB_LEASE_MS / 3);

type JobRecord = NonNullable<Awaited<ReturnType<PrismaClient["job"]["findUnique"]>>>;
type DatabaseClient = PrismaClient | Prisma.TransactionClient;
type LeaseClaim = Pick<JobRecord, "id" | "organizationId" | "type" | "attempts" | "leaseToken">;

type SopEvaluationJobSnapshot = Pick<JobRecord, "id" | "status" | "createdAt" | "payloadJson">;

export function hasNewerActiveSopEvaluation(
  currentJob: SopEvaluationJobSnapshot,
  candidates: SopEvaluationJobSnapshot[],
) {
  const currentPayload = currentJob.payloadJson;
  const currentDealId = currentPayload && typeof currentPayload === "object" && !Array.isArray(currentPayload)
    ? (currentPayload as Record<string, unknown>).dealId
    : null;
  if (typeof currentDealId !== "string") return false;

  return candidates.some((candidate) => {
    if (candidate.id === currentJob.id || !["queued", "running", "completed"].includes(candidate.status)) return false;
    const payload = candidate.payloadJson;
    const dealId = payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).dealId
      : null;
    if (dealId !== currentDealId) return false;

    const candidateTime = candidate.createdAt.getTime();
    const currentTime = currentJob.createdAt.getTime();
    return candidateTime > currentTime || (candidateTime === currentTime && candidate.id > currentJob.id);
  });
}

export function retryDelayMs(attempt: number) {
  return Math.min(
    RETRY_MAX_DELAY_MS,
    RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1),
  );
}

function jobTelemetry(event: string, job: Pick<JobRecord, "id" | "organizationId" | "type" | "attempts">, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    event,
    jobId: job.id,
    organizationId: job.organizationId,
    jobType: job.type,
    attempts: job.attempts,
    ...details,
  }));
}

/** Renews only the matching active lease, so a stale worker cannot prolong new work. */
export async function renewJobLease(prisma: PrismaClient, claim: LeaseClaim) {
  if (!claim.leaseToken) return false;
  const result = await prisma.job.updateMany({
    where: { id: claim.id, status: "running", leaseToken: claim.leaseToken },
    data: { leaseExpiresAt: new Date(Date.now() + JOB_LEASE_MS) },
  });
  if (result.count === 0) {
    jobTelemetry("job.stale_lease_write_rejected", claim, { operation: "heartbeat" });
    return false;
  }
  jobTelemetry("job.heartbeat", claim, { leaseTokenPrefix: claim.leaseToken.slice(0, 8) });
  return true;
}

function asExtractionPayload(value: unknown): DocumentExtractionJobPayload {
  if (!value || typeof value !== "object") throw new Error("Document extraction job payload is missing");
  const payload = value as Record<string, unknown>;
  if (typeof payload.documentId !== "string" || typeof payload.extractionId !== "string") {
    throw new Error("Document extraction job payload is invalid");
  }
  return { documentId: payload.documentId, extractionId: payload.extractionId };
}

function asAiPayload(value: unknown): AiJobPayload {
  if (!value || typeof value !== "object") throw new Error("AI job payload is missing");
  const payload = value as Record<string, unknown>;
  if (typeof payload.aiRunId !== "string" || typeof payload.prompt !== "string") {
    throw new Error("AI job payload is invalid");
  }
  return { aiRunId: payload.aiRunId, prompt: payload.prompt };
}

function asResearchPayload(value: unknown): ResearchJobPayload {
  if (!value || typeof value !== "object") throw new Error("Research job payload is missing");
  const payload = value as Record<string, unknown>;
  if (typeof payload.researchReportId !== "string" || typeof payload.dealId !== "string") {
    throw new Error("Research job payload is invalid");
  }
  return { researchReportId: payload.researchReportId, dealId: payload.dealId };
}

function asSopEvaluationPayload(value: unknown): SopEvaluationJobPayload {
  if (!value || typeof value !== "object") throw new Error("SOP evaluation job payload is missing");
  const payload = value as Record<string, unknown>;
  if (typeof payload.dealId !== "string") throw new Error("SOP evaluation job payload is invalid");
  return { dealId: payload.dealId };
}

function asIntakeFinalizationPayload(value: unknown): IntakeFinalizationJobPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Intake finalization payload is missing");
  const submissionId = (value as Record<string, unknown>).submissionId;
  if (typeof submissionId !== "string" || !submissionId) throw new Error("Intake finalization payload is invalid");
  return { submissionId };
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;
}

function intakeTitle(answers: Record<string, unknown>, fallbackEmail: string) {
  return firstString(answers.legalName, answers.companyName, answers.projectName, answers.requestTitle, answers.requestType) ?? fallbackEmail;
}

function parseStructuredOutput(text: string) {
  const normalized = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(normalized) as Record<string, unknown>;
  } catch {
    return { rawText: text };
  }
}

async function evaluateDealSop(prisma: DatabaseClient, dealId: string) {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      organizationId: true,
      company: { select: { legalName: true } },
      intakeSubmission: {
        select: {
          rawAnswersJson: true,
          intakeForm: {
            select: {
              sopTemplate: {
                select: {
                  id: true,
                  status: true,
                  scoringWeightsJson: true,
                  mandatoryRulesJson: true,
                  redFlagRulesJson: true,
                  recommendationRulesJson: true,
                },
              },
            },
          },
        },
      },
      documents: { select: { documentType: true, status: true } },
      researchReports: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, confidence: true, redFlagsJson: true },
      },
    },
  });
  const template = deal?.intakeSubmission?.intakeForm.sopTemplate;
  if (!deal || !template || template.status !== "active") return null;

  const researchReport = deal.researchReports[0];
  let confirmedRedFlagEvidence = false;
  let followUpEvidence = false;
  if (researchReport?.id && Array.isArray(researchReport.redFlagsJson)) {
    const audits = await prisma.auditLog.findMany({
      where: { organizationId: deal.organizationId, entityType: "Deal", entityId: deal.id, action: "research.evidence_reviewed" },
      orderBy: { createdAt: "desc" },
      select: { afterJson: true },
    });
    const latestDecisions = new Map<string, string>();
    for (const audit of audits) {
      const detail = audit.afterJson && typeof audit.afterJson === "object" && !Array.isArray(audit.afterJson)
        ? audit.afterJson as Record<string, unknown>
        : {};
      if (detail.reportId !== researchReport.id || typeof detail.sourceId !== "string" || typeof detail.decision !== "string") continue;
      if (!latestDecisions.has(detail.sourceId)) latestDecisions.set(detail.sourceId, detail.decision);
    }
    const redFlagSources = researchReport.redFlagsJson.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const sourceIds = (item as Record<string, unknown>).sourceIds;
      return Array.isArray(sourceIds) ? sourceIds.filter((id): id is string => typeof id === "string") : [];
    });
    confirmedRedFlagEvidence = redFlagSources.some((sourceId) => latestDecisions.get(sourceId) === "confirmed");
    followUpEvidence = redFlagSources.some((sourceId) => latestDecisions.get(sourceId) === "follow_up");
  }

  const result = evaluateSop({
    scoringWeights: template.scoringWeightsJson,
    mandatoryRules: template.mandatoryRulesJson,
    redFlagRules: template.redFlagRulesJson,
    recommendationRules: template.recommendationRulesJson,
    answers: deal.intakeSubmission?.rawAnswersJson,
    companyName: deal.company?.legalName ?? null,
    documents: deal.documents,
    research: researchReport
      ? { confidence: researchReport.confidence, redFlags: researchReport.redFlagsJson, confirmedRedFlagEvidence, followUpEvidence }
      : null,
  });

  await prisma.sopEvaluation.create({
    data: {
      organizationId: deal.organizationId,
      dealId: deal.id,
      sopTemplateId: template.id,
      score: result.score,
      rating: result.rating,
      categoryScoresJson: toEvaluationJson(result.categoryScores),
      mandatoryFailuresJson: toEvaluationJson(result.mandatoryFailures),
      redFlagsJson: toEvaluationJson(result.redFlags),
      missingRequirementsJson: toEvaluationJson(result.missingRequirements),
      recommendation: result.recommendation,
      explanation: result.explanation,
    },
  });
  await prisma.deal.update({
    where: { id: deal.id },
    data: {
      currentRating: result.rating,
      currentScore: result.score,
      recommendedAction: result.recommendation,
    },
  });
  return result;
}

async function queueResearchIfConfigured(prisma: PrismaClient, dealId: string) {
  if (!env.TAVILY_API_KEY) return;
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      organizationId: true,
      title: true,
      company: { select: { legalName: true } },
      researchReports: {
        where: { status: { in: ["queued", "running", "completed"] } },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!deal || deal.researchReports.length > 0) return;

  const report = await prisma.researchReport.create({
    data: {
      organizationId: deal.organizationId,
      dealId: deal.id,
      provider: "tavily",
      status: "queued",
    },
    select: { id: true },
  });
  const job = await prisma.job.create({
    data: {
      organizationId: deal.organizationId,
      type: "research.collect",
      payloadJson: { researchReportId: report.id, dealId: deal.id },
    },
    select: { id: true },
  });
}

async function queueDealPacketIfReady(prisma: PrismaClient, dealId: string) {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      organizationId: true,
      title: true,
      intakeSubmission: { select: { rawAnswersJson: true } },
      documents: {
        select: {
          id: true,
          status: true,
          originalFilename: true,
          extractions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true, extractionStatus: true, textStorageKey: true },
          },
        },
      },
      aiRuns: {
        where: { runType: "deal_packet", status: { in: ["queued", "running", "completed"] } },
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!deal || deal.aiRuns.length > 0 || deal.documents.some((document) => document.status === "uploaded" || document.status === "extracting")) {
    return;
  }

  const completedDocuments = deal.documents.flatMap((document) => {
    const extraction = document.extractions[0];
    return extraction?.extractionStatus === "completed" && extraction.textStorageKey
      ? [{ document, extraction }]
      : [];
  });

  if (completedDocuments.length === 0) {
    await prisma.deal.update({ where: { id: deal.id }, data: { status: "failed" } });
    return;
  }

  const textSections: string[] = [];
  for (const item of completedDocuments) {
    const textStorageKey = item.extraction.textStorageKey;
    if (!textStorageKey) continue;
    const text = (await readDocument(textStorageKey)).toString("utf8");
    textSections.push(`DOCUMENT: ${item.document.originalFilename}\n${text.slice(0, 20_000)}`);
  }

  const prompt = [
    "You are the AIDEAL deal intake analyst.",
    "Return valid JSON only with these keys: summary, keyFacts, risks, missingInformation, recommendation, confidence.",
    "keyFacts, risks, and missingInformation must be arrays of concise strings.",
    `Deal title: ${deal.title}`,
    `Intake answers: ${JSON.stringify(deal.intakeSubmission?.rawAnswersJson ?? {})}`,
    textSections.join("\n\n"),
  ].join("\n\n");

  const provider = env.AI_DEFAULT_PROVIDER;
  const model = provider === "openrouter" ? env.OPENROUTER_DEFAULT_MODEL : env.GEMINI_DEFAULT_MODEL;
  const aiRun = await prisma.aiRun.create({
    data: {
      organizationId: deal.organizationId,
      dealId: deal.id,
      runType: "deal_packet",
      provider,
      model,
      promptVersion: "deal-packet-v1",
      inputRefsJson: {
        documentIds: completedDocuments.map((item) => item.document.id),
        extractionIds: completedDocuments.map((item) => item.extraction.id),
      } as Prisma.InputJsonValue,
      status: "queued",
    },
    select: { id: true },
  });
  const job = await prisma.job.create({
    data: {
      organizationId: deal.organizationId,
      type: "ai.generate",
      payloadJson: { aiRunId: aiRun.id, prompt },
    },
    select: { id: true },
  });
}

abstract class JobHandler {
  abstract readonly type: string;
  abstract process(job: JobRecord): Promise<void>;
}

/**
 * Completes only work that was durably accepted by the public API. Every
 * database side effect is inside one transaction; a lease-recovered retry can
 * therefore observe committed rows and safely become a no-op.
 */
class IntakeFinalizationHandler extends JobHandler {
  readonly type = "intake.finalize";

  constructor(private readonly prisma: PrismaClient) { super(); }

  async process(job: JobRecord) {
    const payload = asIntakeFinalizationPayload(job.payloadJson);
    await this.prisma.$transaction(async (transaction) => {
      const submission = await transaction.intakeSubmission.findFirst({
        where: { id: payload.submissionId, organizationId: job.organizationId },
        select: {
          id: true,
          organizationId: true,
          rawAnswersJson: true,
          intakeSession: { select: { applicantEmail: true, status: true } },
          intakeForm: { select: { sopTemplate: { select: { dealTypeId: true } } } },
          deal: { select: { id: true, status: true } },
        },
      });
      if (!submission) throw new Error("Intake submission not found in job organization");
      if (submission.intakeSession.status !== "submitted") throw new Error("Intake session is not accepted");

      const answers = asRecord(submission.rawAnswersJson);
      const legalName = firstString(answers.legalName, answers.companyName);
      const jurisdiction = firstString(answers.jurisdiction);
      let companyId: string | null = null;
      if (legalName) {
        const companyData = {
          registrationNumber: firstString(answers.registrationNumber, answers.companyRegistrationNumber),
          website: firstString(answers.website, answers.companyWebsite),
          address: firstString(answers.address, answers.companyAddress),
        };
        // These identities are enforced by Postgres. An expired lease can let
        // another worker begin finalization, so a read-then-create sequence
        // would permit duplicate entities before either transaction commits.
        const resolvedCompany = await transaction.company.upsert({
          where: { organizationId_legalName_identityJurisdiction: { organizationId: job.organizationId, legalName, identityJurisdiction: jurisdiction ?? "" } },
          update: companyData,
          create: { organizationId: job.organizationId, legalName, jurisdiction, ...companyData },
          select: { id: true },
        });
        companyId = resolvedCompany.id;
      }

      const email = firstString(answers.applicantEmail, answers.email, answers.contactEmail) ?? submission.intakeSession.applicantEmail;
      const applicantData = {
        companyId,
        name: firstString(answers.applicantName, answers.contactName, answers.name) ?? email,
        roleTitle: firstString(answers.roleTitle, answers.contactRole, answers.applicantRole),
        phone: firstString(answers.phone, answers.contactPhone, answers.applicantPhone),
        authorityConfirmed: answers.authorityConfirmed === true || answers.__declarationAccepted === true,
      };
      const resolvedApplicant = await transaction.applicant.upsert({
        where: { organizationId_email: { organizationId: job.organizationId, email } },
        update: applicantData,
        create: { organizationId: job.organizationId, email, ...applicantData },
        select: { id: true },
      });

      const deal = await transaction.deal.upsert({
        where: { intakeSubmissionId: submission.id },
        update: { title: intakeTitle(answers, email), dealTypeId: submission.intakeForm.sopTemplate.dealTypeId, companyId, applicantId: resolvedApplicant.id },
        create: {
          organizationId: job.organizationId, intakeSubmissionId: submission.id,
          title: intakeTitle(answers, email), dealTypeId: submission.intakeForm.sopTemplate.dealTypeId,
          companyId, applicantId: resolvedApplicant.id, status: "submitted",
        },
        select: { id: true, status: true },
      });

      // Transactional outbox writer. It is intentionally not a
      // direct notification publish: delivery is delegated to its dispatcher.
      await publishWorkerNotification(transaction as unknown as PrismaClient, {
        eventId: workerNotificationEventId(), schemaVersion: 1, eventType: "deal.submitted",
        organizationId: job.organizationId, occurredAt: new Date().toISOString(),
        dedupeKey: `${job.organizationId}:deal.submitted:${deal.id}`, priority: "normal",
        actor: { type: "system", service: "intake-finalizer" },
        payload: { dealId: deal.id, submissionId: submission.id, status: "submitted" },
      });

      const draftDocuments = Array.isArray(answers.__documents) ? answers.__documents : [];
      let createdDocument = false;
      const seenKeys = new Set<string>();
      for (const value of draftDocuments) {
        const document = asRecord(value);
        const storageKey = firstString(document.storageKey);
        const documentType = firstString(document.documentType);
        const originalFilename = firstString(document.originalFilename);
        const mimeType = firstString(document.mimeType);
        if (!storageKey || !documentType || !originalFilename || !mimeType || typeof document.sizeBytes !== "number" || seenKeys.has(storageKey)) continue;
        seenKeys.add(storageKey);
        const existing = await transaction.document.findFirst({ where: { dealId: deal.id, storageKey }, select: { id: true } });
        if (existing) continue;
        const created = await transaction.document.create({
          data: { organizationId: job.organizationId, dealId: deal.id, applicantId: resolvedApplicant.id, companyId, documentType, originalFilename, storageKey, mimeType, sizeBytes: document.sizeBytes, status: "uploaded" },
          select: { id: true },
        });
        const extraction = await transaction.documentExtraction.create({ data: { documentId: created.id, extractionStatus: "queued" }, select: { id: true } });
        await transaction.job.create({ data: { organizationId: job.organizationId, type: "document.extract", payloadJson: { documentId: created.id, extractionId: extraction.id } }, select: { id: true } });
        createdDocument = true;
      }

      if (createdDocument && deal.status === "submitted") {
        await transaction.deal.update({ where: { id: deal.id }, data: { status: "processing" } });
        await transaction.dealStatusHistory.create({ data: { dealId: deal.id, fromStatus: "submitted", toStatus: "processing", reason: "Documents queued for extraction" } });
        await transaction.auditLog.create({ data: { organizationId: job.organizationId, action: "deal.status_changed", entityType: "Deal", entityId: deal.id, beforeJson: { status: "submitted" }, afterJson: { status: "processing", actorType: "system", actorReference: "intake.finalize", reason: "Documents queued for extraction" } } });
      }
    });
  }
}

class DocumentExtractionHandler extends JobHandler {
  readonly type = "document.extract";

  constructor(private readonly prisma: PrismaClient, private readonly usage: UsageRecorder) { super(); }

  async process(job: JobRecord) {
    const payload = asExtractionPayload(job.payloadJson);
    const document = await this.prisma.document.findUnique({ where: { id: payload.documentId } });
    if (!document) throw new Error("Document not found");

    await this.prisma.document.update({ where: { id: document.id }, data: { status: "extracting" } });
    await this.prisma.documentExtraction.update({ where: { id: payload.extractionId }, data: { extractionStatus: "running", errorMessage: null } });

    const source = await readDocument(document.storageKey);
    const extracted = await extractDocument({ buffer: source, mimeType: document.mimeType });
    const textStorageKey = `extracted-text/${document.organizationId}/${document.id}/${payload.extractionId}.txt`;
    await writeExtractedText(textStorageKey, extracted.text);

    await this.prisma.documentExtraction.update({
      where: { id: payload.extractionId },
      data: {
        extractionStatus: "completed",
        textStorageKey,
        pageSummariesJson: extracted.pageSummaries,
        confidence: extracted.confidence,
      },
    });
    await this.prisma.document.update({ where: { id: document.id }, data: { status: "analyzed" } });
    this.usage.record({ organizationId: document.organizationId, eventType: "document.extraction_completed", relatedEntityType: "Document", relatedEntityId: document.id, metadata: { mimeType: document.mimeType, extractedCharacters: extracted.text.length } });
    if (document.dealId) await queueDealPacketIfReady(this.prisma, document.dealId);
  }
}

class AiGenerationHandler extends JobHandler {
  readonly type = "ai.generate";

  constructor(
    private readonly prisma: PrismaClient,
    private readonly usage: UsageRecorder,
    private readonly dealTransitions: DealTransitions,
  ) { super(); }

  async process(job: JobRecord) {
    const payload = asAiPayload(job.payloadJson);
    const aiRun = await this.prisma.aiRun.findUnique({ where: { id: payload.aiRunId } });
    if (!aiRun) throw new Error("AI run not found");

    await this.prisma.aiRun.update({ where: { id: aiRun.id }, data: { status: "running", errorMessage: null } });
    const completion = await generateText({ prompt: payload.prompt, provider: aiRun.provider, model: aiRun.model });
    await this.prisma.aiRun.update({
      where: { id: aiRun.id },
      data: {
        status: "completed",
        outputJson: parseStructuredOutput(completion.text) as Prisma.InputJsonValue,
        confidence: "provider_response",
      },
    });
    this.usage.record({ organizationId: aiRun.organizationId, eventType: "ai.run_completed", relatedEntityType: "AiRun", relatedEntityId: aiRun.id, metadata: { provider: aiRun.provider, model: aiRun.model, runType: aiRun.runType } });
    if (aiRun.dealId) {
      await evaluateDealSop(this.prisma, aiRun.dealId);
      await queueResearchIfConfigured(this.prisma, aiRun.dealId);
      await this.dealTransitions.transitionToReviewReady({
        organizationId: aiRun.organizationId,
        dealId: aiRun.dealId,
      });
    }
  }
}

class ResearchHandler extends JobHandler {
  readonly type = "research.collect";

  constructor(
    private readonly prisma: PrismaClient,
    private readonly usage: UsageRecorder,
  ) { super(); }

  async process(job: JobRecord) {
    const payload = asResearchPayload(job.payloadJson);
    const report = await this.prisma.researchReport.findUnique({ where: { id: payload.researchReportId } });
    if (!report) throw new Error("Research report not found");

    await this.prisma.researchReport.update({ where: { id: report.id }, data: { status: "running", errorMessage: null } });
    const deal = await this.prisma.deal.findUnique({
      where: { id: payload.dealId },
      select: { title: true, company: { select: { legalName: true } } },
    });
    if (!deal) throw new Error("Deal not found for research");

    const sources = assignResearchSourceIds(await collectResearch(`${deal.company?.legalName ?? deal.title} company verification and adverse media`));
    this.usage.record({ organizationId: report.organizationId, eventType: "research.discovery", quantity: sources.length, relatedEntityType: "ResearchReport", relatedEntityId: report.id, metadata: { provider: report.provider, sourceCount: sources.length } });
    const fetchedPages = sources.filter((source) => source.extractionMethod).length;
    const cacheHits = sources.filter((source) => source.cacheHit).length;
    if (fetchedPages > 0) this.usage.record({ organizationId: report.organizationId, eventType: "research.page_fetched", quantity: fetchedPages, relatedEntityType: "ResearchReport", relatedEntityId: report.id, metadata: { extractionMethod: "scrapling" } });
    if (cacheHits > 0) this.usage.record({ organizationId: report.organizationId, eventType: "research.cache_hit", quantity: cacheHits, relatedEntityType: "ResearchReport", relatedEntityId: report.id, metadata: { backend: sources.find((source) => source.cacheHit)?.cacheBackend ?? "unknown" } });
    const synthesis = await synthesizeResearch(sources);
    this.usage.record({ organizationId: report.organizationId, eventType: "research.synthesis", relatedEntityType: "ResearchReport", relatedEntityId: report.id, metadata: { provider: synthesis.provider, model: synthesis.model, sourceCount: sources.length } });
    await this.prisma.researchReport.update({
      where: { id: report.id },
      data: {
        status: "completed",
        summary: synthesis.summary,
        verifiedFactsJson: synthesis.verifiedFacts,
        unverifiedClaimsJson: synthesis.unverifiedClaims,
        inconsistenciesJson: synthesis.inconsistencies,
        redFlagsJson: synthesis.redFlags,
        sourcesJson: sources,
        confidence: `provisional:${synthesis.confidence}`,
      },
    });
    await publishWorkerNotification(this.prisma, {
      eventId: workerNotificationEventId(),
      schemaVersion: 1,
      eventType: "research.completed",
      organizationId: report.organizationId,
      occurredAt: new Date().toISOString(),
      dedupeKey: `${report.organizationId}:research.completed:${report.id}`,
      priority: "normal",
      actor: { type: "system", service: "worker" },
      payload: {
        researchReportId: report.id,
        dealId: payload.dealId,
        sourceCount: sources.length,
        confidence: `provisional:${synthesis.confidence}`,
      },
    });
    const followUpCount = synthesis.unverifiedClaims.length + synthesis.inconsistencies.length + synthesis.redFlags.length;
    if (followUpCount > 0) {
      await publishWorkerNotification(this.prisma, {
        eventId: workerNotificationEventId(),
        schemaVersion: 1,
        eventType: "research.follow_up_required",
        organizationId: report.organizationId,
        occurredAt: new Date().toISOString(),
        dedupeKey: `${report.organizationId}:research.follow_up_required:${report.id}`,
        priority: "high",
        actor: { type: "system", service: "worker" },
        payload: {
          researchReportId: report.id,
          dealId: payload.dealId,
          sourceCount: sources.length,
          followUpCount,
          confidence: `provisional:${synthesis.confidence}`,
        },
      });
    }
    const evaluationJob = await this.prisma.job.create({
      data: {
        organizationId: report.organizationId,
        type: "sop.evaluate",
        payloadJson: { dealId: payload.dealId },
      },
      select: { id: true },
    });
  }
}

class SopEvaluationHandler extends JobHandler {
  readonly type = "sop.evaluate";

  constructor(private readonly prisma: PrismaClient) { super(); }

  async process(job: JobRecord) {
    const payload = asSopEvaluationPayload(job.payloadJson);
    const outcome = await this.prisma.$transaction(async (transaction) => {
      // Serialize evaluations for one deal across all worker processes.
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${payload.dealId}))`;
      const competingJobs = await transaction.job.findMany({
        where: {
          organizationId: job.organizationId,
          type: "sop.evaluate",
          status: { in: ["queued", "running", "completed"] },
          createdAt: { gte: job.createdAt },
        },
        select: { id: true, status: true, createdAt: true, payloadJson: true },
      });
      if (hasNewerActiveSopEvaluation(job, competingJobs)) return { stale: true as const, result: null };
      return { stale: false as const, result: await evaluateDealSop(transaction, payload.dealId) };
    });
    if (outcome.stale) return;
    if (!outcome.result) throw new Error("SOP template is not active for deal");
  }
}

export class JobProcessor {
  private readonly handlers: JobHandler[];

  constructor(
    private readonly prisma: PrismaClient,
    dealTransitions: DealTransitions = new InternalApiDealTransitions(),
  ) {
    const usage = new UsageRecorder(prisma);
    this.handlers = [
      new IntakeFinalizationHandler(prisma),
      new DocumentExtractionHandler(prisma, usage),
      new AiGenerationHandler(prisma, usage, dealTransitions),
      new ResearchHandler(prisma, usage),
      new SopEvaluationHandler(prisma),
    ];
  }

  async process(jobId: string) {
    const claimedJob = await this.claim(jobId);
    if (!claimedJob) return;
    const heartbeat = setInterval(() => {
      void renewJobLease(this.prisma, claimedJob);
    }, JOB_HEARTBEAT_MS);

    try {
      if (claimedJob.type === "test.failure") throw new Error("Intentional test job failure");
      const handler = this.handlers.find((candidate) => candidate.type === claimedJob.type);
      if (!handler && claimedJob.type !== "test.success") throw new Error(`Unsupported job type: ${claimedJob.type}`);
      if (handler) await handler.process(claimedJob);
      const completed = await this.prisma.job.updateMany({
        where: { id: claimedJob.id, status: "running", leaseToken: claimedJob.leaseToken },
        data: { status: "completed", completedAt: new Date(), leaseExpiresAt: null, leaseToken: null },
      });
      if (completed.count === 0) {
        jobTelemetry("job.stale_lease_write_rejected", claimedJob, { operation: "complete" });
        return;
      }
      console.log(JSON.stringify({ ok: true, jobId: claimedJob.id, status: "completed" }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown worker error";
      const status = await this.recordFailure(claimedJob, message);
      console.error(JSON.stringify({ ok: false, jobId: claimedJob.id, status, error: message }));
    } finally {
      clearInterval(heartbeat);
    }
  }

  /** Claims one eligible job. The lease token fences stale workers after recovery. */
  async processNext() {
    const now = new Date();
    await this.recoverExpiredLeases(now);
    const candidate = await this.prisma.job.findFirst({
      where: {
        status: "queued",
        availableAt: { lte: now },
      },
      orderBy: { availableAt: "asc" },
      select: { id: true },
    });
    if (!candidate) return false;
    await this.process(candidate.id);
    return true;
  }

  /**
   * Requeue crashed workers before finding new work. Null leases are legacy
   * pre-cutover rows and only recover after one full lease window.
   */
  async recoverExpiredLeases(now = new Date()) {
    const legacyCutoff = new Date(now.getTime() - JOB_LEASE_MS);
    const recovered = await this.prisma.job.updateMany({
      where: {
        status: "running",
        OR: [
          { leaseExpiresAt: { lte: now } },
          { leaseExpiresAt: null, OR: [{ startedAt: { lte: legacyCutoff } }, { startedAt: null }] },
        ],
      },
      data: {
        status: "queued",
        availableAt: now,
        leaseExpiresAt: null,
        leaseToken: null,
        errorMessage: "Worker lease expired; requeued for recovery",
      },
    });
    if (recovered.count > 0) {
      console.log(JSON.stringify({ event: "job.lease_expired_requeued", count: recovered.count, recoveredAt: now.toISOString() }));
    }
    return recovered.count;
  }

  private async claim(jobId: string) {
    const now = new Date();
    const leaseToken = randomUUID();
    const claimed = await this.prisma.job.updateMany({
      where: {
        id: jobId,
        status: "queued",
        availableAt: { lte: now },
      },
      data: {
        status: "running",
        attempts: { increment: 1 },
        startedAt: now,
        errorMessage: null,
        leaseToken,
        leaseExpiresAt: new Date(now.getTime() + JOB_LEASE_MS),
      },
    });
    if (claimed.count === 0) return null;

    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.leaseToken !== leaseToken) return null;
    jobTelemetry("job.claimed", job, { leaseTokenPrefix: leaseToken.slice(0, 8), leaseExpiresAt: job.leaseExpiresAt?.toISOString() });
    return job;
  }

  private async recordFailure(job: JobRecord, message: string) {
    if (job.attempts < job.maxAttempts) {
      const availableAt = new Date(Date.now() + retryDelayMs(job.attempts));
      const rescheduled = await this.prisma.job.updateMany({
        where: { id: job.id, status: "running", leaseToken: job.leaseToken },
        data: {
          status: "queued",
          errorMessage: message,
          completedAt: null,
          availableAt,
          leaseExpiresAt: null,
          leaseToken: null,
        },
      });
      if (rescheduled.count === 0) {
        jobTelemetry("job.stale_lease_write_rejected", job, { operation: "retry" });
        return "superseded" as const;
      }
      await publishWorkerNotification(this.prisma, {
        eventId: workerNotificationEventId(),
        schemaVersion: 1,
        eventType: "job.retry_scheduled",
        organizationId: job.organizationId,
        occurredAt: new Date().toISOString(),
        dedupeKey: `${job.organizationId}:job.retry_scheduled:${job.id}:${job.attempts}`,
        priority: "normal",
        actor: { type: "system", service: "worker" },
        payload: {
          jobId: job.id,
          jobType: job.type,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
          errorCode: message,
          retryAt: availableAt.toISOString(),
        },
      });
      return "retrying" as const;
    }

    const failed = await this.prisma.job.updateMany({
      where: { id: job.id, status: "running", leaseToken: job.leaseToken },
      data: { status: "failed", errorMessage: message, completedAt: new Date(), leaseExpiresAt: null, leaseToken: null },
    });
    if (failed.count === 0) {
      jobTelemetry("job.stale_lease_write_rejected", job, { operation: "fail" });
      return "superseded" as const;
    }
    await publishWorkerNotification(this.prisma, {
      eventId: workerNotificationEventId(),
      schemaVersion: 1,
      eventType: "job.failed",
      organizationId: job.organizationId,
      occurredAt: new Date().toISOString(),
      dedupeKey: `${job.organizationId}:job.failed:${job.id}`,
      priority: "high",
      actor: { type: "system", service: "worker" },
      payload: {
        jobId: job.id,
        jobType: job.type,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        errorCode: message,
      },
    });
    new UsageRecorder(this.prisma).record({
      organizationId: job.organizationId,
      eventType: "job.failed",
      relatedEntityType: "Job",
      relatedEntityId: job.id,
      metadata: { jobType: job.type, attempts: job.attempts },
    });
    if (job.type === "document.extract") {
      new UsageRecorder(this.prisma).record({ organizationId: job.organizationId, eventType: "document.extraction_failed", relatedEntityType: "Job", relatedEntityId: job.id, metadata: { attempts: job.attempts } });
      const payload = asExtractionPayload(job.payloadJson);
      await this.prisma.documentExtraction.update({ where: { id: payload.extractionId }, data: { extractionStatus: "failed", errorMessage: message } });
      const extraction = await this.prisma.documentExtraction.findUnique({ where: { id: payload.extractionId }, select: { documentId: true } });
      if (extraction) {
        await this.prisma.document.update({ where: { id: extraction.documentId }, data: { status: "failed" } });
        const document = await this.prisma.document.findUnique({ where: { id: extraction.documentId }, select: { dealId: true } });
        if (document?.dealId) await queueDealPacketIfReady(this.prisma, document.dealId);
      }
    }
    if (job.type === "ai.generate") {
      new UsageRecorder(this.prisma).record({ organizationId: job.organizationId, eventType: "ai.run_failed", relatedEntityType: "Job", relatedEntityId: job.id, metadata: { attempts: job.attempts } });
      const payload = asAiPayload(job.payloadJson);
      const aiRun = await this.prisma.aiRun.findUnique({ where: { id: payload.aiRunId }, select: { dealId: true } });
      await this.prisma.aiRun.update({ where: { id: payload.aiRunId }, data: { status: "failed", errorMessage: message } });
      if (aiRun?.dealId) await this.prisma.deal.update({ where: { id: aiRun.dealId }, data: { status: "failed" } });
    }
    if (job.type === "research.collect") {
      const payload = asResearchPayload(job.payloadJson);
      await this.prisma.researchReport.update({
        where: { id: payload.researchReportId },
        data: { status: "failed", errorMessage: message },
      });
      await publishWorkerNotification(this.prisma, {
        eventId: workerNotificationEventId(),
        schemaVersion: 1,
        eventType: "research.failed",
        organizationId: job.organizationId,
        occurredAt: new Date().toISOString(),
        dedupeKey: `${job.organizationId}:research.failed:${payload.researchReportId}`,
        priority: "high",
        actor: { type: "system", service: "worker" },
        payload: {
          researchReportId: payload.researchReportId,
          dealId: payload.dealId,
          errorCode: message,
        },
      });
    }

    return "failed" as const;
  }
}
