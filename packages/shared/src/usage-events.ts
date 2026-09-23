export const usageEventTypes = [
  "submission.created",
  "document.extraction_completed",
  "document.extraction_failed",
  "ai.run_completed",
  "ai.run_failed",
  "research.discovery",
  "research.page_fetched",
  "research.cache_hit",
  "research.synthesis",
  "notification.created",
  "job.failed",
] as const;

export type UsageEventType = (typeof usageEventTypes)[number];
export type UsageEventMetadata = Record<string, string | number | boolean | null>;
export type UsageEventInput = {
  organizationId: string;
  eventType: UsageEventType;
  quantity?: number;
  relatedEntityType?: string;
  relatedEntityId?: string;
  metadata?: UsageEventMetadata;
};
