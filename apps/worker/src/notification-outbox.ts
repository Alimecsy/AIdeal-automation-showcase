import type { PrismaClient, Prisma } from "@aideal/db";
import type { AnyNotificationEvent } from "@aideal/shared";
import { randomUUID } from "node:crypto";

export const NOTIFICATION_OUTBOX_LEASE_MS = 5 * 60_000;
export const NOTIFICATION_OUTBOX_MAX_ATTEMPTS = 10;

type OutboxRecord = NonNullable<Awaited<ReturnType<PrismaClient["notificationOutbox"]["findUnique"]>>>;

const titles: Record<AnyNotificationEvent["eventType"], string> = {
  "deal.submitted": "New deal submitted", "deal.review_ready": "Deal ready for review", "deal.decision_recorded": "Deal decision recorded",
  "document.uploaded": "Document uploaded", "document.extraction_completed": "Document extraction completed", "document.extraction_failed": "Document extraction failed",
  "research.completed": "Research completed", "research.failed": "Research failed", "research.follow_up_required": "Research follow-up required",
  "review.evidence_decision_recorded": "Evidence decision recorded", "review.recommendation_recalculated": "Recommendation recalculated",
  "job.failed": "Processing job failed", "job.retry_scheduled": "Processing retry scheduled",
};

function eventFrom(row: OutboxRecord): AnyNotificationEvent {
  return {
    eventId: row.eventId, schemaVersion: 1, eventType: row.eventType as AnyNotificationEvent["eventType"],
    organizationId: row.organizationId, occurredAt: row.occurredAt.toISOString(), dedupeKey: row.dedupeKey,
    priority: row.priority as AnyNotificationEvent["priority"], actor: row.actorJson as AnyNotificationEvent["actor"],
    payload: row.payloadJson as AnyNotificationEvent["payload"],
  } as AnyNotificationEvent;
}

function body(event: AnyNotificationEvent) {
  return Object.entries(event.payload as Record<string, unknown>).filter(([, value]) => value != null).slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`).join(" · ") || undefined;
}

function dealId(event: AnyNotificationEvent) {
  const value = (event.payload as Record<string, unknown>).dealId;
  return typeof value === "string" ? value : undefined;
}

export function notificationOutboxRetryDelayMs(attempt: number) {
  return Math.min(24 * 60 * 60_000, 60_000 * 5 ** Math.max(0, attempt - 1));
}

export class NotificationOutboxDispatcher {
  constructor(private readonly prisma: PrismaClient, private readonly workerId = `worker:${randomUUID()}`) {}

  async processNext() {
    const now = new Date();
    await this.recoverExpiredLeases(now);
    const candidate = await this.prisma.notificationOutbox.findFirst({
      where: { status: "pending", availableAt: { lte: now } }, orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }], select: { id: true },
    });
    if (!candidate) return false;
    const claimed = await this.prisma.notificationOutbox.updateMany({
      where: { id: candidate.id, status: "pending", availableAt: { lte: now } },
      data: { status: "processing", attempts: { increment: 1 }, lockedAt: now, lockedBy: this.workerId, lastError: null },
    });
    if (!claimed.count) return false;
    const row = await this.prisma.notificationOutbox.findUnique({ where: { id: candidate.id } });
    if (!row || row.status !== "processing" || row.lockedBy !== this.workerId) return false;
    await this.deliver(row);
    return true;
  }

  async recoverExpiredLeases(now = new Date()) {
    return this.prisma.notificationOutbox.updateMany({
      where: { status: "processing", lockedAt: { lt: new Date(now.getTime() - NOTIFICATION_OUTBOX_LEASE_MS) } },
      data: { status: "pending", lockedAt: null, lockedBy: null, availableAt: now },
    });
  }

  /**
   * Requeues one terminal row without changing its immutable event snapshot or
   * tenant-scoped dedupe identity. This is deliberately an explicit operator
   * action rather than an automatic retry path.
   */
  async replay(id: string, now = new Date()) {
    return this.prisma.notificationOutbox.updateMany({
      where: { id, status: "dead_letter" },
      data: { status: "pending", attempts: 0, availableAt: now, lockedAt: null, lockedBy: null, lastError: null },
    });
  }

  private async deliver(row: OutboxRecord) {
    const event = eventFrom(row);
    try {
      await this.prisma.$transaction(async (tx) => {
        try {
          await tx.notification.create({ data: {
            organizationId: event.organizationId, userId: null, dealId: dealId(event), eventId: event.eventId,
            dedupeKey: event.dedupeKey, type: event.eventType, priority: event.priority, title: titles[event.eventType], body: body(event),
            deliveryStatusJson: { schemaVersion: event.schemaVersion, actor: event.actor, occurredAt: event.occurredAt },
          } });
        } catch (error) {
          if ((error as { code?: string }).code !== "P2002") throw error;
        }
        await tx.notificationOutbox.updateMany({ where: { id: row.id, status: "processing", lockedBy: this.workerId }, data: { status: "delivered", deliveredAt: new Date(), lockedAt: null, lockedBy: null, lastError: null } });
      });
      console.log(JSON.stringify({ event: "notification_outbox.delivered", outboxId: row.id, organizationId: row.organizationId, notificationType: row.eventType, attempts: row.attempts }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown notification outbox error";
      const terminal = row.attempts >= NOTIFICATION_OUTBOX_MAX_ATTEMPTS;
      await this.prisma.notificationOutbox.updateMany({
        where: { id: row.id, status: "processing", lockedBy: this.workerId },
        data: terminal ? { status: "dead_letter", lockedAt: null, lockedBy: null, lastError: message } : { status: "pending", lockedAt: null, lockedBy: null, lastError: message, availableAt: new Date(Date.now() + notificationOutboxRetryDelayMs(row.attempts)) },
      });
      console.log(JSON.stringify({ event: terminal ? "notification_outbox.dead_lettered" : "notification_outbox.retry_scheduled", outboxId: row.id, organizationId: row.organizationId, notificationType: row.eventType, attempts: row.attempts }));
    }
  }
}
