import assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { IntakeSubmissionsService } from "../src/modules/intake-submissions/intake-submissions.service";

function makeService() {
  const calls = { audits: [] as unknown[], reports: [] as unknown[], jobs: [] as unknown[] };
  const prisma = {
    intakeSubmission: {
      findFirst: async () => ({
        deal: {
          id: "deal-1",
          organizationId: "org-1",
          researchReports: [],
        },
      }),
    },
    researchReport: {
      findFirst: async () => ({
        id: "report-1",
        sourcesJson: [{ sourceId: "source-1", url: "https://example.test" }],
      }),
      create: async ({ data }: { data: unknown }) => {
        calls.reports.push(data);
        return { id: "report-2", status: "queued", createdAt: new Date("2026-07-29T00:00:00.000Z") };
      },
      update: async () => undefined,
    },
    auditLog: {
      create: async ({ data }: { data: unknown }) => calls.audits.push(data),
    },
  };
  const jobs = {
    enqueue: async (input: unknown) => {
      calls.jobs.push(input);
      return { id: "job-2", type: "research.collect", status: "queued" };
    },
  };
  return {
    service: new IntakeSubmissionsService(prisma as never, {} as never, jobs as never),
    calls,
  };
}

test("dismissed research evidence requires a non-empty auditable reason", async () => {
  const { service, calls } = makeService();

  await assert.rejects(
    service.reviewResearchEvidence("org-1", "reviewer-1", "submission-1", {
      reportId: "report-1",
      sourceId: "source-1",
      decision: "dismissed",
      note: "   ",
    }),
    (error: unknown) => error instanceof BadRequestException && error.message === "A dismissal reason is required",
  );

  assert.equal(calls.audits.length, 0);
  assert.equal(calls.jobs.length, 0);
});

test("research rerun creates a queued report, audit entry, and asynchronous job", async () => {
  const { service, calls } = makeService();

  const result = await service.rerunResearch("org-1", "reviewer-1", "submission-1");

  assert.equal(result.report.status, "queued");
  assert.deepEqual(calls.reports[0], {
    organizationId: "org-1",
    dealId: "deal-1",
    provider: "tavily",
    status: "queued",
  });
  assert.deepEqual(calls.audits[0], {
    organizationId: "org-1",
    actorUserId: "reviewer-1",
    action: "research.rerun_requested",
    entityType: "Deal",
    entityId: "deal-1",
    afterJson: {
      dealId: "deal-1",
      reportId: "report-2",
      reason: "reviewer_requested",
    },
  });
  assert.deepEqual(calls.jobs[0], {
    organizationId: "org-1",
    type: "research.collect",
    payload: { researchReportId: "report-2", dealId: "deal-1" },
  });
});
