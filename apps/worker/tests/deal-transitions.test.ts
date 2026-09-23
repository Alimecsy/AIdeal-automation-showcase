import assert from "node:assert/strict";
import { test } from "node:test";
import { InternalApiDealTransitions } from "../src/deal-transitions";

test("worker calls the narrow governed review-ready API command with its organization scope", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const transitions = new InternalApiDealTransitions(
    async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(null, { status: 200 });
    },
    { apiUrl: "https://api.internal/", workerToken: "a".repeat(32) },
  );

  await transitions.transitionToReviewReady({ organizationId: "org-1", dealId: "deal / 1" });

  assert.deepEqual(requests, [{
    url: "https://api.internal/api/internal/deals/deal%20%2F%201/review-ready",
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-aideal-worker-token": "a".repeat(32),
      },
      body: JSON.stringify({ organizationId: "org-1" }),
    },
  }]);
});

test("worker fails closed when internal lifecycle credentials are not configured", async () => {
  const transitions = new InternalApiDealTransitions(fetch, { apiUrl: undefined, workerToken: undefined });
  await assert.rejects(
    transitions.transitionToReviewReady({ organizationId: "org-1", dealId: "deal-1" }),
    /INTERNAL_API_URL and INTERNAL_WORKER_TOKEN are required/,
  );
});
