import assert from "node:assert/strict";
import { test } from "node:test";
import { UsageRecorder } from "../src/usage";

test("worker usage recording does not block or throw on persistence failure", async () => {
  const recorder = new UsageRecorder({
    usageEvent: {
      create: async () => { throw new Error("database unavailable"); },
    },
  } as never);
  assert.doesNotThrow(() => recorder.record({ organizationId: "org-1", eventType: "job.failed", metadata: { jobType: "ai.generate" } }));
  await new Promise((resolve) => setImmediate(resolve));
});
