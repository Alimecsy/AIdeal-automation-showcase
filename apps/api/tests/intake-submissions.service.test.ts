import assert from "node:assert/strict";
import { test } from "node:test";
import { IntakeSubmissionsService } from "../src/modules/intake-submissions/intake-submissions.service";

function makeSubmission(status = "submitted") {
  return {
    id: "submission-1",
    applicantId: null,
    companyId: null,
    status,
    submittedAt: new Date("2026-07-26T00:00:00.000Z"),
    rawAnswersJson: { companyName: "Acme Holdings", requestType: "Trade finance" },
    applicant: null,
    company: { id: "company-1", legalName: "Acme Holdings", jurisdiction: "NG", website: null, registrationNumber: null },
    intakeSession: { applicantEmail: "review@acme.test" },
    intakeForm: { id: "form-1", name: "Trade intake", sopTemplate: { name: "Trade SOP", dealType: { name: "Trade finance" } } },
    deal: {
      id: "deal-1",
      status: "review_ready",
      currentRating: "B",
      confidence: "medium",
      sopEvaluations: [{ missingRequirementsJson: [] }],
      researchReports: [{ id: "report-1", status: "completed", sourcesJson: [] }],
      documents: [{ status: "analyzed" }],
    },
  };
}

test("listSubmissions scopes status and search filters and exposes deal status", async () => {
  let args: unknown;
  const prisma = {
    intakeSubmission: {
      findMany: async (input: unknown) => {
        args = input;
        return [makeSubmission()];
      },
    },
    auditLog: { findMany: async () => [] },
  };
  const service = new IntakeSubmissionsService(prisma as never, {} as never, {} as never);

  const result = await service.listSubmissions("org-1", {
    status: "review_ready",
    query: " acme ",
  });

  assert.deepEqual((args as { where: unknown }).where, {
    organizationId: "org-1",
    deal: { is: { status: "review_ready" } },
    OR: [
      { intakeSession: { applicantEmail: { contains: "acme", mode: "insensitive" } } },
      { company: { legalName: { contains: "acme", mode: "insensitive" } } },
    ],
  });
  assert.equal(result.items[0]?.status, "review_ready");
  assert.equal(result.items[0]?.title, "Acme Holdings");
  assert.deepEqual(result.pagination, { page: 1, pageSize: 25, total: 1, totalPages: 1 });
});

test("listSubmissions derives review signals and applies paginated queue filters", async () => {
  const first = makeSubmission();
  first.submittedAt = new Date();
  first.deal = {
    ...first.deal,
    currentRating: "C",
    confidence: "low",
    sopEvaluations: [{ missingRequirementsJson: ["proof_of_funds"] }],
  };
  const prisma = {
    intakeSubmission: { findMany: async () => [first] },
      auditLog: {
      findMany: async (input: { where: { organizationId: string; entityId: { in: string[] } } }) => {
        assert.equal(input.where.organizationId, "org-1");
        assert.deepEqual(input.where.entityId.in, ["deal-1"]);
        return [{ entityId: "deal-1", afterJson: { sourceId: "source-1", decision: "follow_up" } }];
      },
    },
  };
  const service = new IntakeSubmissionsService(prisma as never, {} as never, {} as never);

  const result = await service.listSubmissions("org-1", {
    rating: "C",
    confidence: "low",
    researchFollowUp: "required",
    missingDocuments: "required",
    page: "1",
    pageSize: "1",
  });

  assert.equal(result.pagination.total, 1);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0]?.prioritySignals, ["research_follow_up", "missing_documents", "low_confidence"]);
});

test("queue follow-up signal reflects the latest decision for each source", async () => {
  const prisma = {
    intakeSubmission: { findMany: async () => [makeSubmission()] },
    auditLog: {
      findMany: async () => [
        { entityId: "deal-1", afterJson: { sourceId: "source-1", decision: "follow_up" } },
        { entityId: "deal-1", afterJson: { sourceId: "source-1", decision: "confirmed" } },
      ],
    },
  };
  const service = new IntakeSubmissionsService(prisma as never, {} as never, {} as never);
  const result = await service.listSubmissions("org-1", { researchFollowUp: "clear" });

  assert.equal(result.items[0]?.researchFollowUp, false);
});

test("getSubmission returns a newest-first timeline without duplicating status audits", async () => {
  const submission = {
    ...makeSubmission(),
    deal: {
      id: "deal-1",
      title: "Acme Holdings",
      status: "review_ready",
      statusHistory: [
        {
          id: "history-1",
          fromStatus: "processing",
          toStatus: "review_ready",
          changedByUserId: null,
          reason: "Packet completed",
          createdAt: new Date("2026-07-26T02:00:00.000Z"),
        },
      ],
      documents: [],
      currentRating: null,
      currentScore: null,
      confidence: null,
      recommendedAction: null,
      aiRuns: [],
    },
  };
  const prisma = {
    intakeSubmission: { findFirst: async () => submission },
    auditLog: {
      findMany: async () => [
        {
          id: "audit-1",
          action: "deal.assigned",
          actorUserId: "user-1",
          afterJson: { assignee: "user-1" },
          createdAt: new Date("2026-07-26T03:00:00.000Z"),
        },
      ],
    },
  };
  const service = new IntakeSubmissionsService(prisma as never, {} as never, {} as never);

  const result = await service.getSubmission("org-1", "submission-1");

  assert.deepEqual(result.deal?.timeline.map((event) => event.id), ["audit-1", "history-1"]);
  assert.equal(result.deal?.timeline[0]?.type, "audit");
  assert.equal(result.deal?.timeline[1]?.label, "processing -> review_ready");
});

test("research evidence review validates source ownership and records an audit event", async () => {
  let audit: unknown;
  const prisma = {
    intakeSubmission: {
      findFirst: async () => ({ deal: { id: "deal-1" } }),
    },
    researchReport: {
      findFirst: async () => ({
        id: "report-1",
        sourcesJson: [{ sourceId: "source-1", title: "Registry", url: "https://example.test" }],
      }),
    },
    auditLog: {
      create: async ({ data }: { data: unknown }) => { audit = data; },
    },
  };
  const jobs = { enqueue: async () => ({ id: "job-1", type: "sop.evaluate" }) };
  const service = new IntakeSubmissionsService(prisma as never, {} as never, jobs as never);

  const result = await service.reviewResearchEvidence("org-1", "reviewer-1", "submission-1", {
    reportId: "report-1",
    sourceId: "source-1",
    decision: "confirmed",
    note: "Registry record checked",
  });

  assert.deepEqual(result, {
    reportId: "report-1",
    sourceId: "source-1",
    decision: "confirmed",
    reevaluationJob: { id: "job-1", type: "sop.evaluate" },
  });
  assert.deepEqual(audit, {
    organizationId: "org-1",
    actorUserId: "reviewer-1",
    action: "research.evidence_reviewed",
    entityType: "Deal",
    entityId: "deal-1",
    afterJson: {
      dealId: "deal-1",
      reportId: "report-1",
      sourceId: "source-1",
      decision: "confirmed",
      note: "Registry record checked",
    },
  });
});

test("acceptance is blocked while research evidence needs follow-up", async () => {
  const prisma = {
    intakeSubmission: { findFirst: async () => ({ deal: { id: "deal-1", status: "review_ready" } }) },
    researchReport: {
      findFirst: async () => ({
        id: "report-1",
        status: "completed",
        sourcesJson: [{ sourceId: "source-1" }, { sourceId: "source-2" }],
      }),
    },
    auditLog: {
      findMany: async () => [
        { afterJson: { reportId: "report-1", sourceId: "source-1", decision: "confirmed" } },
        { afterJson: { reportId: "report-1", sourceId: "source-2", decision: "follow_up" } },
      ],
    },
  };
  const service = new IntakeSubmissionsService(prisma as never, {} as never, {} as never);

  await assert.rejects(
    service.reviewDeal("org-1", "reviewer-1", "submission-1", { action: "accept" }),
    /Resolve research follow-up decisions/,
  );
});
