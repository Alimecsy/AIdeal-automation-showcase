export const dealStatuses = [
  "submitted",
  "processing",
  "review_ready",
  "action_required",
  "accepted",
  "rejected",
  "manual_review",
  "failed",
  "archived",
] as const;

export type DealStatus = (typeof dealStatuses)[number];

export const organizationRoles = [
  "owner_admin",
  "analyst",
  "reviewer",
  "approver",
] as const;

export type OrganizationRole = (typeof organizationRoles)[number];

export const dealRatings = ["A", "B", "C", "D", "Reject"] as const;

export type DealRating = (typeof dealRatings)[number];

export const jobTypes = ["test.success", "test.failure"] as const;

export type JobType = (typeof jobTypes)[number];

export type QueueJobMessage = {
  jobId: string;
  availableAt?: number;
};

export type DocumentExtractionJobPayload = {
  documentId: string;
  extractionId: string;
};

export type AiJobPayload = {
  aiRunId: string;
  prompt: string;
};

export type ResearchJobPayload = {
  researchReportId: string;
  dealId: string;
};

export type SopEvaluationJobPayload = {
  dealId: string;
};

/** Durable command emitted when a public intake session is accepted. */
export type IntakeFinalizationJobPayload = {
  submissionId: string;
};

export * from "./notification-events.js";
export * from "./usage-events.js";
