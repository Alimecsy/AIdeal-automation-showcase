import assert from "node:assert/strict";
import { test } from "node:test";
import { UsageService } from "../src/modules/usage/usage.service";

test("usage summary aggregates quantities by event type", async () => {
  let created: unknown;
  const prisma = {
    usageEvent: {
      create: async (input: unknown) => { created = input; },
      findMany: async () => [
        { eventType: "ai.run_completed", quantity: 1, metadataJson: { provider: "gemini" }, createdAt: new Date("2026-07-27") },
        { eventType: "research.page_fetched", quantity: 3, metadataJson: null, createdAt: new Date("2026-07-27") },
        { eventType: "research.page_fetched", quantity: 2, metadataJson: null, createdAt: new Date("2026-07-26") },
      ],
    },
  };
  const service = new UsageService(prisma as never);
  service.record({ organizationId: "org-1", eventType: "ai.run_completed", metadata: { provider: "gemini" } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual((created as { data: Record<string, unknown> }).data, {
    organizationId: "org-1",
    eventType: "ai.run_completed",
    quantity: 1,
    relatedEntityType: undefined,
    relatedEntityId: undefined,
    metadataJson: { provider: "gemini" },
  });
  const result = await service.summary("org-1", 30);
  assert.equal(result.totalEvents, 3);
  assert.deepEqual(result.totals[0], { eventType: "research.page_fetched", count: 2, quantity: 5 });
});

test("usage recording does not throw when persistence is unavailable", () => {
  const service = new UsageService({ usageEvent: undefined } as never);
  assert.doesNotThrow(() => service.record({ organizationId: "org-1", eventType: "job.failed" }));
});
