import assert from "node:assert/strict";
import { test } from "node:test";
import { OrganizationsService } from "../src/modules/organizations/organizations.service";

const input = {
  clerkOrganizationId: "org-1",
  organizationName: "Acme",
  organizationSlug: "acme",
  clerkUserId: "user-1",
  email: "owner@acme.test",
  name: "Owner",
};

const existingWorkspace = {
  organization: { id: "org-1", name: "Acme", slug: "acme" },
  membership: { role: "owner_admin", status: "active" },
  user: {
    id: "local-1",
    clerkUserId: "user-1",
    email: "owner@acme.test",
    name: "Owner",
  },
};

function uniqueViolation() {
  return Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
    meta: { target: ["email"] },
  });
}

/**
 * Builds the service with a stubbed Prisma seam. `transaction` decides what the
 * provisioning transaction does; `workspace` is what a subsequent read finds.
 */
function serviceWith(options: {
  transaction: () => Promise<unknown>;
  workspace?: unknown;
}) {
  let reads = 0;
  const prisma = {
    $transaction: async (fn: unknown) => {
      void fn;
      return options.transaction();
    },
    organizationMembership: {
      findFirst: async () => {
        reads += 1;
        return options.workspace ?? null;
      },
    },
  };

  return {
    service: new OrganizationsService(prisma as never),
    reads: () => reads,
  };
}

test("a bootstrap that loses a concurrent race returns the workspace the caller asked for", async () => {
  const { service, reads } = serviceWith({
    transaction: async () => {
      throw uniqueViolation();
    },
    workspace: {
      role: "owner_admin",
      status: "active",
      organization: existingWorkspace.organization,
      user: existingWorkspace.user,
    },
  });

  const result = await service.bootstrapOrganization(input);

  assert.deepEqual(result.organization, existingWorkspace.organization);
  assert.equal(result.user.clerkUserId, "user-1");
  assert.equal(result.membership.role, "owner_admin");
  assert.equal(reads(), 1);
});

test("a unique violation with no resulting workspace is still surfaced", async () => {
  // The intended outcome does not hold, so the caller must not be told it does.
  const error = uniqueViolation();
  const { service } = serviceWith({
    transaction: async () => {
      throw error;
    },
    workspace: null,
  });

  await assert.rejects(service.bootstrapOrganization(input), (thrown) => {
    assert.equal(thrown, error);
    return true;
  });
});

test("a failure that is not a unique violation is never swallowed", async () => {
  const error = Object.assign(new Error("connection terminated"), {
    code: "P1017",
  });
  const { service, reads } = serviceWith({
    transaction: async () => {
      throw error;
    },
    workspace: {
      role: "owner_admin",
      status: "active",
      organization: existingWorkspace.organization,
      user: existingWorkspace.user,
    },
  });

  await assert.rejects(service.bootstrapOrganization(input), (thrown) => {
    assert.equal(thrown, error);
    return true;
  });
  // A non-identity failure must not be reinterpreted by reading the workspace.
  assert.equal(reads(), 0);
});

test("a bootstrap that wins the race returns its own transaction result", async () => {
  const provisioned = { ...existingWorkspace };
  const { service, reads } = serviceWith({
    transaction: async () => provisioned,
  });

  const result = await service.bootstrapOrganization(input);

  assert.equal(result, provisioned);
  assert.equal(reads(), 0);
});
