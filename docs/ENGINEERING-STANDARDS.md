# AIDEAL Enterprise Hardening Constitution

**Version:** 1.0  
**Owner:** Lead Orchestrator  
**Program:** GitHub-tracked enterprise hardening

## Objective

Strengthen the existing AIDEAL MVP before adding new product capability, with every change traceable to a GitHub issue, a bounded implementation brief, tests, review, and an explicit verification record.

## Non-negotiable standards

- Preserve tenant isolation, authorization, auditability, and secure document handling.
- Make lifecycle side effects explicit, idempotent, and observable.
- Prefer small, deep modules with stable interfaces over broad cross-cutting changes.
- Add tests at the public seam of each changed behavior; do not weaken tests to hide defects.
- Keep production integration tests opt-in and refuse to use production database credentials.
- Do not silently change shared contracts, Prisma schema, or deployment behavior.
- Every implementation must reference a GitHub issue and report files, tests, assumptions, and remaining risks.

## Definition of done

An issue is complete only when its acceptance criteria pass, focused tests and typechecks pass, the change has independent review, and its issue contains a completion note with evidence.

## Protected fields

Tenant scoping, authentication/authorization, database migrations, secrets/configuration, and public API contracts require lead-orchestrator approval before a specialist changes them.

