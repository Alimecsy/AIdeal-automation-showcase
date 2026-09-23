import assert from "node:assert/strict";
import { test } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { OrganizationsController } from "../src/modules/organizations/organizations.controller";

test("organization bootstrap rejects a body organization different from the Clerk claim", async () => {
  const service = { bootstrapOrganization: async () => ({ id: "unexpected" }) };
  const controller = new OrganizationsController(service as never);

  await assert.rejects(
    async () => controller.bootstrapOrganization(
        { clerkUserId: "user-1", clerkOrgId: "org-1" } as never,
        {
          organization: { id: "org-2", name: "Other", slug: "other" },
          user: { email: "user@example.com", name: "User" },
        },
      ),
    ForbiddenException,
  );
});
