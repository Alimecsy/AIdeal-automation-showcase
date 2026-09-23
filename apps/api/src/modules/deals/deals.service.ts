import type { Prisma, DealStatus } from "@aideal/db";
import type { AnyNotificationEvent } from "@aideal/shared";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma.service";
import { NotificationsService } from "../notifications/notifications.service";

const transitions: Record<DealStatus, DealStatus[]> = {
  submitted: ["processing", "failed"],
  processing: ["review_ready", "failed", "action_required", "manual_review"],
  review_ready: ["accepted", "rejected", "action_required", "manual_review"],
  action_required: ["processing", "review_ready", "manual_review", "rejected"],
  manual_review: ["processing", "review_ready", "accepted", "rejected", "action_required"],
  accepted: ["archived"],
  rejected: ["archived", "manual_review"],
  failed: ["processing", "archived"],
  archived: [],
};

export type DealActor = {
  userId?: string;
  actorType: string;
  actorReference?: string;
};

@Injectable()
export class DealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications?: NotificationsService,
  ) {}

  async upsertForSubmission(input: {
    organizationId: string;
    intakeSubmissionId: string;
    title: string;
    dealTypeId: string;
    applicantId?: string | null;
    companyId?: string | null;
  }) {
    return this.prisma.$transaction(async (transaction) => {
      const deal = await transaction.deal.upsert({
        where: { intakeSubmissionId: input.intakeSubmissionId },
        update: {
          title: input.title,
          dealTypeId: input.dealTypeId,
          applicantId: input.applicantId ?? null,
          companyId: input.companyId ?? null,
        },
        create: {
          organizationId: input.organizationId,
          intakeSubmissionId: input.intakeSubmissionId,
          dealTypeId: input.dealTypeId,
          applicantId: input.applicantId ?? null,
          companyId: input.companyId ?? null,
          title: input.title,
          status: "submitted",
        },
        select: { id: true, status: true },
      });

      if (this.notifications && deal.status === "submitted") {
        await this.notifications.enqueue(transaction, {
          eventId: randomUUID(),
          schemaVersion: 1,
          eventType: "deal.submitted",
          organizationId: input.organizationId,
          occurredAt: new Date().toISOString(),
          dedupeKey: `${input.organizationId}:deal.submitted:${deal.id}`,
          priority: "normal",
          actor: { type: "system", service: "intake" },
          payload: {
            dealId: deal.id,
            submissionId: input.intakeSubmissionId,
            status: deal.status,
          },
        });
      }

      return deal;
    });
  }

  async transition(input: {
    organizationId: string;
    dealId: string;
    toStatus: DealStatus;
    actor: DealActor;
    reason?: string;
    additionalOutboxEvent?: (deal: { id: string; status: DealStatus }) => AnyNotificationEvent;
  }) {
    const deal = await this.prisma.deal.findFirst({
      where: { id: input.dealId, organizationId: input.organizationId },
      select: { id: true, status: true },
    });

    if (!deal) {
      throw new NotFoundException("Deal not found");
    }

    if (deal.status === input.toStatus) {
      return deal;
    }

    if (!(transitions[deal.status] ?? []).includes(input.toStatus)) {
      throw new BadRequestException(
        `Cannot transition deal from ${deal.status} to ${input.toStatus}`,
      );
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.deal.update({
        where: { id: deal.id },
        data: { status: input.toStatus },
        select: { id: true, status: true, updatedAt: true },
      });

      await transaction.dealStatusHistory.create({
        data: {
          dealId: deal.id,
          fromStatus: deal.status,
          toStatus: input.toStatus,
          changedByUserId: input.actor.userId,
          reason: input.reason,
        },
      });

      await transaction.auditLog.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actor.userId,
          action: "deal.status_changed",
          entityType: "Deal",
          entityId: deal.id,
          beforeJson: { status: deal.status } as Prisma.InputJsonValue,
          afterJson: {
            status: input.toStatus,
            actorType: input.actor.actorType,
            actorReference: input.actor.actorReference ?? null,
            reason: input.reason ?? null,
          } as Prisma.InputJsonValue,
        },
      });

      if (this.notifications && updated.status === "review_ready") {
        await this.notifications.enqueue(transaction, {
          eventId: randomUUID(),
          schemaVersion: 1,
          eventType: "deal.review_ready",
          organizationId: input.organizationId,
          occurredAt: new Date().toISOString(),
          dedupeKey: `${input.organizationId}:deal.review_ready:${updated.id}`,
          priority: "normal",
          actor: input.actor.userId
            ? { type: "user", userId: input.actor.userId }
            : { type: "system", service: input.actor.actorReference ?? "deals" },
          payload: { dealId: updated.id, status: updated.status },
        });
      }

      if (this.notifications && input.additionalOutboxEvent) {
        await this.notifications.enqueue(transaction, input.additionalOutboxEvent(updated));
      }

      return updated;
    });

    return updated;
  }

  async review(input: {
    organizationId: string;
    dealId: string;
    reviewerUserId: string;
    action: "accept" | "reject" | "request_information" | "manual_review";
    note?: string;
  }) {
    const statusByAction = {
      accept: "accepted",
      reject: "rejected",
      request_information: "action_required",
      manual_review: "manual_review",
    } as const;

    const result = await this.transition({
      organizationId: input.organizationId,
      dealId: input.dealId,
      toStatus: statusByAction[input.action],
      actor: { userId: input.reviewerUserId, actorType: "user" },
      reason: input.note?.trim() || input.action,
      additionalOutboxEvent: (deal) => ({
        eventId: randomUUID(),
        schemaVersion: 1,
        eventType: "deal.decision_recorded",
        organizationId: input.organizationId,
        occurredAt: new Date().toISOString(),
        dedupeKey: `${input.organizationId}:deal.decision_recorded:${input.dealId}:${deal.status}`,
        priority: deal.status === "manual_review" || deal.status === "action_required" ? "high" : "normal",
        actor: { type: "user", userId: input.reviewerUserId },
        payload: {
          dealId: input.dealId,
          status: deal.status,
          reason: input.note?.trim() || input.action,
        },
      }),
    });

    return result;
  }
}
