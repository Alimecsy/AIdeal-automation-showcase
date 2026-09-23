import assert from "node:assert/strict";
import { test } from "node:test";
import { PublicRateLimitService } from "../src/modules/intake-forms/public-rate-limit.service";

test("public rate limiter rejects requests after the configured local window limit", async () => {
  const limiter = new PublicRateLimitService();
  Object.defineProperty(limiter, "redis", { value: null });
  await limiter.assertAllowed("test", "client-1", 2, 60);
  await limiter.assertAllowed("test", "client-1", 2, 60);
  await assert.rejects(
    limiter.assertAllowed("test", "client-1", 2, 60),
    /Too many requests/,
  );
});

test("public rate limiter keeps identities isolated", async () => {
  const limiter = new PublicRateLimitService();
  Object.defineProperty(limiter, "redis", { value: null });
  await limiter.assertAllowed("test", "client-1", 1, 60);
  await limiter.assertAllowed("test", "client-2", 1, 60);
});
