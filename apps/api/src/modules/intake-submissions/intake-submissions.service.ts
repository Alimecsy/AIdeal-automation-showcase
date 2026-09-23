import type { DealStatus, Prisma } from "@aideal/db";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DealsService } from "../deals/deals.service";
import { JobsPort } from "../jobs/jobs.port";
import { PrismaService } from "../prisma.service";

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseBoundedInteger(value: string | undefined, min: number, max: number) {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : undefined;
}

function parseBooleanFilter(value: string | undefined) {
  if (value === "true" || value === "required") return true;
  if (value === "false" || value === "clear") return false;
  return undefined;
}

function hasMissingDocuments(value: unknown) {
  return Array.isArray(value) && value.length > 0;
}

function isOlderThan(value: Date | null, days: number) {
  return value !== null && value.getTime() < Date.now() - days * 86_400_000;
}

function deriveSubmissionTitle(
  answers: Record<string, unknown>,
  fallbackEmail: string,
) {
  const candidates = [
    answers.legalName,
    answers.companyName,
    answers.projectName,
    answers.requestTitle,
    answers.requestType,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return fallbackEmail;
}

@Injectable()
export class IntakeSubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dealsService: DealsService,
    private readonly jobs: JobsPort,
  ) {}

  async listSubmissions(
    organizationId: string,
    filters: {
      status?: string;
      query?: string;
      rating?: string;
      confidence?: string;
      researchFollowUp?: string;
      missingDocuments?: string;
      olderThanDays?: string;
      sort?: string;
      page?: string;
      pageSize?: string;
    } = {},
  ) {
    const validStatuses = new Set<DealStatus>([
      "submitted",
      "processing",
      "review_ready",
      "action_required",
      "accepted",
      "rejected",
      "manual_review",
      "failed",
      "archived",
    ]);
    const status = filters.status && validStatuses.has(filters.status as DealStatus)
      ? filters.status as DealStatus
      : undefined;
    const query = filters.query?.trim();
    const rating = filters.rating?.trim() || undefined;
    const confidence = filters.confidence?.trim() || undefined;
    const olderThanDays = parseBoundedInteger(filters.olderThanDays, 0, 3650);
    const page = parseBoundedInteger(filters.page, 1, 10_000) ?? 1;
    const pageSize = parseBoundedInteger(filters.pageSize, 1, 50) ?? 25;
    const researchFollowUp = parseBooleanFilter(filters.researchFollowUp);
    const missingDocuments = parseBooleanFilter(filters.missingDocuments);
    const sort = filters.sort === "oldest" || filters.sort === "newest"
      ? filters.sort
      : "priority";
    const dealFilters = {
      ...(status ? { status } : {}),
      ...(rating ? { currentRating: rating } : {}),
      ...(confidence ? { confidence } : {}),
    };
    const where: Prisma.IntakeSubmissionWhereInput = {
      organizationId,
      ...(Object.keys(dealFilters).length > 0 ? { deal: { is: dealFilters } } : {}),
      ...(olderThanDays !== undefined
        ? { submittedAt: { lt: new Date(Date.now() - olderThanDays * 86_400_000) } }
        : {}),
      ...(query
        ? {
            OR: [
              { intakeSession: { applicantEmail: { contains: query, mode: "insensitive" } } },
              { company: { legalName: { contains: query, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const submissions = await this.prisma.intakeSubmission.findMany({
      where,
      orderBy: {
        submittedAt: "desc",
      },
      select: {
        id: true,
        applicantId: true,
        companyId: true,
        status: true,
        submittedAt: true,
        rawAnswersJson: true,
        applicant: {
          select: {
            id: true,
            name: true,
            email: true,
            roleTitle: true,
            authorityConfirmed: true,
          },
        },
        company: {
          select: {
            id: true,
            legalName: true,
            jurisdiction: true,
            website: true,
            registrationNumber: true,
          },
        },
        intakeSession: {
          select: {
            applicantEmail: true,
          },
        },
        intakeForm: {
          select: {
            id: true,
            name: true,
            sopTemplate: {
              select: {
                id: true,
                name: true,
                dealType: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
        deal: {
          select: {
            id: true,
            status: true,
            currentRating: true,
            confidence: true,
            sopEvaluations: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { missingRequirementsJson: true },
            },
            researchReports: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { id: true, status: true, sourcesJson: true },
            },
            documents: { select: { status: true } },
          },
        },
      },
    });

    const dealIds = submissions.flatMap((submission) => submission.deal?.id ?? []);
    const evidenceAudits = dealIds.length > 0
      ? await this.prisma.auditLog.findMany({
          where: {
            organizationId,
            entityType: "Deal",
            entityId: { in: dealIds },
            action: "research.evidence_reviewed",
          },
          orderBy: { createdAt: "asc" },
          select: { entityId: true, afterJson: true },
        })
      : [];
    const latestEvidenceDecisions = new Map<string, string>();
    for (const audit of evidenceAudits) {
      const after = asRecord(audit.afterJson);
      if (typeof audit.entityId === "string" && typeof after.sourceId === "string" && typeof after.decision === "string") {
        latestEvidenceDecisions.set(`${audit.entityId}:${after.sourceId}`, after.decision);
      }
    }
    const followUpDeals = new Set(
      [...latestEvidenceDecisions.entries()]
        .filter(([, decision]) => decision === "follow_up")
        .map(([key]) => key.slice(0, key.indexOf(":"))),
    );

    const enriched = submissions.map((submission) => {
      const answers = asRecord(submission.rawAnswersJson);
      const deal = submission.deal;
      const latestEvaluation = deal?.sopEvaluations[0];
      const latestReport = deal?.researchReports[0];
      const missingDocuments = hasMissingDocuments(latestEvaluation?.missingRequirementsJson);
      const researchFollowUp = Boolean(deal?.id && followUpDeals.has(deal.id));
      const prioritySignals = [
        ...(researchFollowUp ? ["research_follow_up"] : []),
        ...(missingDocuments ? ["missing_documents"] : []),
        ...(deal?.confidence === "low" ? ["low_confidence"] : []),
        ...(isOlderThan(submission.submittedAt, 7) ? ["stale"] : []),
      ];

      return {
        ...submission,
        status: submission.deal?.status ?? submission.status,
        rating: deal?.currentRating ?? null,
        confidence: deal?.confidence ?? null,
        researchFollowUp,
        missingDocuments,
        prioritySignals,
        researchStatus: latestReport?.status ?? null,
        documentStatuses: deal?.documents.map((document) => document.status) ?? [],
        title: deriveSubmissionTitle(
          answers,
          submission.intakeSession.applicantEmail,
        ),
        summary: {
          requestType:
            typeof answers.requestType === "string"
              ? answers.requestType
              : null,
          jurisdiction:
            typeof answers.jurisdiction === "string"
              ? answers.jurisdiction
              : null,
        },
      };
    });

    const filtered = enriched.filter((submission) =>
      (researchFollowUp === undefined || submission.researchFollowUp === researchFollowUp) &&
      (missingDocuments === undefined || submission.missingDocuments === missingDocuments),
    );
    filtered.sort((left, right) => {
      if (sort === "oldest" || sort === "newest") {
        const leftDate = left.submittedAt?.getTime() ?? 0;
        const rightDate = right.submittedAt?.getTime() ?? 0;
        return sort === "oldest" ? leftDate - rightDate : rightDate - leftDate;
      }

      return right.prioritySignals.length - left.prioritySignals.length ||
        (right.submittedAt?.getTime() ?? 0) - (left.submittedAt?.getTime() ?? 0) ||
        left.id.localeCompare(right.id);
    });

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    return {
      items: filtered.slice(start, start + pageSize),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
      filters: {
        status: status ?? null,
        rating: rating ?? null,
        confidence: confidence ?? null,
        researchFollowUp: researchFollowUp ?? null,
        missingDocuments: missingDocuments ?? null,
        olderThanDays: olderThanDays ?? null,
        sort,
      },
    };
  }

  async getSubmission(organizationId: string, submissionId: string) {
    const submission = await this.prisma.intakeSubmission.findFirst({
      where: {
        id: submissionId,
        organizationId,
      },
      select: {
        id: true,
        applicantId: true,
        companyId: true,
        status: true,
        submittedAt: true,
        rawAnswersJson: true,
        applicant: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            roleTitle: true,
            authorityConfirmed: true,
          },
        },
        company: {
          select: {
            id: true,
            legalName: true,
            jurisdiction: true,
            registrationNumber: true,
            website: true,
            address: true,
          },
        },
        intakeSession: {
          select: {
            id: true,
            applicantEmail: true,
            status: true,
          },
        },
        intakeForm: {
          select: {
            id: true,
            name: true,
            publicSlug: true,
            sectionsJson: true,
            documentRequirementsJson: true,
            sopTemplate: {
              select: {
                id: true,
                name: true,
                mandatoryRulesJson: true,
                redFlagRulesJson: true,
                recommendationRulesJson: true,
                dealType: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
        deal: {
          select: {
            id: true,
            title: true,
            statusHistory: {
              orderBy: { createdAt: "desc" },
              select: {
                id: true,
                fromStatus: true,
                toStatus: true,
                changedByUserId: true,
                reason: true,
                createdAt: true,
              },
            },
            documents: {
              select: {
                id: true,
                documentType: true,
                originalFilename: true,
                mimeType: true,
                sizeBytes: true,
                status: true,
                uploadedAt: true,
              },
              orderBy: {
                uploadedAt: "desc",
              },
            },
            status: true,
            currentRating: true,
            currentScore: true,
            confidence: true,
            recommendedAction: true,
            sopEvaluations: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                id: true,
                score: true,
                rating: true,
                categoryScoresJson: true,
                mandatoryFailuresJson: true,
                redFlagsJson: true,
                missingRequirementsJson: true,
                recommendation: true,
                explanation: true,
                createdAt: true,
              },
            },
            researchReports: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                id: true,
                provider: true,
                status: true,
                summary: true,
                verifiedFactsJson: true,
                unverifiedClaimsJson: true,
                inconsistenciesJson: true,
                redFlagsJson: true,
                sourcesJson: true,
                confidence: true,
                errorMessage: true,
                createdAt: true,
              },
            },
            aiRuns: {
              where: { runType: "deal_packet" },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                id: true,
                provider: true,
                model: true,
                promptVersion: true,
                status: true,
                confidence: true,
                outputJson: true,
                errorMessage: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    if (!submission) {
      throw new NotFoundException("Submission not found");
    }

    const auditLogs = submission.deal
      ? await this.prisma.auditLog.findMany({
          where: {
            organizationId,
            entityType: "Deal",
            entityId: submission.deal.id,
            action: { not: "deal.status_changed" },
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            action: true,
            actorUserId: true,
            afterJson: true,
            createdAt: true,
          },
        })
      : [];

    const answers = asRecord(submission.rawAnswersJson);

    return {
      ...submission,
      deal: submission.deal
        ? {
            ...submission.deal,
            timeline: [
              ...submission.deal.statusHistory.map((event) => ({
                id: event.id,
                type: "status_change" as const,
                label: `${event.fromStatus ?? "created"} -> ${event.toStatus}`,
                detail: event.reason,
                actorUserId: event.changedByUserId,
                createdAt: event.createdAt,
              })),
              ...auditLogs.map((event) => ({
                id: event.id,
                type: "audit" as const,
                label: event.action,
                detail: event.afterJson,
                actorUserId: event.actorUserId,
                createdAt: event.createdAt,
              })),
            ].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()),
            researchReviews: auditLogs
              .filter((event) => event.action === "research.evidence_reviewed")
              .flatMap((event) => {
                const detail = asRecord(event.afterJson);
                return typeof detail.reportId === "string" &&
                  typeof detail.sourceId === "string" &&
                  typeof detail.decision === "string"
                  ? [{
                      id: event.id,
                      reportId: detail.reportId,
                      sourceId: detail.sourceId,
                      decision: detail.decision,
                      note: typeof detail.note === "string" ? detail.note : null,
                      actorUserId: event.actorUserId,
                      createdAt: event.createdAt,
                    }]
                  : [];
              }),
          }
        : null,
      title: deriveSubmissionTitle(
        answers,
        submission.intakeSession.applicantEmail,
      ),
    };
  }

  async reviewDeal(
    organizationId: string,
    reviewerUserId: string,
    submissionId: string,
    input: { action?: string; note?: string },
  ) {
    if (
      input.action !== "accept" &&
      input.action !== "reject" &&
      input.action !== "request_information" &&
      input.action !== "manual_review"
    ) {
      throw new BadRequestException("Unsupported review action");
    }

    const submission = await this.prisma.intakeSubmission.findFirst({
      where: { id: submissionId, organizationId },
      select: { id: true, deal: { select: { id: true, status: true } } },
    });

    if (!submission?.deal) {
      throw new NotFoundException("Deal not found");
    }

    if (input.action === "accept") {
      const report = await this.prisma.researchReport.findFirst({
        where: { organizationId, dealId: submission.deal.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, sourcesJson: true },
      });
      const sourceIds = report?.status === "completed" && Array.isArray(report.sourcesJson)
        ? report.sourcesJson.flatMap((source) => (
            source && typeof source === "object" && !Array.isArray(source) &&
            typeof (source as Record<string, unknown>).sourceId === "string"
              ? [(source as Record<string, unknown>).sourceId as string]
              : []
          ))
        : [];
      if (report && sourceIds.length > 0) {
        const reviewAudits = await this.prisma.auditLog.findMany({
          where: {
            organizationId,
            entityType: "Deal",
            entityId: submission.deal.id,
            action: "research.evidence_reviewed",
          },
          orderBy: { createdAt: "desc" },
          select: { afterJson: true },
        });
        const latestDecisions = new Map<string, string>();
        for (const audit of reviewAudits) {
          const detail = asRecord(audit.afterJson);
          if (detail.reportId !== report.id || typeof detail.sourceId !== "string" || typeof detail.decision !== "string") continue;
          if (!latestDecisions.has(detail.sourceId)) latestDecisions.set(detail.sourceId, detail.decision);
        }
        const pending = sourceIds.filter((sourceId) => !latestDecisions.has(sourceId));
        if (pending.length > 0) {
          throw new BadRequestException("Review every research source before accepting this deal");
        }
        if (sourceIds.some((sourceId) => latestDecisions.get(sourceId) === "follow_up")) {
          throw new BadRequestException("Resolve research follow-up decisions before accepting this deal");
        }
      }
    }

    return this.dealsService.review({
      organizationId,
      dealId: submission.deal.id,
      reviewerUserId,
      action: input.action,
      note: input.note,
    });
  }

  async reviewResearchEvidence(
    organizationId: string,
    reviewerUserId: string,
    submissionId: string,
    input: { reportId?: string; sourceId?: string; decision?: string; note?: string },
  ) {
    if (!input.reportId || !input.sourceId) {
      throw new BadRequestException("Research report and source are required");
    }
    if (input.decision !== "confirmed" && input.decision !== "dismissed" && input.decision !== "follow_up") {
      throw new BadRequestException("Unsupported evidence decision");
    }
    const note = input.note?.trim() || "";
    if (input.decision === "dismissed" && !note) {
      throw new BadRequestException("A dismissal reason is required");
    }

    const submission = await this.prisma.intakeSubmission.findFirst({
      where: { id: submissionId, organizationId },
      select: { deal: { select: { id: true } } },
    });
    if (!submission?.deal) throw new NotFoundException("Deal not found");

    const report = await this.prisma.researchReport.findFirst({
      where: { id: input.reportId, organizationId, dealId: submission.deal.id },
      select: { id: true, sourcesJson: true },
    });
    if (!report) throw new NotFoundException("Research report not found");

    const sources = Array.isArray(report.sourcesJson) ? report.sourcesJson : [];
    const sourceExists = sources.some((source) => (
      source && typeof source === "object" && !Array.isArray(source) &&
      (source as Record<string, unknown>).sourceId === input.sourceId
    ));
    if (!sourceExists) throw new BadRequestException("Source does not belong to the research report");

    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorUserId: reviewerUserId,
        action: "research.evidence_reviewed",
        entityType: "Deal",
        entityId: submission.deal.id,
        afterJson: {
          dealId: submission.deal.id,
          reportId: report.id,
          sourceId: input.sourceId,
          decision: input.decision,
          note: note || null,
        } as Prisma.InputJsonValue,
      },
    });

    const reevaluationJob = await this.jobs.enqueue({
      organizationId,
      type: "sop.evaluate",
      payload: { dealId: submission.deal.id },
    });

    return { reportId: report.id, sourceId: input.sourceId, decision: input.decision, reevaluationJob };
  }

  async rerunResearch(
    organizationId: string,
    reviewerUserId: string,
    submissionId: string,
  ) {
    const submission = await this.prisma.intakeSubmission.findFirst({
      where: { id: submissionId, organizationId },
      select: {
        deal: {
          select: {
            id: true,
            organizationId: true,
            researchReports: {
              where: { status: { in: ["queued", "running"] } },
              select: { id: true, status: true },
              take: 1,
            },
          },
        },
      },
    });
    if (!submission?.deal) throw new NotFoundException("Deal not found");
    if (submission.deal.researchReports.length > 0) {
      throw new BadRequestException("Research is already queued or running");
    }

    const report = await this.prisma.researchReport.create({
      data: {
        organizationId,
        dealId: submission.deal.id,
        provider: "tavily",
        status: "queued",
      },
      select: { id: true, status: true, createdAt: true },
    });

    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorUserId: reviewerUserId,
        action: "research.rerun_requested",
        entityType: "Deal",
        entityId: submission.deal.id,
        afterJson: {
          dealId: submission.deal.id,
          reportId: report.id,
          reason: "reviewer_requested",
        } as Prisma.InputJsonValue,
      },
    });

    try {
      const job = await this.jobs.enqueue({
        organizationId,
        type: "research.collect",
        payload: { researchReportId: report.id, dealId: submission.deal.id },
      });
      return { report, job };
    } catch (error) {
      await this.prisma.researchReport.update({
        where: { id: report.id },
        data: {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "Queue error",
        },
      });
      throw error;
    }
  }
}
