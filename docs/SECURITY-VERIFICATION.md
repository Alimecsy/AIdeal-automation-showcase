# Security Verification

The API security checks are split between deterministic tests and environment-dependent verification.

## Covered locally

`tests/storage.security.test.ts` covers upload metadata limits, presign expiry, R2 HEAD metadata checks, and bounded magic-byte checks for declared file types. `tests/intake-security.test.ts` covers session and organization storage-key boundaries. `tests/public-rate-limit.service.test.ts` covers local-window enforcement and identity isolation. `tests/api-boundary.security.test.ts` covers CORS policy, limiter ordering, and organization-scoped reads. `tests/organizations.security.test.ts` covers rejecting a body organization that differs from the authenticated Clerk organization.

Magic-byte checks are a format-signature guard, not full malware scanning or document parsing. Office formats are checked for their ZIP or OLE container signature; they are not unpacked or semantically validated at this boundary.

## Requires live verification

- **R2:** run an upload-confirmation test against a disposable bucket with a real presigned upload, a wrong-content-type object, a wrong-magic-byte object, an expired URL, and an object outside the session prefix. Delete all test objects afterward.
- **Upstash Redis:** run public rate-limit tests with `UPSTASH_REDIS_REST_URL` and the write token to verify atomic `INCR`/`EXPIRE` behavior, expiry, and failure handling. Do not use the read-only token for these writes.
- **Multiple API instances:** run the same public limiter test concurrently against at least two API instances using the same Upstash database, confirming the limit is shared rather than process-local.
- **Clerk:** exercise a real token with no organization, an inactive membership, and a user belonging to a different organization; confirm the API returns the expected denial without disclosing cross-organization records.

These live checks are not claimed as executed by the repository unit-test suite.
