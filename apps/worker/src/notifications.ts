import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@aideal/db";
import type { AnyNotificationEvent } from "@aideal/shared";

const titles: Record<AnyNotificationEvent["eventType"], string> = {
  "deal.submitted": "New deal submitted",
  "deal.review_ready": "Deal ready for review",
  "deal.decision_recorded": "Deal decision recorded",
  "document.uploaded": "Document uploaded",
  "document.extraction_completed": "Document extraction completed",
  "document.extraction_failed": "Document extraction failed",
  "research.completed": "Research completed",
  "research.failed": "Research failed",
  "research.follow_up_required": "Research follow-up required",
  "review.evidence_decision_recorded": "Evidence decision recorded",
  "review.recommendation_recalculated": "Recommendation recalculated",
  "job.failed": "Processing job failed",
  "job.retry_scheduled": "Processing retry scheduled",
};

function payloadText(event: AnyNotificationEvent) {
  const payload = event.payload as Record<string, unknown>;
  const details = Object.entries(payload)
    .filter(([, value]) => value !== undefined && value !== null)
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" · ");
  return details || undefined;
}

function payloadDealId(event: AnyNotificationEvent) {
  const payload = event.payload as Record<string, unknown>;
  return typeof payload.dealId === "string" ? payload.dealId : undefined;
}

/**
 * Worker producers record durable intent; the outbox dispatcher is the sole
 * writer of user-visible notifications. Call this inside a domain transaction
 * whenever the caller owns one.
 */
export async function publishWorkerNotification(
  prisma: PrismaClient,
  event: AnyNotificationEvent,
) {
  try {
    await prisma.notificationOutbox.create({
      data: {
        organizationId: event.organizationId,
        eventId: event.eventId,
        dedupeKey: event.dedupeKey,
        eventType: event.eventType,
        schemaVersion: event.schemaVersion,
        priority: event.priority,
        actorJson: event.actor,
        payloadJson: event.payload,
        occurredAt: new Date(event.occurredAt),
      },
    });
    return { duplicate: false };
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return { duplicate: true };
    throw error;
  }
}

export function workerNotificationEventId() {
  return randomUUID();
}
