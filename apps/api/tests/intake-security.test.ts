import assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { IntakeFormsService } from "../src/modules/intake-forms/intake-forms.service";

test("upload confirmation rejects a storage key from another session before verification", async () => {
  let verificationCalled = false;
  const prisma = {
    intakeSession: {
      findFirst: async () => ({
        id: "session-1",
        organizationId: "org-1",
        intakeFormId: "form-1",
        status: "in_progress",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    },
  };
  const storage = {
    validateUpload: () => undefined,
    verifyUploadedObject: async () => { verificationCalled = true; },
  };
  const service = new IntakeFormsService(prisma as never, storage as never, {} as never, {} as never);

  await assert.rejects(
    service.confirmUploadedDocument("token", {
      documentType: "financials",
      originalFilename: "brief.pdf",
      storageKey: "public-intake/org-1/session-2/object.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1,
    }),
    BadRequestException,
  );
  assert.equal(verificationCalled, false);
});

test("upload confirmation rejects traversal-like keys within a session prefix", async () => {
  let verificationCalled = false;
  const prisma = {
    intakeSession: {
      findFirst: async () => ({
        id: "session-1",
        organizationId: "org-1",
        intakeFormId: "form-1",
        status: "in_progress",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    },
  };
  const storage = {
    validateUpload: () => undefined,
    verifyUploadedObject: async () => { verificationCalled = true; },
  };
  const service = new IntakeFormsService(prisma as never, storage as never, {} as never, {} as never);

  await assert.rejects(
    service.confirmUploadedDocument("token", {
      documentType: "financials",
      originalFilename: "brief.pdf",
      storageKey: "public-intake/org-1/session-1/../other/object.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1,
    }),
    BadRequestException,
  );
  assert.equal(verificationCalled, false);
});
