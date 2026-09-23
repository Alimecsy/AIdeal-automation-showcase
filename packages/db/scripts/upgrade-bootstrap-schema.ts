/**
 * Forward upgrade for a legacy bootstrap database.
 *
 * A database created by `prisma/init.sql` has no `_prisma_migrations` history,
 * so `prisma migrate deploy` would attempt the baseline against tables that
 * already exist. Per the deployment runbook, such a database is brought
 * forward by an explicit reviewed script and its migration history is never
 * manufactured: this script writes no `_prisma_migrations` rows.
 *
 * It applies the schema deltas of the four post-baseline migrations:
 *   20260804120000_add_durable_job_leases
 *   20260804130000_add_notification_outbox
 *   20260804140000_add_intake_finalization_jobs
 *   20260804150000_add_finalizer_entity_identities
 *
 * Every statement is idempotent, so a partial run can be repeated safely. The
 * duplicate-detection guards from the original migrations are preserved
 * verbatim: they abort rather than let an identity constraint silently drop
 * rows. Drain workers before running -- the lease cutover returns `running`
 * jobs to the queue and cannot fence a lease that predates the lease columns.
 */
import { neon } from "@neondatabase/serverless";
import { parseEnv } from "@aideal/env";

const env = parseEnv();

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing");
}

const sql = neon(env.DATABASE_URL);

const statements: Array<[string, string]> = [
  // --- 20260804120000_add_durable_job_leases ---
  [
    "jobs.available_at",
    `ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`,
  ],
  [
    "jobs.lease_expires_at",
    `ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "lease_expires_at" TIMESTAMPTZ(3);`,
  ],
  [
    "jobs.lease_token",
    `ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "lease_token" TEXT;`,
  ],
  [
    "jobs running-recovery",
    `UPDATE "jobs"
       SET "status" = 'queued',
           "available_at" = CURRENT_TIMESTAMP,
           "lease_expires_at" = NULL,
           "lease_token" = NULL,
           "error_message" = COALESCE("error_message", 'Recovered during durable queue lease cutover')
     WHERE "status" = 'running';`,
  ],
  [
    "jobs_status_available_at_idx",
    `CREATE INDEX IF NOT EXISTS "jobs_status_available_at_idx" ON "jobs"("status", "available_at");`,
  ],
  [
    "jobs_status_lease_expires_at_idx",
    `CREATE INDEX IF NOT EXISTS "jobs_status_lease_expires_at_idx" ON "jobs"("status", "lease_expires_at");`,
  ],

  // --- 20260804130000_add_notification_outbox ---
  [
    "NotificationOutboxStatus enum",
    `DO $$
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationOutboxStatus') THEN
         CREATE TYPE "NotificationOutboxStatus" AS ENUM ('pending', 'processing', 'delivered', 'dead_letter');
       END IF;
     END $$;`,
  ],
  [
    "notification_outbox table",
    `CREATE TABLE IF NOT EXISTS "notification_outbox" (
       "id" TEXT NOT NULL,
       "organization_id" TEXT NOT NULL,
       "event_id" TEXT NOT NULL,
       "dedupe_key" TEXT NOT NULL,
       "event_type" TEXT NOT NULL,
       "schema_version" INTEGER NOT NULL,
       "priority" TEXT NOT NULL,
       "actor_json" JSONB NOT NULL,
       "payload_json" JSONB NOT NULL,
       "occurred_at" TIMESTAMPTZ(3) NOT NULL,
       "status" "NotificationOutboxStatus" NOT NULL DEFAULT 'pending',
       "attempts" INTEGER NOT NULL DEFAULT 0,
       "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "locked_at" TIMESTAMPTZ(3),
       "locked_by" TEXT,
       "last_error" TEXT,
       "delivered_at" TIMESTAMPTZ(3),
       "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
     );`,
  ],
  [
    "notification_outbox_organization_id_dedupe_key_key",
    `CREATE UNIQUE INDEX IF NOT EXISTS "notification_outbox_organization_id_dedupe_key_key"
       ON "notification_outbox"("organization_id", "dedupe_key");`,
  ],
  [
    "notification_outbox_status_available_at_created_at_idx",
    `CREATE INDEX IF NOT EXISTS "notification_outbox_status_available_at_created_at_idx"
       ON "notification_outbox"("status", "available_at", "created_at");`,
  ],
  [
    "notification_outbox_organization_id_created_at_idx",
    `CREATE INDEX IF NOT EXISTS "notification_outbox_organization_id_created_at_idx"
       ON "notification_outbox"("organization_id", "created_at");`,
  ],
  [
    "notification_outbox_status_locked_at_idx",
    `CREATE INDEX IF NOT EXISTS "notification_outbox_status_locked_at_idx"
       ON "notification_outbox"("status", "locked_at");`,
  ],
  [
    "notification_outbox_organization_id_fkey",
    `DO $$
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_outbox_organization_id_fkey') THEN
         ALTER TABLE "notification_outbox"
           ADD CONSTRAINT "notification_outbox_organization_id_fkey"
           FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
           ON DELETE CASCADE ON UPDATE CASCADE;
       END IF;
     END $$;`,
  ],

  // --- 20260804140000_add_intake_finalization_jobs ---
  [
    "jobs.intake_submission_id",
    `ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "intake_submission_id" TEXT;`,
  ],
  [
    "documents duplicate guard",
    `DO $$
     BEGIN
       IF EXISTS (
         SELECT 1 FROM "documents"
         WHERE "deal_id" IS NOT NULL
         GROUP BY "deal_id", "storage_key"
         HAVING COUNT(*) > 1
       ) THEN
         RAISE EXCEPTION 'Cannot add documents(deal_id, storage_key) uniqueness: duplicate rows exist';
       END IF;
     END $$;`,
  ],
  [
    "jobs_intake_submission_id_key",
    `CREATE UNIQUE INDEX IF NOT EXISTS "jobs_intake_submission_id_key" ON "jobs"("intake_submission_id");`,
  ],
  [
    "documents_deal_id_storage_key_key",
    `CREATE UNIQUE INDEX IF NOT EXISTS "documents_deal_id_storage_key_key" ON "documents"("deal_id", "storage_key");`,
  ],
  [
    "jobs_intake_submission_id_fkey",
    `DO $$
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_intake_submission_id_fkey') THEN
         ALTER TABLE "jobs"
           ADD CONSTRAINT "jobs_intake_submission_id_fkey"
           FOREIGN KEY ("intake_submission_id") REFERENCES "intake_submissions"("id")
           ON DELETE CASCADE ON UPDATE CASCADE;
       END IF;
     END $$;`,
  ],

  // --- 20260804150000_add_finalizer_entity_identities ---
  [
    "companies.identity_jurisdiction",
    `ALTER TABLE "companies"
       ADD COLUMN IF NOT EXISTS "identity_jurisdiction" TEXT
       GENERATED ALWAYS AS (COALESCE("jurisdiction", '')) STORED;`,
  ],
  [
    "finalizer identity guards",
    `DO $$
     BEGIN
       IF EXISTS (
         SELECT 1 FROM "companies"
         GROUP BY "organization_id", "legal_name", COALESCE("jurisdiction", '')
         HAVING COUNT(*) > 1
       ) THEN
         RAISE EXCEPTION 'Cannot add company finalizer identity: duplicate tenant/legal-name/jurisdiction rows exist';
       END IF;

       IF EXISTS (
         SELECT 1 FROM "applicants"
         GROUP BY "organization_id", "email"
         HAVING COUNT(*) > 1
       ) THEN
         RAISE EXCEPTION 'Cannot add applicant finalizer identity: duplicate tenant/email rows exist';
       END IF;
     END $$;`,
  ],
  [
    "companies_organization_id_legal_name_identity_jurisdiction_key",
    `CREATE UNIQUE INDEX IF NOT EXISTS "companies_organization_id_legal_name_identity_jurisdiction_key"
       ON "companies"("organization_id", "legal_name", "identity_jurisdiction");`,
  ],
  [
    "applicants_organization_id_email_key",
    `CREATE UNIQUE INDEX IF NOT EXISTS "applicants_organization_id_email_key"
       ON "applicants"("organization_id", "email");`,
  ],
];

async function main() {
  if (await hasPrismaHistory()) {
    throw new Error(
      "This database has _prisma_migrations history and must be migrated with the verified migration runner, not this script.",
    );
  }

  for (const [label, statement] of statements) {
    await sql.query(statement);
    console.log(JSON.stringify({ ok: true, applied: label }));
  }

  console.log(
    JSON.stringify({
      ok: true,
      upgrade: "bootstrap-schema-to-current",
      statementsApplied: statements.length,
      prismaHistoryWritten: false,
    }),
  );
}

async function hasPrismaHistory() {
  const rows = (await sql.query(
    `SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present;`,
  )) as Array<{ present: boolean }>;

  return rows[0]?.present === true;
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
