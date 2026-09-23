import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { PrismaClient } from "@aideal/db";
import { PrismaNeon } from "@prisma/adapter-neon";
import { env } from "@aideal/env";
import { neon } from "@neondatabase/serverless";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { JobProcessor } from "../src/job-processor";
import { IntakeSubmissionsService } from "../../api/src/modules/intake-submissions/intake-submissions.service";
import { JobsService } from "../../api/src/modules/jobs/jobs.service";

const integrationEnabled = process.env.AIDEAL_INTEGRATION === "1";
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test("live PDF extraction and Gemini deal packet pipeline", { skip: !integrationEnabled }, async () => {
  if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
  if (testDatabaseUrl === process.env.DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL must be a disposable database, not DATABASE_URL");
  }
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required");
  if (!env.TAVILY_API_KEY) throw new Error("TAVILY_API_KEY is required");
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET) {
    throw new Error("R2 credentials are required");
  }

  const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: testDatabaseUrl }) });
  const cleanupSql = neon(testDatabaseUrl);
  const processor = new JobProcessor(prisma);
  const storage = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  });
  const suffix = randomUUID();
  const sourceKey = `integration-tests/${suffix}/source.pdf`;
  let extractedKey: string | null = null;
  let organizationId: string | null = null;
  let reviewerUserId: string | null = null;

  try {
    const fixture = await readFile(resolve(process.cwd(), "../../node_modules/.pnpm/pdf-parse@1.1.1/node_modules/pdf-parse/test/data/01-valid.pdf"));
    await storage.send(new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: sourceKey, Body: fixture, ContentType: "application/pdf" }));

    const organization = await prisma.organization.create({
      data: { name: `Integration Test ${suffix}`, slug: `integration-${suffix}` },
      select: { id: true },
    });
    organizationId = organization.id;
    const reviewer = await prisma.user.create({
      data: {
        clerkUserId: `integration-reviewer-${suffix}`,
        email: `integration-reviewer-${suffix}@example.test`,
        name: "Integration Reviewer",
      },
      select: { id: true },
    });
    reviewerUserId = reviewer.id;
    await prisma.organizationMembership.create({
      data: { organizationId, userId: reviewer.id, role: "reviewer" },
    });
    const dealType = await prisma.dealType.create({
      data: { organizationId, name: "Integration trade finance" },
      select: { id: true },
    });
    const sopTemplate = await prisma.sopTemplate.create({
      data: {
        organizationId,
        dealTypeId: dealType.id,
        name: "Integration SOP",
        status: "active",
        scoringWeightsJson: { documentCompleteness: 60, companyVerification: 40 },
        mandatoryRulesJson: { requiredDocuments: ["supporting_document"], mustHaveCompanyName: true },
        redFlagRulesJson: { sanctionsCheck: true },
        recommendationRulesJson: { proceed: "proceed" },
      },
      select: { id: true },
    });
    const intakeForm = await prisma.intakeForm.create({
      data: {
        organizationId,
        sopTemplateId: sopTemplate.id,
        name: "Integration intake",
        publicSlug: `integration-${suffix}`,
        status: "active",
      },
      select: { id: true },
    });
    const intakeSession = await prisma.intakeSession.create({
      data: {
        organizationId,
        intakeFormId: intakeForm.id,
        applicantEmail: "integration@example.test",
        resumeTokenHash: `integration-${suffix}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        status: "submitted",
      },
      select: { id: true },
    });
    const submission = await prisma.intakeSubmission.create({
      data: {
        organizationId,
        intakeFormId: intakeForm.id,
        intakeSessionId: intakeSession.id,
        rawAnswersJson: { companyName: "Integration Holdings" },
        status: "submitted",
        submittedAt: new Date(),
      },
      select: { id: true },
    });
    const deal = await prisma.deal.create({
      data: {
        organizationId,
        intakeSubmissionId: submission.id,
        dealTypeId: dealType.id,
        title: "Live pipeline integration test",
      },
      select: { id: true },
    });
    const document = await prisma.document.create({
      data: {
        organizationId,
        dealId: deal.id,
        documentType: "supporting_document",
        originalFilename: "source.pdf",
        storageKey: sourceKey,
        mimeType: "application/pdf",
        sizeBytes: fixture.length,
      },
      select: { id: true },
    });
    const extraction = await prisma.documentExtraction.create({
      data: { documentId: document.id, extractionStatus: "queued" },
      select: { id: true },
    });
    const extractionJob = await prisma.job.create({
      data: {
        organizationId,
        type: "document.extract",
        payloadJson: { documentId: document.id, extractionId: extraction.id },
      },
      select: { id: true },
    });
    await processor.process(extractionJob.id);

    const completedExtraction = await prisma.documentExtraction.findUnique({ where: { id: extraction.id } });
    assert.equal(completedExtraction?.extractionStatus, "completed");
    assert.ok(completedExtraction?.textStorageKey);
    extractedKey = completedExtraction.textStorageKey;

    const aiJob = await prisma.job.findFirst({ where: { organizationId, type: "ai.generate" }, select: { id: true } });
    assert.ok(aiJob);
    await processor.process(aiJob.id);

    const researchJob = await prisma.job.findFirst({ where: { organizationId, type: "research.collect" }, select: { id: true } });
    assert.ok(researchJob);
    await processor.process(researchJob.id);

    const [aiRun, completedDeal, sopEvaluation, researchReport] = await Promise.all([
      prisma.aiRun.findFirst({ where: { dealId: deal.id, runType: "deal_packet" } }),
      prisma.deal.findUnique({ where: { id: deal.id }, select: { status: true } }),
      prisma.sopEvaluation.findFirst({ where: { dealId: deal.id }, orderBy: { createdAt: "desc" } }),
      prisma.researchReport.findFirst({ where: { dealId: deal.id }, orderBy: { createdAt: "desc" } }),
    ]);
    assert.equal(aiRun?.status, "completed");
    assert.equal(completedDeal?.status, "review_ready");
    assert.equal(sopEvaluation?.rating, "A");
    assert.equal(sopEvaluation?.score, 100);
    assert.equal(researchReport?.status, "completed");
    assert.ok(researchReport?.summary);
    assert.ok(Array.isArray(researchReport?.sourcesJson));
    const sourceId = (researchReport?.sourcesJson as Array<Record<string, unknown>>)[0]?.sourceId;
    assert.equal(typeof sourceId, "string");

    // Make the evidence signal deterministic while keeping source provenance real.
    await prisma.researchReport.update({
      where: { id: researchReport.id },
      data: {
        redFlagsJson: [{ text: "Integration-only evidence signal", sourceIds: [sourceId as string] }],
      },
    });

    const jobs = new JobsService(prisma as never);
    const reviewService = new IntakeSubmissionsService(prisma as never, {} as never, jobs);

    const followUp = await reviewService.reviewResearchEvidence(organizationId, reviewerUserId, submission.id, {
      reportId: researchReport.id,
      sourceId: sourceId as string,
      decision: "follow_up",
      note: "Integration follow-up decision",
    });
    const followUpJob = await prisma.job.findUnique({ where: { id: (followUp.reevaluationJob as { id: string }).id } });
    assert.equal(followUpJob?.type, "sop.evaluate");
    await processor.process(followUpJob!.id);

    const followUpEvaluation = await prisma.sopEvaluation.findFirst({
      where: { dealId: deal.id },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(followUpEvaluation?.recommendation, "manual_review");
    assert.match(followUpEvaluation?.explanation ?? "", /follow-up/i);
    assert.equal((await prisma.job.findUnique({ where: { id: followUpJob!.id } }))?.status, "completed");

    const confirmed = await reviewService.reviewResearchEvidence(organizationId, reviewerUserId, submission.id, {
      reportId: researchReport.id,
      sourceId: sourceId as string,
      decision: "confirmed",
      note: "Integration confirmation decision",
    });
    const confirmedJob = await prisma.job.findUnique({ where: { id: (confirmed.reevaluationJob as { id: string }).id } });
    assert.equal(confirmedJob?.type, "sop.evaluate");
    await processor.process(confirmedJob!.id);

    const confirmedEvaluation = await prisma.sopEvaluation.findFirst({
      where: { dealId: deal.id },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(confirmedEvaluation?.rating, "Reject");
    assert.equal(confirmedEvaluation?.recommendation, "manual_review");
    assert.deepEqual(confirmedEvaluation?.redFlagsJson, ["research_evidence"]);
    assert.equal((await prisma.job.findUnique({ where: { id: confirmedJob!.id } }))?.status, "completed");
  } finally {
    if (organizationId) await cleanupSql`DELETE FROM organizations WHERE id = ${organizationId}`;
    if (reviewerUserId) await cleanupSql`DELETE FROM users WHERE id = ${reviewerUserId}`;
    await storage.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: sourceKey }));
    if (extractedKey) await storage.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: extractedKey }));
    await prisma.$disconnect();
  }
});
