import assert from "node:assert/strict";
import { test } from "node:test";
import {
  notificationEventTypes,
  publishNotificationEventSafely,
  type AnyNotificationEvent,
} from "../src/notification-events.js";

const event: AnyNotificationEvent = {
  eventId: "evt-1",
  schemaVersion: 1,
  eventType: "research.follow_up_required",
  organizationId: "org-1",
  occurredAt: "2026-07-27T12:00:00.000Z",
  dedupeKey: "org-1:research.follow_up_required:report-1:v1",
  priority: "high",
  actor: { type: "system", service: "research" },
  payload: {
    researchReportId: "report-1",
    dealId: "deal-1",
    followUpCount: 2,
  },
};

test("notification taxonomy covers each workflow boundary", () => {
  assert.deepEqual(notificationEventTypes, [
    "deal.submitted",
    "deal.review_ready",
    "deal.decision_recorded",
    "document.uploaded",
    "document.extraction_completed",
    "document.extraction_failed",
    "research.completed",
    "research.failed",
    "research.follow_up_required",
    "review.evidence_decision_recorded",
    "review.recommendation_recalculated",
    "job.failed",
    "job.retry_scheduled",
  ]);
  assert.equal(event.organizationId, "org-1");
  assert.equal(event.payload.dealId, "deal-1");
});

test("successful duplicate-aware delivery returns the consumer result", async () => {
  const result = await publishNotificationEventSafely(
    { publish: async (received: AnyNotificationEvent) => ({ duplicate: received.dedupeKey === event.dedupeKey }) },
    event,
  );

  assert.deepEqual(result, { accepted: true, eventId: "evt-1", duplicate: true });
});

test("delivery failure is isolated from the originating workflow", async () => {
  const result = await publishNotificationEventSafely(
    { publish: async () => { throw new Error("provider unavailable"); } },
    event,
  );

  assert.deepEqual(result, {
    accepted: false,
    eventId: "evt-1",
    duplicate: false,
    failure: "delivery_failed",
  });
});
