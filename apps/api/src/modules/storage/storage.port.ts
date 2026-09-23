export abstract class StoragePort {
  abstract ensureConfigured(): void;
  abstract validateUpload(input: {
    mimeType: string;
    sizeBytes: number;
    filename: string;
  }): void;
  abstract createPresignedUpload(input: {
    organizationId: string;
    sessionId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<unknown>;
  abstract verifyUploadedObject(input: {
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<void>;
}
