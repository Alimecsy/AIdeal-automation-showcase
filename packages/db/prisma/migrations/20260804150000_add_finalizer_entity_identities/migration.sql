-- Finalizer entity identities. These constraints make an overlapping
-- lease recovery safe at the database boundary, not merely in worker memory.
-- The generated identity column treats an absent jurisdiction as part of the
-- company identity, avoiding PostgreSQL's default multiple-NULL loophole and
-- keeping every writer aligned without application-maintained shadow data.
ALTER TABLE "companies"
  ADD COLUMN "identity_jurisdiction" TEXT
  GENERATED ALWAYS AS (COALESCE("jurisdiction", '')) STORED;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "companies"
    GROUP BY "organization_id", "legal_name", COALESCE("jurisdiction", '')
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add company finalizer identity: duplicate tenant/legal-name/jurisdiction rows exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "applicants"
    GROUP BY "organization_id", "email"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add applicant finalizer identity: duplicate tenant/email rows exist';
  END IF;
END $$;

CREATE UNIQUE INDEX "companies_organization_id_legal_name_identity_jurisdiction_key"
  ON "companies"("organization_id", "legal_name", "identity_jurisdiction");

CREATE UNIQUE INDEX "applicants_organization_id_email_key"
  ON "applicants"("organization_id", "email");
