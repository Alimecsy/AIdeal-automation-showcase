import assert from "node:assert/strict";
import { test } from "node:test";
import { DealsService } from "../src/modules/deals/deals.service";

function makePrisma(initialStatus: "submitted" | "processing" | "review_ready" = "review_ready") {
  const calls = {
    updates: [] as unknown[],
    histories: [] as unknown[],
    audits: [] as unknown[],
  };

  const prisma = {
    deal: {
      upsert: async () => ({ id: "deal-1", status: "submitted" }),
      findFirst: async ({ where }: { where: unknown }) => {
        calls.updates.push({ lookup: where });
        return { id: "deal-1", status: initialStatus };
      },
      update: async ({ data }: { data: { status: string } }) => ({
        id: "deal-1",
        status: data.status,
        updatedAt: new Date("2026-07-26T00:00:00.000Z"),
      }),
    },
    dealStatusHistory: {
      create: async ({ data }: { data: unknown }) => {
        calls.histories.push(data);
      },
    },
    auditLog: {
      create: async ({ data }: { data: unknown }) => {
        calls.audits.push(data);
      },
    },
    $transaction: async <T>(callback: (transaction: typeof prisma) => Promise<T>) => callback(prisma),
  };

  return { prisma, calls };
}

function outboxNotifications(enqueued: unknown[]) {
  return {
    enqueue: async (_transaction: unknown, event: unknown) => {
      enqueued.push(event);
      return { duplicate: false };
    },
  };
}

test("submission upserts enqueue an organization-scoped deal-submitted intent in the domain transaction", async () => {
  const { prisma } = makePrisma();
  const enqueued: unknown[] = [];
  const service = new DealsService(prisma as never, outboxNotifications(enqueued) as never);

  await service.upsertForSubmission({
    organizationId: "org-1",
    intakeSubmissionId: "submission-1",
    title: "Acme Holdings",
    dealTypeId: "deal-type-1",
  });

  assert.equal(enqueued.length, 1);
  assert.deepEqual(enqueued[0], {
    eventId: (enqueued[0] as { eventId: string }).eventId,
    schemaVersion: 1,
    eventType: "deal.submitted",
    organizationId: "org-1",
    occurredAt: (enqueued[0] as { occurredAt: string }).occurredAt,
    dedupeKey: "org-1:deal.submitted:deal-1",
    priority: "normal",
    actor: { type: "system", service: "intake" },
    payload: { dealId: "deal-1", submissionId: "submission-1", status: "submitted" },
  });
  assert.match((enqueued[0] as { eventId: string }).eventId, /^[0-9a-f-]{36}$/i);
  assert.match((enqueued[0] as { occurredAt: string }).occurredAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("submission upserts do not re-emit submitted events for progressed deals", async () => {
  const { prisma } = makePrisma();
  prisma.deal.upsert = async () => ({ id: "deal-1", status: "processing" });
  const enqueued: unknown[] = [];
  const service = new DealsService(prisma as never, outboxNotifications(enqueued) as never);

  await service.upsertForSubmission({
    organizationId: "org-1",
    intakeSubmissionId: "submission-1",
    title: "Acme Holdings",
    dealTypeId: "deal-type-1",
  });

  assert.deepEqual(enqueued, []);
});

test("valid deal transition persists status history and audit context", async () => {
  const { prisma, calls } = makePrisma();
  const service = new DealsService(prisma as never);

  const result = await service.transition({
    organizationId: "org-1",
    dealId: "deal-1",
    toStatus: "accepted",
    actor: { userId: "user-1", actorType: "user" },
    reason: "approved after review",
  });

  assert.equal(result.status, "accepted");
  assert.equal(calls.histories.length, 1);
  assert.deepEqual(calls.histories[0], {
    dealId: "deal-1",
    fromStatus: "review_ready",
    toStatus: "accepted",
    changedByUserId: "user-1",
    reason: "approved after review",
  });
  assert.deepEqual(calls.audits[0], {
    organizationId: "org-1",
    actorUserId: "user-1",
    action: "deal.status_changed",
    entityType: "Deal",
    entityId: "deal-1",
    beforeJson: { status: "review_ready" },
    afterJson: {
      status: "accepted",
      actorType: "user",
      actorReference: null,
      reason: "approved after review",
    },
  });
});

test("invalid transition is rejected before persistence side effects", async () => {
  const { prisma, calls } = makePrisma("submitted");
  const service = new DealsService(prisma as never);

  await assert.rejects(
    service.transition({
      organizationId: "org-1",
      dealId: "deal-1",
      toStatus: "accepted",
      actor: { actorType: "system" },
    }),
    /Cannot transition deal from submitted to accepted/,
  );

  assert.equal(calls.histories.length, 0);
  assert.equal(calls.audits.length, 0);
});

test("transition to review-ready enqueues one organization-scoped intent inside its transaction", async () => {
  const { prisma } = makePrisma("processing");
  const enqueued: unknown[] = [];
  const service = new DealsService(prisma as never, outboxNotifications(enqueued) as never);

  await service.transition({
    organizationId: "org-1",
    dealId: "deal-1",
    toStatus: "review_ready",
    actor: { actorType: "system", actorReference: "worker" },
  });

  assert.equal(enqueued.length, 1);
  assert.deepEqual(enqueued[0], {
    eventId: (enqueued[0] as { eventId: string }).eventId,
    schemaVersion: 1,
    eventType: "deal.review_ready",
    organizationId: "org-1",
    occurredAt: (enqueued[0] as { occurredAt: string }).occurredAt,
    dedupeKey: "org-1:deal.review_ready:deal-1",
    priority: "normal",
    actor: { type: "system", service: "worker" },
    payload: { dealId: "deal-1", status: "review_ready" },
  });
});

test("an outbox failure aborts the deal operation instead of silently losing its lifecycle intent", async () => {
  const { prisma } = makePrisma();
  const service = new DealsService(prisma as never, {
    enqueue: async () => {
      throw new Error("outbox unavailable");
    },
  } as never);

  await assert.rejects(service.upsertForSubmission({
    organizationId: "org-1", intakeSubmissionId: "submission-1", title: "Acme Holdings", dealTypeId: "deal-type-1",
  }), /outbox unavailable/);
});

test("review actions map to governed deal transitions", async () => {
  const { prisma, calls } = makePrisma();
  const enqueued: unknown[] = [];
  const service = new DealsService(prisma as never, outboxNotifications(enqueued) as never);

  await service.review({
    organizationId: "org-1",
    dealId: "deal-1",
    reviewerUserId: "reviewer-1",
    action: "accept",
    note: "  approved  ",
  });

  assert.equal(calls.histories[0] && (calls.histories[0] as { toStatus: string }).toStatus, "accepted");
  assert.equal(calls.histories[0] && (calls.histories[0] as { reason: string }).reason, "approved");
  assert.equal((enqueued[0] as { eventType: string }).eventType, "deal.decision_recorded");
});
