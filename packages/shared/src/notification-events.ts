/**
 * Shared notification event vocabulary.
 *
 * Events are organization-scoped and delivered at least once. Consumers must
 * persist or otherwise atomically handle `dedupeKey` before applying side
 * effects. `eventId` identifies one emission and is not a deduplication key.
 */

export const notificationEventTypes = [
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
] as const;

export type NotificationEventType = (typeof notificationEventTypes)[number];
export type NotificationPriority = "low" | "normal" | "high" | "urgent";

export type NotificationActor =
  | { type: "user"; userId: string }
  | { type: "system"; service?: string };

export type DealNotificationPayload = {
  dealId: string;
  submissionId?: string;
  status?: string;
  rating?: string | null;
  recommendedAction?: string | null;
  reason?: string;
};

export type DocumentNotificationPayload = {
  documentId: string;
  dealId?: string;
  fileName?: string;
  status?: string;
  errorCode?: string;
};

export type ResearchNotificationPayload = {
  researchReportId: string;
  dealId: string;
  sourceCount?: number;
  followUpCount?: number;
  confidence?: string | null;
  errorCode?: string;
};

export type ReviewNotificationPayload = {
  dealId: string;
  researchReportId?: string;
  sourceId?: string;
  decision?: "confirmed" | "dismissed" | "follow_up";
  rating?: string | null;
  recommendedAction?: string | null;
};

export type JobNotificationPayload = {
  jobId: string;
  jobType: string;
  attempts?: number;
  maxAttempts?: number;
  errorCode?: string;
  retryAt?: string;
};

export type NotificationPayloadByType = {
  "deal.submitted": DealNotificationPayload;
  "deal.review_ready": DealNotificationPayload;
  "deal.decision_recorded": DealNotificationPayload;
  "document.uploaded": DocumentNotificationPayload;
  "document.extraction_completed": DocumentNotificationPayload;
  "document.extraction_failed": DocumentNotificationPayload;
  "research.completed": ResearchNotificationPayload;
  "research.failed": ResearchNotificationPayload;
  "research.follow_up_required": ResearchNotificationPayload;
  "review.evidence_decision_recorded": ReviewNotificationPayload;
  "review.recommendation_recalculated": ReviewNotificationPayload;
  "job.failed": JobNotificationPayload;
  "job.retry_scheduled": JobNotificationPayload;
};

export type NotificationEvent<T extends NotificationEventType = NotificationEventType> = {
  eventId: string;
  schemaVersion: 1;
  eventType: T;
  organizationId: string;
  occurredAt: string;
  dedupeKey: string;
  priority: NotificationPriority;
  actor: NotificationActor;
  payload: NotificationPayloadByType[T];
};

export type AnyNotificationEvent = {
  [T in NotificationEventType]: NotificationEvent<T>;
}[NotificationEventType];

export type NotificationDeliveryResult =
  | { accepted: true; eventId: string; duplicate: boolean }
  | { accepted: false; eventId: string; duplicate: false; failure: "delivery_failed" };

export type NotificationEventPublisher = {
  publish(event: AnyNotificationEvent): Promise<{ duplicate?: boolean }>;
};

/**
 * Delivery is intentionally best-effort at the originating workflow boundary.
 * A later retry/reconciliation path can republish the same dedupe key.
 */
export async function publishNotificationEventSafely(
  publisher: NotificationEventPublisher,
  event: AnyNotificationEvent,
): Promise<NotificationDeliveryResult> {
  try {
    const result = await publisher.publish(event);
    return { accepted: true, eventId: event.eventId, duplicate: result.duplicate === true };
  } catch {
    return { accepted: false, eventId: event.eventId, duplicate: false, failure: "delivery_failed" };
  }
}
