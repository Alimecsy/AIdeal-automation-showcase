import assert from "node:assert/strict";
import { test } from "node:test";
import { IntakeFormsService } from "../src/modules/intake-forms/intake-forms.service";

test("submitting an already finalized public session returns its original submission without side effects", async () => {
  const calls: string[] = [];
  const originalSubmission = {
    id: "submission-1",
    status: "submitted",
    submittedAt: new Date("2026-08-04T12:00:00.000Z"),
  };
  const prisma = {
    intakeSession: {
      findFirst: async () => ({
        id: "session-1",
        organizationId: "org-1",
        intakeFormId: "form-1",
        status: "submitted",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    },
    intakeSubmission: {
      findUnique: async () => {
        calls.push("findSubmission");
        return originalSubmission;
      },
    },
    intakeForm: {
      findUnique: async () => {
        calls.push("findForm");
        throw new Error("finalized retries must not recreate workflow state");
      },
    },
  };
  (prisma as { $transaction?: (callback: (tx: typeof prisma) => Promise<unknown>) => Promise<unknown> }).$transaction = async (callback) => callback(prisma);
  const jobs = { enqueue: async () => { calls.push("enqueue"); } };
  const deals = { upsertForSubmission: async () => { calls.push("upsertDeal"); } };
  const usage = { record: () => { calls.push("recordUsage"); } };
  const service = new IntakeFormsService(
    prisma as never,
    {} as never,
    jobs as never,
    deals as never,
    usage as never,
  );

  const result = await service.submitPublicSession("session-token", {
    applicantEmail: "applicant@example.com",
    answersJson: { legalName: "Acme" },
  });

  assert.deepEqual(result, { submission: originalSubmission });
  assert.deepEqual(calls, ["findSubmission"]);
});

test("a concurrent public submission that loses the unique submission race returns the winner without jobs", async () => {
  const calls: string[] = [];
  const originalSubmission = {
    id: "submission-1",
    status: "submitted",
    submittedAt: new Date("2026-08-04T12:00:00.000Z"),
  };
  const prisma = {
    intakeSession: {
      findFirst: async () => ({
        id: "session-1",
        organizationId: "org-1",
        intakeFormId: "form-1",
        status: "draft",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    },
    intakeForm: {
      findUnique: async () => ({
        id: "form-1",
        organizationId: "org-1",
        documentRequirementsJson: [],
        sopTemplate: { dealTypeId: "deal-type-1" },
      }),
    },
    applicant: {
      findFirst: async () => ({ id: "applicant-1" }),
      update: async () => ({ id: "applicant-1" }),
    },
    intakeSubmission: {
      create: async () => {
        calls.push("createSubmission");
        throw { code: "P2002" };
      },
      findUnique: async () => {
        calls.push("findWinner");
        return originalSubmission;
      },
    },
  };
  (prisma as { $transaction?: (callback: (tx: typeof prisma) => Promise<unknown>) => Promise<unknown> }).$transaction = async (callback) => callback(prisma);
  const jobs = { enqueue: async () => { calls.push("enqueue"); } };
  const deals = { upsertForSubmission: async () => { calls.push("upsertDeal"); } };
  const service = new IntakeFormsService(
    prisma as never,
    {} as never,
    jobs as never,
    deals as never,
  );

  const result = await service.submitPublicSession("session-token", {
    applicantEmail: "applicant@example.com",
    answersJson: {},
  });

  assert.deepEqual(result, { submission: originalSubmission });
  assert.deepEqual(calls, ["createSubmission", "findWinner"]);
});

test("public submission atomically accepts the session and creates one durable finalizer", async () => {
  const writes: string[] = [];
  const submission = { id: "submission-1", status: "submitted", submittedAt: new Date() };
  const transaction = {
    intakeSubmission: {
      create: async () => { writes.push("submission"); return submission; },
    },
    intakeSession: {
      update: async () => { writes.push("session"); return {}; },
    },
    job: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push("finalizer");
        assert.equal(data.type, "intake.finalize");
        assert.equal(data.maxAttempts, 10);
        assert.deepEqual(data.payloadJson, { submissionId: "submission-1" });
        return { id: "finalizer-1" };
      },
    },
  };
  const prisma = {
    intakeSession: {
      findFirst: async () => ({
        id: "session-1", organizationId: "org-1", intakeFormId: "form-1",
        status: "draft", expiresAt: new Date(Date.now() + 60_000),
      }),
    },
    intakeForm: {
      findUnique: async () => ({
        id: "form-1", organizationId: "org-1", documentRequirementsJson: [],
        sopTemplate: { dealTypeId: "deal-type-1" },
      }),
    },
    $transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction),
  };
  const service = new IntakeFormsService(prisma as never, {} as never, {} as never, {} as never);

  const result = await service.submitPublicSession("session-token", {
    applicantEmail: "applicant@example.com", answersJson: { legalName: "Acme" },
  });

  assert.deepEqual(result, { submission });
  assert.deepEqual(writes, ["submission", "session", "finalizer"]);
});
