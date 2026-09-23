import type { PrismaClient } from "@aideal/db";
import type { UsageEventInput } from "@aideal/shared";

export class UsageRecorder {
  constructor(private readonly prisma: PrismaClient) {}

  record(input: UsageEventInput): void {
    try {
      void this.prisma.usageEvent.create({
        data: {
          organizationId: input.organizationId,
          eventType: input.eventType,
          quantity: input.quantity ?? 1,
          relatedEntityType: input.relatedEntityType,
          relatedEntityId: input.relatedEntityId,
          metadataJson: input.metadata,
        },
      }).catch((error: unknown) => {
        console.error(JSON.stringify({ ok: false, event: "usage.record", error: error instanceof Error ? error.message : "unknown" }));
      });
    } catch (error) {
      console.error(JSON.stringify({ ok: false, event: "usage.record", error: error instanceof Error ? error.message : "unknown" }));
    }
  }
}
