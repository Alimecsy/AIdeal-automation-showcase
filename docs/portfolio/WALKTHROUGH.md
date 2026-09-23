# Reviewer walkthrough

Two paths, depending on how much time you want to spend.

- **Path A (2 minutes, no accounts):** run the checks and one deterministic demo command. This proves the reliability and scoring behavior without standing up any provider.
- **Path B (10–20 minutes, needs providers):** run the full application end to end.

All sample data in this folder is synthetic.

---

## Path A — verify without external services

```bash
corepack enable pnpm
pnpm install
pnpm db:generate

pnpm verify      # format check + unit/contract tests + typecheck
pnpm build
pnpm demo:sop    # runs the real SOP evaluator on the synthetic sample
```

`pnpm verify` runs 99 tests across the API, worker, shared contracts, and migration wrapper. One integration test (live PDF extraction plus a live model call) is skipped unless real provider credentials are present; everything else runs offline.

`pnpm demo:sop` executes [`samples/evaluate-sample.ts`](samples/evaluate-sample.ts), which calls the same `evaluateSop` function the worker calls, against [`samples/sop-template.json`](samples/sop-template.json) and [`samples/intake-answers.json`](samples/intake-answers.json). Its output should match [`samples/expected-sop-evaluation.json`](samples/expected-sop-evaluation.json) byte for byte. That file is not hand-written prose — it is the recorded output of the real evaluator.

It shows the same applicant scored twice:

| | Documents supplied | Score | Rating | Recommendation |
| --- | --- | --- | --- | --- |
| Before | company registration only | 60 | D | `request_proof_of_funds` |
| After | registration + proof of funds | 100 | A | `proceed` |

The interesting part is *why*: `categoryScores` records what each configured category earned out of what weight and whether it was met, and a mandatory-rule failure caps the rating regardless of the numeric score. Nothing in that path calls a model.

### The reliability behavior, by test

If you want to check the claims in the README rather than take them on faith, these tests are where each one lives:

| Claim | Test |
| --- | --- |
| Crash recovery via expired leases; stale workers cannot write | `apps/worker/tests/job-processor.test.ts` |
| Retry backoff bounds | `apps/worker/tests/job-processor.test.ts` |
| Lease-recovered finalization does not duplicate entities | `apps/worker/tests/deal-transitions.test.ts`, `job-processor.test.ts` |
| Outbox dedupe, backoff, dead-lettering, replay | `apps/worker/tests/notification-outbox.test.ts` |
| Duplicate submission returns the original submission | `apps/api/tests/intake-workflow.service.test.ts`, `intake-submissions.service.test.ts` |
| Deal transition map and audit history | `apps/api/tests/deals.service.test.ts` |
| Worker cannot transition a deal without a valid internal token | `apps/api/tests/internal-deals.controller.test.ts` |
| Upload scope, presign expiry, magic-byte checks | `apps/api/tests/storage.security.test.ts`, `intake-security.test.ts` |
| Cross-organization reads are refused | `apps/api/tests/organizations.security.test.ts`, `api-boundary.security.test.ts` |
| Migrations refuse the application database | `packages/db/tests/migration-target.test.ts` |

---

## Path B — run the workflow end to end

### What you need

| Dependency | Why | Substitute |
| --- | --- | --- |
| PostgreSQL | domain, queue, and outbox state | a local or disposable database |
| S3-compatible object storage | document upload and extracted text | required for the document path |
| Clerk | organizations, memberships, roles | required to reach the reviewer console |
| Gemini or OpenRouter key | deal packet + research synthesis | required for the AI steps |
| Tavily key + the Python scraper | research collection | optional; the rest of the pipeline runs without it |
| Upstash Redis | shared public rate limits | optional; falls back to process-local counters |

Copy `.env.example` to `.env` and fill in your own values. No real values are published in this repository.

### Steps

1. **Start.**

   ```bash
   pnpm db:migrate:local   # local/disposable database only — the wrapper enforces this
   pnpm dev                # web + api + worker
   ```

   The worker logs `{"ok":true,"service":"aideal-worker",...}` on startup and then polls for jobs.

2. **Configure the intake.** Sign in, create an organization, then create a deal type, an SOP template, and an intake form. [`samples/sop-template.json`](samples/sop-template.json) gives the shape of the rules: document requirements, scoring weights, mandatory rules, red-flag rules, and recommendation rules. These are per-organization configuration, not code.

3. **Submit as an applicant.** Open the public form at `/forms/:slug` in a private window — no account needed. Use the values in [`samples/intake-answers.json`](samples/intake-answers.json), and upload the company-registration document but *not* the proof of funds, so you can watch the missing-requirement path. Documents go directly to object storage through a presigned URL scoped to the organization and session prefix.

   **Worth doing:** submit the same session twice. The second submission does not create a second deal — the unique constraint on the session catches it and the original submission is returned.

4. **Watch the queue.** As the worker picks up each job, the jobs list (`/api/jobs`, or the worker's stdout) shows the chain advance:

   `intake.finalize` → `document.extract` → `ai.generate` → `research.collect` → `sop.evaluate`

   Each job logs a structured `job.claimed` line with its lease token prefix, then heartbeats while it runs.

   **Worth doing:** kill the worker (`SIGKILL`) while a job is running and restart it. The lease expires, the job is recovered, and it completes without duplicating any entity it had already created.

5. **Inspect the intermediate artifacts.** Open the deal at `/app/deals/:submissionId`:
   - the extracted document text and its extraction status;
   - the AI deal packet — summary, key facts, risks, missing information, recommendation, confidence — with the `AiRun` record showing provider, model, and prompt version;
   - the research report, with every claim sorted into verified facts, unverified claims, inconsistencies, or red flags, and each carrying its source IDs.

6. **Read the recommendation.** The SOP evaluation panel shows the score, the per-category breakdown, mandatory failures, red flags, and the recommendation — and because the evaluator is deterministic, the breakdown fully explains the number.

7. **Act as the human reviewer.** Record an evidence decision on a research source (`confirmed`, `dismissed`, or `follow_up`), then take a review action on the deal. Confirmed red-flag evidence and outstanding follow-ups change the recommendation on re-evaluation; a follow-up forces `manual_review`.

   **Worth doing:** try to move the deal to a status the transition map does not allow. It is rejected at the service boundary, not in the UI.

8. **Check the audit trail and notifications.** The deal page shows its status history and activity/audit entries. `/app/notifications` shows the in-app notifications the outbox dispatcher delivered. Each notification carries the originating event's dedupe key, so a redelivery is a no-op rather than a duplicate.

### Known gaps you will notice

- Email notifications are not implemented; the in-app consumer is.
- The reviewer UI is functional, not designed.
- Research requires a search key and the Python scraper service. Without a search key the research step is skipped entirely (`queueResearchIfConfigured` returns early) and the deal still extracts, generates its packet, and evaluates.
