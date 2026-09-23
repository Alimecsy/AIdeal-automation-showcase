-- Durable public-intake finalization. This migration is additive and must be
-- applied only through the verified migration runner after review.
ALTER TABLE "jobs" ADD COLUMN "intake_submission_id" TEXT;

-- Do not make document identity silently lossy. Operators must resolve any
-- historical duplicates before this invariant is enforced.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "documents"
    WHERE "deal_id" IS NOT NULL
    GROUP BY "deal_id", "storage_key"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add documents(deal_id, storage_key) uniqueness: duplicate rows exist';
  END IF;
END $$;

CREATE UNIQUE INDEX "jobs_intake_submission_id_key"
  ON "jobs"("intake_submission_id");
CREATE UNIQUE INDEX "documents_deal_id_storage_key_key"
  ON "documents"("deal_id", "storage_key");

ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_intake_submission_id_fkey"
  FOREIGN KEY ("intake_submission_id") REFERENCES "intake_submissions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
