import assert from "node:assert/strict";
import { test } from "node:test";
import { env } from "@aideal/env";
import { hasNewerActiveSopEvaluation, JobProcessor, renewJobLease, retryDelayMs } from "../src/job-processor";

function makeJob(type: string, status: "queued" | "completed" | "running" = "queued", attempts = 0) {
  return {
    id: `job-${type}`,
    organizationId: "org-1",
    type,
    payloadJson: {},
    status,
    attempts,
    maxAttempts: 3,
    errorMessage: null,
    availableAt: new Date("2026-07-25T00:00:00.000Z"),
    leaseExpiresAt: null,
    leaseToken: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date("2026-07-26T00:00:00.000Z"),
    updatedAt: new Date("2026-07-26T00:00:00.000Z"),
  };
}

function makeProcessor(job: ReturnType<typeof makeJob>) {
  const updates: unknown[] = [];
  const messages: unknown[] = [];
  const prisma = {
    notificationOutbox: {
      create: async () => ({ id: "outbox-1" }),
    },
    job: {
      findUnique: async () => job,
      findFirst: async () => job.status === "queued" && job.availableAt <= new Date() ? { id: job.id } : null,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const now = new Date();
        const isRecovery = data.errorMessage === "Worker lease expired; requeued for recovery";
        if (isRecovery) {
          const legacyExpired = job.status === "running" && !job.leaseExpiresAt && (!job.startedAt || job.startedAt <= new Date(now.getTime() - 5 * 60_000));
          const leaseExpired = job.status === "running" && Boolean(job.leaseExpiresAt && job.leaseExpiresAt <= now);
          if (!legacyExpired && !leaseExpired) return { count: 0 };
          updates.push(data);
          Object.assign(job, data);
          return { count: 1 };
        }
        const hasEligibleState = !where.OR || (where.OR as Array<Record<string, unknown>>).some((candidate) => {
          if (candidate.status === "queued") return job.status === "queued" && job.availableAt <= now;
          return job.status === "running" && Boolean(job.leaseExpiresAt && job.leaseExpiresAt <= now);
        });
        if (where.status && job.status !== where.status) return { count: 0 };
        if (where.leaseToken && job.leaseToken !== where.leaseToken) return { count: 0 };
        if (where.availableAt && job.availableAt > now) return { count: 0 };
        if (!hasEligibleState) return { count: 0 };
        if (data.attempts && typeof data.attempts === "object" && "increment" in data.attempts) {
          job.attempts += (data.attempts as { increment: number }).increment;
        }
        updates.push(data);
        const { attempts: _attempts, ...fields } = data;
        Object.assign(job, fields);
        return { count: 1 };
      },
    },
  };

  return { processor: new JobProcessor(prisma as never), prisma, updates, messages };
}

test("completed and running jobs are idempotent and are not processed again", async () => {
  const completed = makeProcessor(makeJob("test.success", "completed"));
  const running = makeProcessor(makeJob("test.success", "running"));

  await completed.processor.process("job-test.success");
  await running.processor.process("job-test.success");

  assert.equal(completed.updates.length, 0);
  assert.equal(running.updates.length, 0);
});

test("successful jobs transition to completed", async () => {
  const { processor, updates } = makeProcessor(makeJob("test.success"));

  await processor.process("job-test.success");

  assert.equal(updates.length, 2);
  assert.equal((updates[0] as { status: string }).status, "running");
  assert.deepEqual(updates[1], {
    status: "completed",
    completedAt: updates[1] && (updates[1] as { completedAt: Date }).completedAt,
    leaseExpiresAt: null,
    leaseToken: null,
  });
});

test("failed jobs are requeued with exponential backoff before max attempts", async () => {
  const { processor, updates, messages } = makeProcessor(makeJob("test.failure"));

  await processor.process("job-test.failure");

  assert.equal(updates.length, 2);
  assert.equal((updates[0] as { status: string }).status, "running");
  assert.equal((updates[1] as { status: string }).status, "queued");
  assert.equal((updates[1] as { errorMessage: string }).errorMessage, "Intentional test job failure");
  assert.equal(messages.length, 0);
  assert.ok((updates[1] as { availableAt: Date }).availableAt >= new Date());
  assert.equal(retryDelayMs(1), 1_000);
  assert.equal(retryDelayMs(3), 4_000);
});

test("exhausted jobs persist the terminal failure state", async () => {
  const { processor, updates, messages } = makeProcessor(makeJob("unknown.job", "queued", 2));

  await processor.process("job-unknown.job");

  assert.equal(updates.length, 2);
  assert.equal((updates[0] as { status: string }).status, "running");
  assert.equal((updates[1] as { status: string }).status, "failed");
  assert.match((updates[1] as { errorMessage: string }).errorMessage,
    /Unsupported job type: unknown\.job/,
  );
  assert.equal(messages.length, 0);
});

test("only one worker can claim an eligible job", async () => {
  const job = makeJob("test.success");
  const first = makeProcessor(job);
  const second = makeProcessor(job);

  await Promise.all([first.processor.process(job.id), second.processor.process(job.id)]);

  assert.equal(job.attempts, 1);
  assert.equal(first.updates.length + second.updates.length, 2);
  assert.equal(job.status, "completed");
});

test("an expired lease is recovered and claimed by the next worker", async () => {
  const job = makeJob("test.success", "running", 1);
  job.leaseToken = "crashed-worker";
  job.leaseExpiresAt = new Date("2026-07-25T00:00:00.000Z");
  const { processor, updates } = makeProcessor(job);

  await processor.recoverExpiredLeases();
  await processor.process(job.id);

  assert.equal(job.attempts, 2);
  assert.equal(job.status, "completed");
  const claim = updates.find((update) => Boolean((update as { attempts?: unknown }).attempts)) as { leaseToken: string };
  assert.equal(claim.leaseToken.length > 0, true);
});

test("legacy running jobs without a lease are requeued after the cutover grace window", async () => {
  const job = makeJob("test.success", "running", 1);
  job.startedAt = new Date("2026-07-25T00:00:00.000Z");
  const { processor } = makeProcessor(job);

  const recovered = await processor.recoverExpiredLeases(new Date("2026-07-26T00:00:00.000Z"));

  assert.equal(recovered, 1);
  assert.equal(job.status, "queued");
  assert.equal(job.leaseToken, null);
});

test("heartbeat cannot renew a stale worker lease", async () => {
  const job = makeJob("test.success", "running", 1);
  job.leaseToken = "current-token";
  job.leaseExpiresAt = new Date("2026-07-26T00:05:00.000Z");
  const { processor, prisma } = makeProcessor(job);

  const renewed = await renewJobLease(prisma as never, {
    ...job,
    leaseToken: "stale-token",
  });

  assert.equal(renewed, false);
  assert.equal(job.leaseToken, "current-token");
});

test("deferred work remains unclaimable until availableAt", async () => {
  const job = makeJob("test.success");
  job.availableAt = new Date(Date.now() + 60_000);
  const { processor, updates } = makeProcessor(job);

  await processor.process(job.id);

  assert.equal(updates.length, 0);
  assert.equal(job.status, "queued");
});

test("newer active SOP evaluation jobs supersede older work for the same deal", () => {
  const older = makeJob("sop.evaluate");
  older.payloadJson = { dealId: "deal-1" };
  older.createdAt = new Date("2026-07-27T00:00:00.000Z");
  const newer = makeJob("sop.evaluate");
  newer.id = "job-newer";
  newer.payloadJson = { dealId: "deal-1" };
  newer.status = "queued";
  newer.createdAt = new Date("2026-07-27T00:00:01.000Z");

  assert.equal(hasNewerActiveSopEvaluation(older, [older, newer]), true);
  assert.equal(hasNewerActiveSopEvaluation(newer, [older, newer]), false);
});

test("SOP evaluation jobs for another deal do not supersede current work", () => {
  const current = makeJob("sop.evaluate");
  current.payloadJson = { dealId: "deal-1" };
  const otherDeal = makeJob("sop.evaluate");
  otherDeal.id = "job-other";
  otherDeal.payloadJson = { dealId: "deal-2" };
  otherDeal.createdAt = new Date("2026-07-27T00:00:01.000Z");

  assert.equal(hasNewerActiveSopEvaluation(current, [current, otherDeal]), false);
});

test("AI completion routes the exact tenant-scoped deal through the injected governed transition seam", async () => {
  const job = makeJob("ai.generate");
  job.payloadJson = { aiRunId: "run-1", prompt: "prepare packet" };
  const { prisma } = makeProcessor(job);
  const transitionCalls: unknown[] = [];
  const workerPrisma = prisma as typeof prisma & {
    aiRun: { findUnique: (input: unknown) => Promise<unknown>; update: (input: unknown) => Promise<unknown> };
    deal: { findUnique: (input: unknown) => Promise<unknown> };
  };
  workerPrisma.aiRun = {
    findUnique: async () => ({
      id: "run-1",
      organizationId: "org-1",
      dealId: "deal-1",
      provider: "gemini",
      model: "test-model",
      runType: "deal_packet",
    }),
    update: async () => ({}),
  };
  // A missing active template intentionally makes SOP evaluation a no-op; this
  // keeps the test focused on the real AI-completion transition boundary.
  workerPrisma.deal = {
    findUnique: async () => ({
      id: "deal-1",
      organizationId: "org-1",
      title: "Acme",
      intakeSubmission: null,
      researchReports: [],
    }),
  };

  const priorApiKey = env.GEMINI_API_KEY;
  const priorTavilyApiKey = env.TAVILY_API_KEY;
  const priorFetch = globalThis.fetch;
  env.GEMINI_API_KEY = "test-key";
  env.TAVILY_API_KEY = undefined;
  globalThis.fetch = async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: "{\"summary\":\"done\"}" }] } }],
  }), { status: 200 });

  try {
    const processor = new JobProcessor(workerPrisma as never, {
      transitionToReviewReady: async (input) => { transitionCalls.push(input); },
    });
    await processor.process(job.id);
  } finally {
    env.GEMINI_API_KEY = priorApiKey;
    env.TAVILY_API_KEY = priorTavilyApiKey;
    globalThis.fetch = priorFetch;
  }

  assert.deepEqual(transitionCalls, [{ organizationId: "org-1", dealId: "deal-1" }]);
  assert.equal(job.status, "completed");
});

test("a lease-recovered intake finalizer uses tenant-scoped atomic entity upserts", async () => {
  const job = makeJob("intake.finalize");
  job.payloadJson = { submissionId: "submission-1" };
  const { processor, prisma } = makeProcessor(job);
  let outboxWrites = 0;
  let documentCreates = 0;
  let extractionCreates = 0;
  const transaction = {
    intakeSubmission: {
      findFirst: async ({ where }: { where: { id: string; organizationId: string } }) => {
        assert.deepEqual(where, { id: "submission-1", organizationId: "org-1" });
        return {
          id: "submission-1", organizationId: "org-1",
          rawAnswersJson: {
            companyName: "Acme", applicantEmail: "applicant@acme.test",
            __documents: [{ documentType: "financials", originalFilename: "financials.pdf", storageKey: "public-intake/org-1/session-1/financials.pdf", mimeType: "application/pdf", sizeBytes: 12 }],
          },
          intakeSession: { applicantEmail: "applicant@acme.test", status: "submitted" },
          intakeForm: { sopTemplate: { dealTypeId: "type-1" } },
          deal: { id: "deal-1", status: "processing" },
        };
      },
    },
    company: {
      upsert: async ({ where }: { where: { organizationId_legalName_identityJurisdiction: { organizationId: string; legalName: string; identityJurisdiction: string } } }) => {
        assert.deepEqual(where, {
          organizationId_legalName_identityJurisdiction: {
            organizationId: "org-1",
            legalName: "Acme",
            identityJurisdiction: "",
          },
        });
        return { id: "company-1" };
      },
    },
    applicant: {
      upsert: async ({ where }: { where: { organizationId_email: { organizationId: string; email: string } } }) => {
        assert.deepEqual(where, {
          organizationId_email: {
            organizationId: "org-1",
            email: "applicant@acme.test",
          },
        });
        return { id: "applicant-1" };
      },
    },
    deal: { upsert: async () => ({ id: "deal-1", status: "processing" }) },
    document: {
      findFirst: async () => ({ id: "document-1" }),
      create: async () => { documentCreates += 1; return { id: "document-new" }; },
    },
    documentExtraction: { create: async () => { extractionCreates += 1; return { id: "extraction-1" }; } },
    job: { create: async () => ({ id: "document-job-1" }) },
    notificationOutbox: {
      create: async () => {
        outboxWrites += 1;
        if (outboxWrites > 1) throw Object.assign(new Error("duplicate"), { code: "P2002" });
        return { id: "outbox-1" };
      },
    },
    dealStatusHistory: { create: async () => ({}) },
    auditLog: { create: async () => ({}) },
  };
  (prisma as typeof prisma & { $transaction: (callback: (tx: typeof transaction) => Promise<unknown>) => Promise<unknown> }).$transaction = async (callback) => callback(transaction);

  await processor.process(job.id);
  // Simulate process death after transaction commit but before fenced completion:
  // the recovered lease executes the finalizer again against committed rows.
  job.status = "queued";
  job.availableAt = new Date(0);
  await new JobProcessor(prisma as never).process(job.id);

  assert.equal(job.status, "completed");
  assert.equal(outboxWrites, 2);
  assert.equal(documentCreates, 0);
  assert.equal(extractionCreates, 0);
});
