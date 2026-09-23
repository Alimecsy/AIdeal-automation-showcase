import assert from "node:assert/strict";
import { test } from "node:test";
import { IntakeFormsService } from "../src/modules/intake-forms/intake-forms.service";
import { IntakeWorkflowService } from "../src/modules/intake-forms/intake-workflow.service";

function makeWorkflow() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const forms = {
    submitPublicSession: async (...args: unknown[]) => {
      calls.push({ method: "submitPublicSession", args });
      return { id: "submission-1", status: "submitted" };
    },
    confirmUploadedDocument: async (...args: unknown[]) => {
      calls.push({ method: "confirmUploadedDocument", args });
      return { id: "document-1", status: "uploaded" };
    },
    createPublicSession: async (...args: unknown[]) => {
      calls.push({ method: "createPublicSession", args });
      return { token: "session-token" };
    },
  };

  return {
    workflow: new IntakeWorkflowService(forms as unknown as IntakeFormsService),
    calls,
  };
}

test("submit routes the public session payload through the intake workflow", async () => {
  const { workflow, calls } = makeWorkflow();
  const payload = { applicantEmail: "applicant@example.com", answersJson: { legalName: "Acme" } };

  const result = await workflow.submitPublicSession("session-token", payload as never);

  assert.deepEqual(result, { id: "submission-1", status: "submitted" });
  assert.deepEqual(calls, [{ method: "submitPublicSession", args: ["session-token", payload] }]);
});

test("upload confirmation routes the token and document payload unchanged", async () => {
  const { workflow, calls } = makeWorkflow();
  const payload = {
    documentType: "financials",
    originalFilename: "financials.pdf",
    storageKey: "uploads/session-token/financials.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
  };

  const result = await workflow.confirmUploadedDocument("session-token", payload);

  assert.deepEqual(result, { id: "document-1", status: "uploaded" });
  assert.deepEqual(calls, [{ method: "confirmUploadedDocument", args: ["session-token", payload] }]);
});

test("public session creation remains behind the same workflow boundary", async () => {
  const { workflow, calls } = makeWorkflow();

  const result = await workflow.createPublicSession({
    publicSlug: "supplier-intake",
    applicantEmail: "applicant@example.com",
  });

  assert.deepEqual(result, { token: "session-token" });
  assert.deepEqual(calls[0], {
    method: "createPublicSession",
    args: [{ publicSlug: "supplier-intake", applicantEmail: "applicant@example.com" }],
  });
});
