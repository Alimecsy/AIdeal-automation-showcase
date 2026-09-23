import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { neon } from "@neondatabase/serverless";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for database tests; refusing to use DATABASE_URL");
}

const sql = neon(testDatabaseUrl);

test("jobs table persists lifecycle state and cascades with its organization", async () => {
  const organizationId = `db-test-org-${randomUUID()}`;
  const jobId = `db-test-job-${randomUUID()}`;

  try {
    await sql`
      INSERT INTO organizations (id, name, slug, updated_at)
      VALUES (${organizationId}, 'DB Test Organization', ${organizationId}, CURRENT_TIMESTAMP)
    `;

    await sql`
      INSERT INTO jobs (id, organization_id, type, payload_json, updated_at)
      VALUES (${jobId}, ${organizationId}, 'db.test', '{"source":"localized-test"}'::jsonb, CURRENT_TIMESTAMP)
    `;

    const queued = await sql`
      SELECT status, attempts, max_attempts, payload_json,
        available_at IS NOT NULL AS available,
        pg_typeof(available_at)::text AS availability_type
      FROM jobs
      WHERE id = ${jobId}
    `;
    assert.deepEqual(queued[0], {
      status: "queued",
      attempts: 0,
      max_attempts: 3,
      payload_json: { source: "localized-test" },
      available: true,
      availability_type: "timestamp with time zone",
    });

    await sql`
      UPDATE jobs
      SET status = 'running', attempts = attempts + 1, started_at = CURRENT_TIMESTAMP
      WHERE id = ${jobId}
    `;
    await sql`
      UPDATE jobs
      SET status = 'completed', completed_at = CURRENT_TIMESTAMP
      WHERE id = ${jobId}
    `;

    const completed = await sql`
      SELECT status, attempts, started_at IS NOT NULL AS started, completed_at IS NOT NULL AS completed
      FROM jobs
      WHERE id = ${jobId}
    `;
    assert.deepEqual(completed[0], {
      status: "completed",
      attempts: 1,
      started: true,
      completed: true,
    });

    await sql`DELETE FROM organizations WHERE id = ${organizationId}`;
    const cascaded = await sql`SELECT id FROM jobs WHERE id = ${jobId}`;
    assert.equal(cascaded.length, 0);
  } finally {
    await sql`DELETE FROM jobs WHERE id = ${jobId}`;
    await sql`DELETE FROM organizations WHERE id = ${organizationId}`;
  }
});

test("jobs use availability and a lease token to make recovery claims exclusive", async () => {
  const organizationId = `db-test-org-${randomUUID()}`;
  const jobId = `db-test-job-${randomUUID()}`;
  const recoveredToken = randomUUID();
  const competingToken = randomUUID();

  try {
    await sql`
      INSERT INTO organizations (id, name, slug, updated_at)
      VALUES (${organizationId}, 'DB Test Organization', ${organizationId}, CURRENT_TIMESTAMP)
    `;
    await sql`
      INSERT INTO jobs (id, organization_id, type, status, available_at, lease_expires_at, lease_token, updated_at)
      VALUES (${jobId}, ${organizationId}, 'db.test', 'running', CURRENT_TIMESTAMP - INTERVAL '1 minute', CURRENT_TIMESTAMP - INTERVAL '1 second', 'crashed-worker', CURRENT_TIMESTAMP)
    `;

    const [first, second] = await Promise.all([
      sql`
        UPDATE jobs
        SET status = 'running', attempts = attempts + 1, lease_token = ${recoveredToken},
          lease_expires_at = CURRENT_TIMESTAMP + INTERVAL '5 minutes', started_at = CURRENT_TIMESTAMP
        WHERE id = ${jobId} AND status = 'running' AND lease_expires_at <= CURRENT_TIMESTAMP
        RETURNING id
      `,
      sql`
        UPDATE jobs
        SET status = 'running', attempts = attempts + 1, lease_token = ${competingToken},
          lease_expires_at = CURRENT_TIMESTAMP + INTERVAL '5 minutes', started_at = CURRENT_TIMESTAMP
        WHERE id = ${jobId} AND status = 'running' AND lease_expires_at <= CURRENT_TIMESTAMP
        RETURNING id
      `,
    ]);

    assert.equal(first.length + second.length, 1);
    const claimed = await sql`SELECT attempts, lease_token FROM jobs WHERE id = ${jobId}`;
    assert.equal(claimed[0]?.attempts, 1);
    assert.ok([recoveredToken, competingToken].includes(claimed[0]?.lease_token as string));
  } finally {
    await sql`DELETE FROM jobs WHERE id = ${jobId}`;
    await sql`DELETE FROM organizations WHERE id = ${organizationId}`;
  }
});

test("legacy running jobs without a lease are recoverable after the lease grace period", async () => {
  const organizationId = `db-test-org-${randomUUID()}`;
  const jobId = `db-test-job-${randomUUID()}`;
  try {
    await sql`
      INSERT INTO organizations (id, name, slug, updated_at)
      VALUES (${organizationId}, 'DB Test Organization', ${organizationId}, CURRENT_TIMESTAMP)
    `;
    await sql`
      INSERT INTO jobs (id, organization_id, type, status, started_at, lease_expires_at, updated_at)
      VALUES (${jobId}, ${organizationId}, 'db.test', 'running', CURRENT_TIMESTAMP - INTERVAL '6 minutes', NULL, CURRENT_TIMESTAMP)
    `;
    const recovered = await sql`
      UPDATE jobs
      SET status = 'queued', available_at = CURRENT_TIMESTAMP, lease_expires_at = NULL, lease_token = NULL
      WHERE id = ${jobId} AND status = 'running'
        AND lease_expires_at IS NULL
        AND started_at <= CURRENT_TIMESTAMP - INTERVAL '5 minutes'
      RETURNING status, available_at IS NOT NULL AS available
    `;
    assert.deepEqual(recovered[0], { status: "queued", available: true });
  } finally {
    await sql`DELETE FROM jobs WHERE id = ${jobId}`;
    await sql`DELETE FROM organizations WHERE id = ${organizationId}`;
  }
});

test("jobs reject an organization that does not exist", async () => {
  const jobId = `db-test-orphan-${randomUUID()}`;
  await assert.rejects(
    sql`
      INSERT INTO jobs (id, organization_id, type, updated_at)
      VALUES (${jobId}, ${`missing-org-${randomUUID()}`}, 'db.test', CURRENT_TIMESTAMP)
    `,
  );
});
