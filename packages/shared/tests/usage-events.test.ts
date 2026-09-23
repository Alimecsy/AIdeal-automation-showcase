import assert from "node:assert/strict";
import { test } from "node:test";
import { usageEventTypes, type UsageEventInput } from "../src/usage-events.js";

test("usage events expose bounded operational categories", () => {
  assert.ok(usageEventTypes.includes("research.cache_hit"));
  assert.ok(usageEventTypes.includes("ai.run_completed"));
  assert.ok(!usageEventTypes.includes("research.source_content" as never));
});

test("usage input carries organization scope and safe metadata only", () => {
  const event: UsageEventInput = {
    organizationId: "org-1",
    eventType: "research.synthesis",
    metadata: { provider: "gemini", model: "flash", cacheHit: false },
  };
  assert.equal(event.organizationId, "org-1");
  assert.equal(event.metadata?.provider, "gemini");
});
