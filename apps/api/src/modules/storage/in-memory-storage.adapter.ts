import { StoragePort } from "./storage.port";

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
]);

export class InMemoryStorageAdapter extends StoragePort {
  readonly uploads = new Map<string, Buffer>();

  ensureConfigured() {}

  validateUpload(input: { mimeType: string; sizeBytes: number; filename: string }) {
    const mimeType = input.mimeType.trim().toLowerCase();
    if (
      mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mimeType === "application/vnd.ms-excel"
    ) {
      throw new Error("Spreadsheet uploads are temporarily unavailable");
    }

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new Error("Unsupported file type");
    }

    if (!input.filename || input.sizeBytes <= 0) {
      throw new Error("Invalid upload");
    }
  }

  createPresignedUpload(input: { organizationId: string; sessionId: string; filename: string; mimeType: string; sizeBytes: number }) {
    this.validateUpload(input);
    const storageKey = `public-intake/${input.organizationId}/${input.sessionId}/${input.filename}`;
    return Promise.resolve({ uploadUrl: `memory://${storageKey}`, storageKey, expiresInSeconds: 600 });
  }

  verifyUploadedObject() {
    return Promise.resolve();
  }
}
