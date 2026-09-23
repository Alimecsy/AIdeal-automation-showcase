import assert from "node:assert/strict";
import { test } from "node:test";
import { publishWorkerNotification } from "../src/notifications";

const event = {
  eventId: "evt-research-1",
  schemaVersion: 1 as const,
  eventType: "research.follow_up_required" as const,
  organizationId: "org-1",
  occurredAt: "2026-07-29T00:00:00.000Z",
  dedupeKey: "org-1:research.follow_up_required:report-1",
  priority: "high" as const,
  actor: { type: "system" as const, service: "worker" },
  payload: {
    researchReportId: "report-1",
    dealId: "deal-1",
    followUpCount: 2,
  },
};

test("persists worker notification intent with organization and dedupe scope", async () => {
  let data: Record<string, unknown> | undefined;
  const prisma = {
    notificationOutbox: {
      create: async ({ data: input }: { data: Record<string, unknown> }) => {
        data = input;
        return { id: "notification-1" };
      },
    },
  };

  const result = await publishWorkerNotification(prisma as never, event);

  assert.deepEqual(result, { duplicate: false });
  assert.equal(data?.organizationId, "org-1");
  assert.deepEqual(data?.payloadJson, event.payload);
  assert.equal(data?.eventId, "evt-research-1");
  assert.equal(data?.dedupeKey, event.dedupeKey);
  assert.equal(data?.eventType, "research.follow_up_required");
});

test("treats a notification unique-key collision as a duplicate", async () => {
  const prisma = {
    notificationOutbox: {
      create: async () => { throw Object.assign(new Error("duplicate"), { code: "P2002" }); },
    },
  };

  assert.deepEqual(await publishWorkerNotification(prisma as never, event), { duplicate: true });
});

test("propagates outbox write failures so work is retried", async () => {
  const prisma = {
    notificationOutbox: {
      create: async () => { throw new Error("database unavailable"); },
    },
  };

  await assert.rejects(publishWorkerNotification(prisma as never, event), /database unavailable/);
});
