import { neon } from "@neondatabase/serverless";
import { parseEnv } from "@aideal/env";

const env = parseEnv();

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing");
}

const sql = neon(env.DATABASE_URL);

const statements = [
  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload_json JSONB,
    status "JobStatus" NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    error_message TEXT,
    available_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lease_expires_at TIMESTAMPTZ(3),
    lease_token TEXT,
    started_at TIMESTAMP(3),
    completed_at TIMESTAMP(3),
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT jobs_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
  );`,
  `CREATE INDEX IF NOT EXISTS jobs_organization_id_status_created_at_idx
    ON jobs (organization_id, status, created_at);`,
  `CREATE INDEX IF NOT EXISTS jobs_organization_id_type_created_at_idx
    ON jobs (organization_id, type, created_at);`,
  `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ(3);`,
  `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lease_token TEXT;`,
  `CREATE INDEX IF NOT EXISTS jobs_status_available_at_idx
    ON jobs (status, available_at);`,
  `CREATE INDEX IF NOT EXISTS jobs_status_lease_expires_at_idx
    ON jobs (status, lease_expires_at);`,
];

async function main() {
  for (const statement of statements) {
    await sql.query(statement);
  }

  console.log(JSON.stringify({ ok: true, table: "jobs" }));
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
