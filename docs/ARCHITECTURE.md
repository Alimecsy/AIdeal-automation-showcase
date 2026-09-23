# AIDEAL Architecture Contract

This document is the implementation contract for future AIDEAL builds. It records boundaries and invariants that should remain true as features are added.

## Domain Boundaries

- `IntakeWorkflowService` owns public form/session orchestration.
- `IntakeFormsService` owns intake persistence details behind that workflow boundary.
- `DealsService` owns deal creation, lifecycle transitions, review actions, and deal audit history.
- `DocumentsService` owns document records and document job requests.
- `JobsService` owns queue persistence and enqueueing through `JobsPort`.
- `R2StorageService` owns R2 implementation details behind `StoragePort`.
- `JobProcessor` owns worker dispatch; individual handlers own job behavior.

New business behavior should be added to the owning module, not to a controller, worker entrypoint, or unrelated service.

## Infrastructure Rules

1. Depend on `JobsPort` and `StoragePort` at application boundaries.
2. Keep provider-specific code in adapters (`R2StorageService`, AI adapters, Redis integration).
3. Keep worker startup limited to configuration, polling, shutdown, and processor construction.
4. Add new job types through a dedicated handler and explicit payload validation.
5. Keep external calls observable through persisted job/run status and error messages.

## State And Reliability Invariants

- Deal status changes must use `DealsService` and a validated transition map.
- Every state-changing review action must create audit/history records.
- Jobs must be safe to retry. A retry must not duplicate an AI run, document extraction, deal, or notification.
- Jobs must persist `queued`, `running`, `completed`, and `failed` states where applicable.
- Failure paths must persist a useful error message and update dependent domain state.
- Queue consumers must tolerate duplicate delivery and already-completed jobs.

## Testing Contract

Every new domain behavior should have a focused test at the owning boundary. Prefer in-memory ports for unit tests and reserve Neon, Redis, R2, and Gemini calls for explicit integration checks.

Minimum coverage for the next build slices:

- `DealsService`: valid transitions, invalid transitions, organization scoping, audit history
- `IntakeWorkflowService`: public session submit and upload orchestration
- `JobProcessor`: success, failure, unsupported type, duplicate completed job
- `JobsPort` and `StoragePort`: adapter contract behavior
- End-to-end: one document extraction followed by one deal packet generation

## Definition Of Done

Before a substantial slice is considered complete:

1. The change is placed in the correct module boundary.
2. Retry and idempotency behavior is considered explicitly.
3. Focused tests are added or the missing test infrastructure is recorded.
4. `pnpm typecheck` passes.
5. `pnpm build` passes.
6. The changed runtime path is exercised when practical.
7. The implementation and its verification evidence are recorded in the project change log.

## Review Questions

Before merging or committing a build slice, ask:

- Did this add business logic to the correct owner?
- Can this external dependency be replaced in a unit test?
- What happens if the queue delivers this job twice?
- What state and audit records exist after failure?
- Is the new behavior visible in logs, persisted status, or metrics?
- Does the build still work with the configured Gemini Lite and Upstash paths?
