import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasValidInternalWorkerToken,
  InternalDealsController,
} from "../src/modules/deals/internal-deals.controller";

test("internal worker credentials use exact, fail-closed token matching", () => {
  const expected = "a".repeat(32);
  assert.equal(hasValidInternalWorkerToken(expected, expected), true);
  assert.equal(hasValidInternalWorkerToken("b".repeat(32), expected), false);
  assert.equal(hasValidInternalWorkerToken(undefined, expected), false);
  assert.equal(hasValidInternalWorkerToken(expected, undefined), false);
});

test("internal review-ready command delegates to the governed DealsService with a system actor", async () => {
  const calls: unknown[] = [];
  const controller = new InternalDealsController(
    { transition: async (input: unknown) => { calls.push(input); return { id: "deal-1", status: "review_ready" }; } } as never,
    { hasValidToken: () => true },
  );

  const result = await controller.transitionToReviewReady("deal-1", { organizationId: "org-1" }, "token");

  assert.deepEqual(result, { id: "deal-1", status: "review_ready" });
  assert.deepEqual(calls, [{
    organizationId: "org-1",
    dealId: "deal-1",
    toStatus: "review_ready",
    actor: { actorType: "system", actorReference: "worker" },
  }]);
});

test("internal review-ready command rejects absent or invalid credentials before transitioning", () => {
  const controller = new InternalDealsController(
    { transition: async () => ({}) } as never,
    { hasValidToken: () => false },
  );
  assert.throws(
    () => controller.transitionToReviewReady("deal-1", { organizationId: "org-1" }, "wrong"),
    /Invalid internal worker credentials/,
  );
});
