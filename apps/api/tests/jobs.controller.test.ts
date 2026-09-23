import assert from "node:assert/strict";
import { test } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JobsController } from "../src/modules/jobs/jobs.controller";
import { ROLES_KEY } from "../src/modules/auth/roles.decorator";
import { RolesGuard } from "../src/modules/auth/roles.guard";

const ownerWorkspace = {
  organization: { id: "org-1", name: "Organization", slug: "organization" },
  membership: { role: "owner_admin", status: "active" },
  user: { id: "user-1", clerkUserId: "clerk-user-1", email: "owner@example.com", name: "Owner" },
} as const;

function contextFor(
  handler: Function,
  role: "owner_admin" | "analyst" | "reviewer" | "approver",
) {
  return {
    getHandler: () => handler,
    getClass: () => JobsController,
    switchToHttp: () => ({ getRequest: () => ({ workspace: { membership: { role } } }) }),
  } as never;
}

function createControllerPolicyTestSeam() {
  const calls: string[] = [];
  const jobs = {
    enqueue: async () => { calls.push("enqueue"); },
    enqueueAi: async () => { calls.push("enqueueAi"); },
    retry: async () => { calls.push("retry"); },
  };
  const controller = new JobsController(jobs as never);
  const reflector = new Reflector();
  return {
    calls,
    controller,
    guard: new RolesGuard(reflector),
    mutations: [controller.enqueueTest, controller.enqueueAiTest, controller.retry],
    reflector,
  };
}

function assertMutationDeniedBeforeService(
  role: "analyst" | "reviewer" | "approver",
) {
  const { calls, guard, mutations } = createControllerPolicyTestSeam();

  for (const mutation of mutations) {
    let error: unknown;
    try {
      guard.canActivate(contextFor(mutation, role));
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof ForbiddenException);
    assert.equal(error.getStatus(), 403);
    assert.deepEqual(error.getResponse(), {
      message: "Insufficient organization role",
      error: "Forbidden",
      statusCode: 403,
    });
  }
  assert.deepEqual(calls, []);
}

test("job mutation endpoints deny analysts before invoking the jobs service", () => {
  assertMutationDeniedBeforeService("analyst");
});

test("job mutation endpoints deny reviewers before invoking the jobs service", () => {
  assertMutationDeniedBeforeService("reviewer");
});

test("job mutation endpoints deny approvers before invoking the jobs service", () => {
  assertMutationDeniedBeforeService("approver");
});

test("job mutation endpoints allow owner_admin and leave job reads unrestricted", async () => {
  const { calls, controller, guard, mutations, reflector } = createControllerPolicyTestSeam();

  for (const mutation of mutations) {
    assert.equal(guard.canActivate(contextFor(mutation, "owner_admin")), true);
  }
  assert.equal(
    reflector.getAllAndOverride(ROLES_KEY, [controller.list, JobsController]),
    undefined,
  );

  await controller.enqueueTest(ownerWorkspace as never, {});
  await controller.enqueueAiTest(ownerWorkspace as never, { prompt: "Test prompt" });
  await controller.retry(ownerWorkspace as never, "job-1");
  assert.deepEqual(calls, ["enqueue", "enqueueAi", "retry"]);
});
