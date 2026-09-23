import type { Prisma } from "@aideal/db";
import type { UsageEventInput } from "@aideal/shared";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  record(input: UsageEventInput): void {
    try {
      void this.prisma.usageEvent.create({
        data: {
          organizationId: input.organizationId,
          eventType: input.eventType,
          quantity: input.quantity ?? 1,
          relatedEntityType: input.relatedEntityType,
          relatedEntityId: input.relatedEntityId,
          metadataJson: input.metadata as Prisma.InputJsonValue | undefined,
        },
      }).catch((error: unknown) => {
        console.error(JSON.stringify({ ok: false, event: "usage.record", error: error instanceof Error ? error.message : "unknown" }));
      });
    } catch (error) {
      console.error(JSON.stringify({ ok: false, event: "usage.record", error: error instanceof Error ? error.message : "unknown" }));
    }
  }

  async summary(organizationId: string, days = 30) {
    const windowDays = Math.min(Math.max(days, 1), 365);
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const events = await this.prisma.usageEvent.findMany({
      where: { organizationId, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 5_000,
      select: { eventType: true, quantity: true, metadataJson: true, createdAt: true },
    });
    const byType = new Map<string, { eventType: string; count: number; quantity: number }>();
    for (const event of events) {
      const current = byType.get(event.eventType) ?? { eventType: event.eventType, count: 0, quantity: 0 };
      current.count += 1;
      current.quantity += event.quantity;
      byType.set(event.eventType, current);
    }
    return {
      windowDays,
      since,
      totalEvents: events.length,
      totals: [...byType.values()].sort((a, b) => b.quantity - a.quantity),
      recent: events.slice(0, 20),
    };
  }
}
