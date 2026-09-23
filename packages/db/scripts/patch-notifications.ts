import { neon } from "@neondatabase/serverless";
import { parseEnv } from "@aideal/env";

const env = parseEnv();

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing");
}

const sql = neon(env.DATABASE_URL);

const statements = [
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS event_id TEXT;`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupe_key TEXT;`,
  `UPDATE notifications SET event_id = id WHERE event_id IS NULL;`,
  `UPDATE notifications SET dedupe_key = id WHERE dedupe_key IS NULL;`,
  `ALTER TABLE notifications ALTER COLUMN event_id SET NOT NULL;`,
  `ALTER TABLE notifications ALTER COLUMN dedupe_key SET NOT NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS notifications_organization_id_dedupe_key_key ON notifications (organization_id, dedupe_key);`,
];

async function main() {
  for (const statement of statements) await sql.query(statement);
  console.log(JSON.stringify({ ok: true, patch: "notifications-event-identity" }));
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
