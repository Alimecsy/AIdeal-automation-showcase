# AIDEAL Deployment Runbook

Staging-first release procedure for the current `0.1.0` alpha. This document
covers deployment readiness only; it does not claim that production has been
deployed or that provider-specific configuration has been verified.

## Runtime Shape

The repository currently builds three long-running application services:

| Service | Build | Start | Required role |
|---|---|---|---|
| Web | `pnpm --filter @aideal/web build` | `pnpm --filter @aideal/web exec next start` | Next.js UI and public API proxy routes |
| API | `pnpm --filter @aideal/api build` | `pnpm --filter @aideal/api start` | NestJS HTTP API on `/api/*` |
| Worker | `pnpm --filter @aideal/worker build` | `pnpm --filter @aideal/worker start` | Prisma-backed job polling, lease recovery, and job processing |

The Scrapling service is Python and currently listens on
`127.0.0.1:8766`. In staging it must run in the same network namespace as the
worker, or the service must be intentionally exposed and `RESEARCH_SCRAPER_URL`
must point to that reachable address. No process supervisor or hosting
provider configuration is committed in this repository.

## Release Preconditions

1. Use a staging Neon database, staging R2 bucket, staging Upstash Redis
   database (for the API's distributed public rate limits and the scraper's
   shared cache/rate limits), staging Clerk instance, and staging
   AI/research/email credentials. The worker scheduler does not use Redis.
   Never place credentials in Git, command history, test fixtures, or logs.
2. Confirm the target service can run Node 24-compatible builds, pnpm 11, and
   the Scrapling Python environment described in
   `apps/research-scraper/README.md`.
3. From a clean checkout, run:

   ```bash
   pnpm install --frozen-lockfile
   pnpm typecheck
   pnpm build
   pnpm --filter @aideal/shared test
   pnpm --filter @aideal/api test
   pnpm --filter @aideal/worker test
   git diff --check
   ```

   These are repository-defined checks. Provider deployment success is not
   inferred from them.

## Environment And Secrets

Configure variables through the hosting provider's secret/environment store,
with separate values for staging and production. Start from `.env.example`;
the parser in `packages/env/src/index.ts` defines defaults and accepted names.

Required for the deployed API and worker:

- `NODE_ENV=production`
- `DATABASE_URL` for Neon HTTP/Prisma access
- `API_CORS_ORIGINS` containing the exact staging web origin
- Clerk keys: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`
- R2 credentials: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  and `R2_BUCKET`
- AI credentials and selection: `AI_DEFAULT_PROVIDER`, plus the matching
  Gemini or OpenRouter key and model variables
- `TAVILY_API_KEY` and a reachable `RESEARCH_SCRAPER_URL`

The API and scraper additionally require `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` in staging. The API uses the write-capable token
for distributed public-form rate limits; the scraper uses it for its shared
per-domain spacing locks and extraction cache. Redis is not a worker queue and
the worker requires no Redis credentials for job scheduling.

The web service additionally needs `API_BASE_URL` pointing at the staging API.
This variable is read by the Next.js server-side backend proxy but is not
currently listed in `.env.example`; configure it explicitly in the web
environment. Email variables are required only when email delivery is enabled:
`EMAIL_PROVIDER`, the matching provider token, and `FROM_EMAIL`.

Do not give write-capable Redis credentials to the worker merely for job
processing: it polls the `jobs` table directly. The scraper needs a
write-capable token for its shared cache/rate-limit implementation, subject to
the provider's secret policy. A read-only token cannot perform those writes.

## Staging Database Release

Run database changes as an explicit, reviewed release step before starting the
new API/worker version. Prisma migration commands must use only the verified
wrapper; never invoke `prisma migrate` directly or supply `DATABASE_URL`/
`DIRECT_URL` as a Prisma migration target.

### New staging database

The verified migration interface currently supports only `local`, `ci`, and
`disposable` profiles. Do not run a staging or production migration until a
lead-approved target policy and release procedure are added. The old
`DIRECT_URL`/raw-Prisma staging command is retired.

Use a fresh, empty database only. This replays the immutable Prisma migration
history: the pre-lease baseline followed by the additive durable-job-lease
migration. For an approved disposable release rehearsal, provide
`MIGRATION_DATABASE_URL`, `AIDEAL_MIGRATION_TARGET=disposable`, the exact
expected host/database identity, and the reviewed fingerprint printed by the
wrapper before invoking `pnpm db:migrate:disposable`. Every non-local deploy,
including CI, must provide that fingerprint as `AIDEAL_MIGRATION_APPROVAL`.
Do not use the pooled application URL for this command.

`packages/db/prisma/init.sql` and `scripts/bootstrap-neon.ts` are retained for
the historical HTTP bootstrap path, but are not the release mechanism for new
empty environments. Do not combine bootstrap and `migrate:deploy` on the same
database.

### Existing staging database

First take the provider-supported backup/snapshot and inspect the patch in
`packages/db/scripts/patch-notifications.ts`. Then run:

```bash
env DATABASE_URL="$STAGING_DATABASE_URL" \
  pnpm --filter @aideal/db patch:notifications
```

This patch adds notification event identity columns, backfills existing rows,
sets them non-null, and creates the organization/dedupe unique index. It is
idempotent for the statements it owns. Do not run the empty-database bootstrap
against an existing database.

For a database created by the legacy bootstrap **before** durable job leases,
drain every worker, then apply the reviewed lease SQL directly as the
one-time forward upgrade:

```bash
psql "$STAGING_DIRECT_URL" --set ON_ERROR_STOP=1 --single-transaction \
  --file packages/db/prisma/migrations/20260804120000_add_durable_job_leases/migration.sql
```

Do not run the new baseline migration, `prisma migrate deploy`,
`prisma migrate resolve`, or `init.sql` against an existing bootstrap database.
The baseline is intentionally not idempotent: it is an accurate creation
history, not an adoption mechanism. A database already containing the lease
columns needs no lease SQL; record its schema state in the release ticket.
Legacy bootstrap databases remain on explicit, reviewed forward-upgrade
scripts until a separately designed and tested history-adoption process is
approved. Never manufacture or edit `_prisma_migrations` rows manually.

After the patch and, where applicable, lease upgrade, verify the release schema
using a staging-only database query or the provider console. Confirm the
`jobs.available_at`, `jobs.lease_expires_at`, and `jobs.lease_token` columns
and both `jobs_status_*` lease indexes exist before starting a lease-aware
worker. The application should not be switched to the new
notification-producing or lease-aware worker until this check succeeds.

## Deploy And Start Order

1. Deploy the API image/build with staging secrets and the exact commit under
   test.
2. Apply the database step above and confirm it completed successfully.
3. Deploy/start the Scrapling process. Verify its `/health` endpoint from the
   worker's network namespace and run one bounded `/extract` smoke check against
   an approved public URL. Respect robots policy and do not use real applicant
   data.
4. Deploy/start exactly one staging worker initially:

   ```bash
   pnpm --filter @aideal/worker start
   ```

   Confirm the startup log contains `service: "aideal-worker"` and
   `ok: true`. Enqueue a harmless staging test job or submit a synthetic intake
   and observe the job transition from `queued` to `running` to `completed` in
   the staging database. The worker polls jobs whose `available_at` is due,
   claims them with an atomic status update, and fences processing with a lease
   token. It renews the lease while processing; a later worker poll requeues an
   expired lease for recovery. The worker has no HTTP health endpoint; process
   liveness, claim/heartbeat logs, and a completed database job are the
   available checks.

5. Deploy the web service with `API_BASE_URL` set to the staging API origin.
   Confirm the public form, authenticated workspace, and API proxy routes load.
6. Scale additional worker instances only after the one-worker smoke test and
   Neon claim/lease behavior are observed. Concurrent workers may poll the same
   eligible row, but the conditional database claim allows only one lease owner
   to process it; stale lease writes are rejected. Provider scaling semantics
   are not verified here.

## Health And Smoke Checks

From a network location allowed to reach staging:

```bash
curl -fsS https://staging-api.example.com/api/health
curl -fsS https://staging-scraper.example.com/health
```

The API response must have `ok: true` and `redis: "ok"`. `redis:
"not_configured"` is a configuration failure for staging; `redis: "error"`
requires investigation. This verifies the API's Redis-backed rate-limit
dependency, not worker job scheduling. The endpoint does not verify Neon
connectivity, R2, Clerk, Gemini, Tavily, email, or Scrapling.

Run a synthetic staging smoke test covering:

- public intake session creation and submission;
- document presign, upload, confirm, and extraction;
- AI packet generation and research collection;
- reviewer evidence decision and queued SOP reevaluation;
- in-app notification creation/read state and usage summary visibility;
- one intentional failure/retry path without real customer data.

Record timestamps, commit SHA, service logs, job IDs, and pass/fail outcomes in
the release ticket. Redact tokens, signed URLs, prompts, source payloads, and
personal data.

## Rollback

1. Stop promotion to production and preserve the staging failure evidence.
2. For an application-only regression, redeploy the last known-good web, API,
   and worker artifact from the release system. Keep API and worker versions
   compatible with the database schema.
3. Do not automatically roll back a database schema. Restore from the approved
   backup or apply a reviewed forward-fix after confirming whether the
   notification patch has already run. The notification patch has no automatic
   down migration in this repository.
4. Pause or stop the worker before replaying queued jobs when necessary. Inspect
   database job statuses, availability timestamps, attempts, and leases; retry
   only the intended staging jobs. Do not bulk-delete or requeue jobs blindly.
5. Re-run `/api/health`, the Scrapling check, and a minimal synthetic smoke test
   after rollback. Document the resulting commit and schema state.

## Production Gate

Production is not ready merely because `pnpm build` passes or staging services
start. Promote only after staging smoke evidence is recorded, provider backups
and rollback ownership are confirmed, secrets are configured outside Git, the
notification patch has been reviewed/applied as appropriate, and the remaining
live R2, Upstash multi-instance, and Clerk boundary checks have an explicit
result. This runbook is documentation evidence for the release-readiness workstream, not a
production deployment record.

## Verification Boundary

Verified from the repository: package build/start commands, environment names
and defaults, API route prefix and health response shape, worker polling/startup
behavior, scraper bind address/endpoints/policy controls, bootstrap script, and
notification patch behavior. Unverified here: hosting-provider build settings,
domains/TLS, Neon/R2/Upstash/Clerk provider configuration, secret injection,
network topology, autoscaling, process supervision, backups, and actual staging
or production deployment.
