import type { AnyNotificationEvent, NotificationEventType } from "@aideal/shared";
import type { Prisma } from "@aideal/db";
import { Injectable, Optional } from "@nestjs/common";
import type { CurrentWorkspace } from "../auth/auth.types";
import { PrismaService } from "../prisma.service";
import { UsageService } from "../usage/usage.service";

const reviewOnlyEvents = new Set<NotificationEventType>([
  "review.evidence_decision_recorded",
  "review.recommendation_recalculated",
]);

const titles: Record<NotificationEventType, string> = {
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

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly usage?: UsageService) {}

  async publish(event: AnyNotificationEvent) {
    try {
      const notification = await this.prisma.notification.create({
        data: {
          organizationId: event.organizationId,
          // Events are organization-visible by default; role filtering is applied on reads.
          userId: null,
          dealId: payloadDealId(event),
          eventId: event.eventId,
          dedupeKey: event.dedupeKey,
          type: event.eventType,
          priority: event.priority,
          title: titles[event.eventType],
          body: payloadText(event),
          deliveryStatusJson: {
            schemaVersion: event.schemaVersion,
            actor: event.actor,
            occurredAt: event.occurredAt,
          },
        },
      });
      this.usage?.record({
        organizationId: event.organizationId,
        eventType: "notification.created",
        relatedEntityType: "Notification",
        relatedEntityId: notification.id,
        metadata: { notificationType: event.eventType, priority: event.priority },
      });
      return { duplicate: false, notification };
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        return { duplicate: true };
      }
      throw error;
    }
  }

  /**
   * Records notification intent using the caller's domain transaction. Delivery
   * is deliberately performed later by the worker outbox dispatcher.
   */
  async enqueue(transaction: Prisma.TransactionClient, event: AnyNotificationEvent) {
    try {
      await transaction.notificationOutbox.create({
        data: {
          organizationId: event.organizationId,
          eventId: event.eventId,
          dedupeKey: event.dedupeKey,
          eventType: event.eventType,
          schemaVersion: event.schemaVersion,
          priority: event.priority,
          actorJson: event.actor,
          payloadJson: event.payload as Prisma.InputJsonValue,
          occurredAt: new Date(event.occurredAt),
        },
      });
      return { duplicate: false };
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") return { duplicate: true };
      throw error;
    }
  }

  async list(workspace: CurrentWorkspace, unreadOnly = false) {
    const notifications = await this.prisma.notification.findMany({
      where: {
        organizationId: workspace.organization.id,
        ...(unreadOnly ? { readAt: null } : {}),
        OR: [{ userId: null }, { userId: workspace.user.id }],
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    if (workspace.membership.role === "analyst") {
      return notifications.filter(
        (notification: { type: string }) => !reviewOnlyEvents.has(notification.type as NotificationEventType),
      );
    }
    return notifications;
  }

  async markRead(workspace: CurrentWorkspace, notificationId: string) {
    return this.prisma.notification.updateMany({
      where: {
        id: notificationId,
        organizationId: workspace.organization.id,
        OR: [{ userId: null }, { userId: workspace.user.id }],
      },
      data: { readAt: new Date() },
    });
  }
}
