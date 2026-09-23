-- Durable scheduler fields. This is additive and preserves every existing job.
-- `available_at` is timezone-aware so retry eligibility is consistent across workers.
ALTER TABLE "jobs"
  ADD COLUMN "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(3),
  ADD COLUMN "lease_token" TEXT;

-- Pre-lease workers could leave jobs in `running` forever. Return those rows
-- to the durable scheduler at cutover; no existing active lease exists to
-- fence, so workers must be drained before this migration is applied.
UPDATE "jobs"
SET "status" = 'queued',
    "available_at" = CURRENT_TIMESTAMP,
    "lease_expires_at" = NULL,
    "lease_token" = NULL,
    "error_message" = COALESCE("error_message", 'Recovered during durable queue lease cutover')
WHERE "status" = 'running';

CREATE INDEX "jobs_status_available_at_idx" ON "jobs"("status", "available_at");
CREATE INDEX "jobs_status_lease_expires_at_idx" ON "jobs"("status", "lease_expires_at");
