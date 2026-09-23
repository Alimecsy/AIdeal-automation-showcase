import assert from "node:assert/strict";
import { test } from "node:test";
import { ClerkAuthGuard } from "../src/modules/auth/clerk-auth.guard";

type Claims = Record<string, unknown>;

/**
 * The guard holds its token verifier as a replaceable member, so these tests
 * exercise the guard's own contract — what it does with a verified payload,
 * and what it does when verification throws — without a live Clerk instance.
 */
function guardWith(verify: (token: string) => Promise<Claims>) {
  const guard = new ClerkAuthGuard();
  Object.defineProperty(guard, "verify", { value: verify });
  return guard;
}

function contextFor(request: Record<string, unknown>) {
  return { switchToHttp: () => ({ getRequest: () => request }) } as never;
}

test("a verified token populates the auth context from flat v1 organization claims", async () => {
  const guard = guardWith(async () => ({
    sub: "user_1",
    org_id: "org_1",
    org_role: "org:admin",
    org_slug: "acme",
  }));
  const request: Record<string, unknown> = {
    headers: { authorization: "Bearer real-token" },
  };

  assert.equal(await guard.canActivate(contextFor(request)), true);
  assert.deepEqual(request.auth, {
    clerkUserId: "user_1",
    clerkOrgId: "org_1",
    orgRole: "org:admin",
    orgSlug: "acme",
  });
});

test("a verified token populates the auth context from nested v2 organization claims", async () => {
  const guard = guardWith(async () => ({
    sub: "user_1",
    o: { id: "org_1", rol: "admin", slg: "acme" },
  }));
  const request: Record<string, unknown> = {
    headers: { authorization: "Bearer real-token" },
  };

  assert.equal(await guard.canActivate(contextFor(request)), true);
  assert.deepEqual(request.auth, {
    clerkUserId: "user_1",
    clerkOrgId: "org_1",
    orgRole: "admin",
    orgSlug: "acme",
  });
});

test("a personal-account token is accepted with no organization scope", async () => {
  const guard = guardWith(async () => ({ sub: "user_1" }));
  const request: Record<string, unknown> = {
    headers: { authorization: "Bearer real-token" },
  };

  // The workspace boundary, not this guard, decides that a caller without an
  // organization cannot reach tenant-scoped data.
  assert.equal(await guard.canActivate(contextFor(request)), true);
  assert.deepEqual(request.auth, {
    clerkUserId: "user_1",
    clerkOrgId: null,
    orgRole: null,
    orgSlug: null,
  });
});

test("a token that fails verification is rejected as unauthorized", async () => {
  const guard = guardWith(async () => {
    throw new Error("JWT signature is invalid");
  });

  await assert.rejects(
    guard.canActivate(
      contextFor({ headers: { authorization: "Bearer forged-token" } }),
    ),
    /Invalid Clerk token/,
  );
});

test("a verified token without a subject is rejected", async () => {
  const guard = guardWith(async () => ({ org_id: "org_1" }));

  await assert.rejects(
    guard.canActivate(
      contextFor({ headers: { authorization: "Bearer real-token" } }),
    ),
    /Missing Clerk user id/,
  );
});

test("a request without a bearer token never reaches verification", async () => {
  let verifications = 0;
  const guard = guardWith(async () => {
    verifications += 1;
    return { sub: "user_1" };
  });

  for (const headers of [{}, { authorization: "real-token" }]) {
    await assert.rejects(
      guard.canActivate(contextFor({ headers })),
      /Missing authorization token/,
    );
  }

  assert.equal(verifications, 0);
});
