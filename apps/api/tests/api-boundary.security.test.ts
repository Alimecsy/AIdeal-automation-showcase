import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpException } from "@nestjs/common";
import { ConflictException } from "@nestjs/common";
import { isAllowedCorsOrigin } from "../src/cors-policy";
import {
  PublicIntakeFormsController,
  PublicIntakeSessionsController,
} from "../src/modules/intake-forms/intake-forms.controller";
import { DocumentsService } from "../src/modules/documents/documents.service";
import { JobsService } from "../src/modules/jobs/jobs.service";

test("CORS allows configured origins and same-origin requests, but rejects arbitrary origins", () => {
  const allowed = new Set(["https://app.example.com"]);
  assert.equal(isAllowedCorsOrigin(undefined, allowed), true);
  assert.equal(isAllowedCorsOrigin("https://app.example.com", allowed), true);
  assert.equal(isAllowedCorsOrigin("https://attacker.example", allowed), false);
});

test("public form endpoints apply the limiter before invoking workflow operations", async () => {
  const calls: string[] = [];
  const workflow = {
    getPublicForm: async () => { calls.push("form"); return { id: "form-1" }; },
    createPublicSession: async () => { calls.push("session"); return { id: "session-1" }; },
  };
  const limiter = {
    assertAllowed: async (scope: string) => {
      calls.push(`limit:${scope}`);
      if (scope === "create-session") throw new HttpException("Too many requests", 429);
    },
  };
  const controller = new PublicIntakeFormsController(workflow as never, limiter as never);

  await controller.getPublicForm("slug", { ip: "192.0.2.1" });
  await assert.rejects(
    controller.createPublicSession("slug", { applicantEmail: "a@example.com" }, { ip: "192.0.2.1" }),
    /Too many requests/,
  );
  assert.deepEqual(calls, ["limit:public-form", "form", "limit:create-session"]);
});

test("every public session mutation and upload operation is throttled", async () => {
  const calls: string[] = [];
  const workflow = {
    getPublicSession: async () => { calls.push("get"); },
    savePublicSession: async () => { calls.push("save"); },
    submitPublicSession: async () => { calls.push("submit"); },
    createUploadIntent: async () => { calls.push("presign"); },
    confirmUploadedDocument: async () => { calls.push("confirm"); },
  };
  const limiter = { assertAllowed: async () => { calls.push("limit"); } };
  const controller = new PublicIntakeSessionsController(workflow as never, limiter as never);
  const request = { ip: "192.0.2.2" };
  const body = { applicantEmail: "a@example.com", answersJson: {} };

  await controller.getSession("token", request);
  await controller.saveSession("token", body, request);
  await controller.submitSession("token", body, request);
  await controller.presignUpload("token", {
    documentType: "financials", filename: "brief.pdf", mimeType: "application/pdf", sizeBytes: 1,
  }, request);
  await controller.confirmUpload("token", {
    documentType: "financials", originalFilename: "brief.pdf", storageKey: "key",
    mimeType: "application/pdf", sizeBytes: 1,
  }, request);

  assert.deepEqual(calls, ["limit", "get", "limit", "save", "limit", "submit", "limit", "presign", "limit", "confirm"]);
});

test("document and job reads are organization-scoped", async () => {
  const documentQueries: unknown[] = [];
  const jobQueries: unknown[] = [];
  const documents = new DocumentsService({
    document: { findFirst: async (query: unknown) => { documentQueries.push(query); return null; } },
  } as never, {} as never);
  const jobs = new JobsService({
    job: { findMany: async (query: unknown) => { jobQueries.push(query); return []; } },
  } as never);

  await assert.rejects(documents.getDocument("org-a", "document-from-org-b"), /Document not found/);
  await jobs.list("org-a");

  assert.deepEqual((documentQueries[0] as { where: unknown }).where, {
    id: "document-from-org-b",
    organizationId: "org-a",
  });
  assert.deepEqual((jobQueries[0] as { where: unknown }).where, { organizationId: "org-a" });
  assert.equal((jobQueries[0] as { select: Record<string, boolean> }).select.availableAt, true);
  assert.equal((jobQueries[0] as { select: Record<string, boolean> }).select.leaseExpiresAt, true);
});

test("manual retry rejects an active leased job without clearing its lease", async () => {
  let updates = 0;
  const jobs = new JobsService({
    job: {
      findFirst: async () => ({
        id: "job-1", organizationId: "org-a", type: "document.extract", status: "running",
        attempts: 1, leaseToken: "active-lease", leaseExpiresAt: new Date(),
      }),
      updateMany: async () => { updates += 1; return { count: 1 }; },
    },
  } as never);

  await assert.rejects(jobs.retry("org-a", "job-1"), ConflictException);
  assert.equal(updates, 0);
});
