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

test("public rate limiter sets the shared window expiry without clobbering an existing one", async () => {
  const calls: Array<[string, number, string | undefined]> = [];
  const limiter = new PublicRateLimitService();
  Object.defineProperty(limiter, "redis", {
    value: {
      incr: async () => 1,
      expire: async (key: string, seconds: number, option?: string) => {
        calls.push([key, seconds, option]);
        return 1;
      },
    },
  });

  await limiter.assertAllowed("test", "client-1", 5, 60);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 60);
  assert.equal(calls[0][2], "NX");
});

test("an unreachable shared backend degrades to local windows instead of failing the request", async () => {
  const limiter = new PublicRateLimitService();
  Object.defineProperty(limiter, "redis", {
    value: {
      incr: async () => {
        throw new Error("getaddrinfo ENOTFOUND example.upstash.test");
      },
      expire: async () => 1,
    },
  });

  // The applicant request must still be served...
  await limiter.assertAllowed("test", "client-1", 2, 60);
  await limiter.assertAllowed("test", "client-1", 2, 60);

  // ...and the local window must still enforce the limit rather than allow
  // an unbounded flood while the shared backend is down.
  await assert.rejects(
    limiter.assertAllowed("test", "client-1", 2, 60),
    /Too many requests/,
  );
});

test("a genuine shared-backend limit breach is not swallowed by the fallback", async () => {
  let incrementCount = 0;
  const limiter = new PublicRateLimitService();
  Object.defineProperty(limiter, "redis", {
    value: {
      incr: async () => {
        incrementCount += 1;
        return 99;
      },
      expire: async () => 1,
    },
  });

  await assert.rejects(
    limiter.assertAllowed("test", "client-1", 2, 60),
    /Too many requests/,
  );
  // The 429 must propagate from the shared path, not be retried locally.
  assert.equal(incrementCount, 1);
});
