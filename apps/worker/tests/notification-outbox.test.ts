import assert from "node:assert/strict";
import { test } from "node:test";
import { NOTIFICATION_OUTBOX_LEASE_MS, NotificationOutboxDispatcher } from "../src/notification-outbox";

type Row = {
  id: string; organizationId: string; eventId: string; dedupeKey: string; eventType: "deal.submitted";
  schemaVersion: number; priority: "normal"; actorJson: { type: "system"; service: string };
  payloadJson: { dealId: string; status: string }; occurredAt: Date; status: "pending" | "processing" | "delivered" | "dead_letter";
  attempts: number; availableAt: Date; lockedAt: Date | null; lockedBy: string | null; lastError: string | null; deliveredAt: Date | null; createdAt: Date;
};

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "outbox-1", organizationId: "org-1", eventId: "event-1", dedupeKey: "org-1:deal.submitted:deal-1",
    eventType: "deal.submitted", schemaVersion: 1, priority: "normal", actorJson: { type: "system", service: "intake" },
    payloadJson: { dealId: "deal-1", status: "submitted" }, occurredAt: new Date("2026-08-01T00:00:00.000Z"),
    status: "pending", attempts: 0, availableAt: new Date(0), lockedAt: null, lockedBy: null, lastError: null,
    deliveredAt: null, createdAt: new Date("2026-08-01T00:00:00.000Z"), ...overrides,
  };
}

function makePrisma(record = row(), createNotification: () => Promise<unknown> = async () => ({ id: "notification-1" })) {
  const notifications: unknown[] = [];
  const matches = (where: Record<string, unknown>) =>
    (!where.id || where.id === record.id) && (!where.status || where.status === record.status) &&
    (!where.lockedBy || where.lockedBy === record.lockedBy) &&
    (!(where.availableAt as { lte?: Date } | undefined)?.lte || record.availableAt <= (where.availableAt as { lte: Date }).lte);
  const updateMany = async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    if (!matches(where)) return { count: 0 };
    if (where.status === "processing" && (where.lockedAt as { lt?: Date } | undefined)?.lt && !(record.lockedAt && record.lockedAt < (where.lockedAt as { lt: Date }).lt)) return { count: 0 };
    if (data.attempts && typeof data.attempts === "object") record.attempts += (data.attempts as { increment: number }).increment;
    else if (typeof data.attempts === "number") record.attempts = data.attempts;
    Object.assign(record, Object.fromEntries(Object.entries(data).filter(([key]) => key !== "attempts")));
    return { count: 1 };
  };
  const prisma = {
    notificationOutbox: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => matches(where) ? { id: record.id } : null,
      findUnique: async ({ where }: { where: { id: string } }) => where.id === record.id ? record : null,
      updateMany,
    },
    notification: {
      create: async (input: unknown) => { notifications.push(input); return createNotification(); },
    },
    $transaction: async <T>(callback: (tx: typeof prisma) => Promise<T>) => callback(prisma),
  };
  return { prisma, record, notifications };
}

test("reclaims an expired processing lease but leaves an active lease untouched", async () => {
  const expired = makePrisma(row({ status: "processing", lockedBy: "crashed", lockedAt: new Date(Date.now() - NOTIFICATION_OUTBOX_LEASE_MS - 1) }));
  const dispatcher = new NotificationOutboxDispatcher(expired.prisma as never, "worker-a");
  assert.equal(await dispatcher.processNext(), true);
  assert.equal(expired.record.status, "delivered");
  assert.equal(expired.record.attempts, 1);

  const active = makePrisma(row({ status: "processing", lockedBy: "other", lockedAt: new Date() }));
  assert.equal(await new NotificationOutboxDispatcher(active.prisma as never, "worker-a").processNext(), false);
  assert.equal(active.record.status, "processing");
});

test("transient delivery failures preserve intent and schedule a retry", async () => {
  const fixture = makePrisma(row(), async () => { throw new Error("database unavailable"); });
  const dispatcher = new NotificationOutboxDispatcher(fixture.prisma as never, "worker-a");
  assert.equal(await dispatcher.processNext(), true);
  assert.equal(fixture.record.status, "pending");
  assert.equal(fixture.record.attempts, 1);
  assert.equal(fixture.record.lastError, "database unavailable");
  assert.ok(fixture.record.availableAt > new Date());
  assert.equal(fixture.record.dedupeKey, "org-1:deal.submitted:deal-1");
});

test("terminal delivery failures dead-letter and explicit replay retains event identity", async () => {
  const fixture = makePrisma(row({ attempts: 9 }), async () => { throw new Error("permanent failure"); });
  const dispatcher = new NotificationOutboxDispatcher(fixture.prisma as never, "worker-a");
  await dispatcher.processNext();
  assert.equal(fixture.record.status, "dead_letter");
  assert.equal(fixture.record.attempts, 10);
  const eventId = fixture.record.eventId;
  const dedupeKey = fixture.record.dedupeKey;
  assert.deepEqual(await dispatcher.replay(fixture.record.id), { count: 1 });
  assert.equal(fixture.record.status, "pending");
  assert.equal(fixture.record.attempts, 0);
  assert.equal(fixture.record.eventId, eventId);
  assert.equal(fixture.record.dedupeKey, dedupeKey);
});

test("duplicate notification persistence is reconciled as delivered without a second user-visible record", async () => {
  const fixture = makePrisma(row(), async () => { throw Object.assign(new Error("duplicate"), { code: "P2002" }); });
  assert.equal(await new NotificationOutboxDispatcher(fixture.prisma as never, "worker-a").processNext(), true);
  assert.equal(fixture.record.status, "delivered");
  assert.equal(fixture.record.attempts, 1);
  assert.equal(fixture.notifications.length, 1);
});
