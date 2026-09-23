import assert from "node:assert/strict";
import { test } from "node:test";
import { NotificationsService } from "../src/modules/notifications/notifications.service";

const event = {
  eventId: "evt-1",
  schemaVersion: 1 as const,
  eventType: "research.follow_up_required" as const,
  organizationId: "org-1",
  occurredAt: "2026-07-29T00:00:00.000Z",
  dedupeKey: "org-1:research:report-1:follow-up",
  priority: "high" as const,
  actor: { type: "system" as const, service: "worker" },
  payload: { researchReportId: "report-1", dealId: "deal-1", followUpCount: 2 },
};

function workspace(role: "analyst" | "reviewer" = "reviewer") {
  return {
    organization: { id: "org-1", name: "Org", slug: "org" },
    membership: { role, status: "active" },
    user: { id: "user-1", clerkUserId: "clerk-1", email: "a@example.com", name: "A" },
  } as never;
}

test("publishes a notification with event identity and deal link", async () => {
  let data: Record<string, unknown> | undefined;
  const prisma = {
    notification: {
      create: async ({ data: input }: { data: Record<string, unknown> }) => {
        data = input;
        return { id: "notification-1", ...input };
      },
    },
  };
  const service = new NotificationsService(prisma as never);
  const result = await service.publish(event);

  assert.equal(result.duplicate, false);
  assert.equal(data?.organizationId, "org-1");
  assert.equal(data?.dedupeKey, event.dedupeKey);
  assert.equal(data?.dealId, "deal-1");
  assert.equal(data?.type, "research.follow_up_required");
});

test("treats a unique-key collision as an idempotent duplicate", async () => {
  const prisma = {
    notification: {
      create: async () => { throw Object.assign(new Error("duplicate"), { code: "P2002" }); },
    },
  };
  const service = new NotificationsService(prisma as never);
  assert.deepEqual(await service.publish(event), { duplicate: true });
});

test("enqueue writes an immutable organization-scoped intent and deduplicates it", async () => {
  const writes: Record<string, unknown>[] = [];
  const transaction = {
    notificationOutbox: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data);
        return { id: "outbox-1" };
      },
    },
  };
  const service = new NotificationsService({} as never);

  assert.deepEqual(await service.enqueue(transaction as never, event), { duplicate: false });
  assert.deepEqual(writes[0], {
    organizationId: "org-1",
    eventId: "evt-1",
    dedupeKey: "org-1:research:report-1:follow-up",
    eventType: "research.follow_up_required",
    schemaVersion: 1,
    priority: "high",
    actorJson: { type: "system", service: "worker" },
    payloadJson: { researchReportId: "report-1", dealId: "deal-1", followUpCount: 2 },
    occurredAt: new Date("2026-07-29T00:00:00.000Z"),
  });

  transaction.notificationOutbox.create = async () => {
    throw Object.assign(new Error("duplicate"), { code: "P2002" });
  };
  assert.deepEqual(await service.enqueue(transaction as never, event), { duplicate: true });
});

test("filters organization and user scope, and hides review events from analysts", async () => {
  let query: Record<string, unknown> | undefined;
  const prisma = {
    notification: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        query = where;
        return [
          { id: "public", type: "research.completed" },
          { id: "review", type: "review.recommendation_recalculated" },
        ];
      },
    },
  };
  const service = new NotificationsService(prisma as never);
  const visible = await service.list(workspace("analyst"));

  assert.equal(query?.organizationId, "org-1");
  assert.deepEqual(query?.OR, [{ userId: null }, { userId: "user-1" }]);
  assert.deepEqual(visible.map((item: { id: string }) => item.id), ["public"]);
});

test("mark-read is constrained to the current organization and user visibility", async () => {
  let query: Record<string, unknown> | undefined;
  const prisma = {
    notification: {
      updateMany: async ({ where }: { where: Record<string, unknown> }) => {
        query = where;
        return { count: 1 };
      },
    },
  };
  const service = new NotificationsService(prisma as never);
  await service.markRead(workspace(), "notification-1");

  assert.equal(query?.organizationId, "org-1");
  assert.equal(query?.id, "notification-1");
  assert.deepEqual(query?.OR, [{ userId: null }, { userId: "user-1" }]);
});
