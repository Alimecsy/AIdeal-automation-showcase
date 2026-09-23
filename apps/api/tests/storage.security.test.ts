import assert from "node:assert/strict";
import { test } from "node:test";
import { S3Client } from "@aws-sdk/client-s3";
import { BadRequestException } from "@nestjs/common";
import { InMemoryStorageAdapter } from "../src/modules/storage/in-memory-storage.adapter";
import { R2StorageService } from "../src/modules/storage/r2-storage.service";

function zipCentralDirectory(entryNames: string[]) {
  const entries = entryNames.map((entryName) => {
    const filename = Buffer.from(entryName, "utf8");
    const entry = Buffer.alloc(46 + filename.length);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(filename.length, 28);
    filename.copy(entry, 46);
    return entry;
  });
  const directory = Buffer.concat(entries);
  const endOfDirectory = Buffer.alloc(22);
  endOfDirectory.writeUInt32LE(0x06054b50, 0);
  endOfDirectory.writeUInt16LE(entryNames.length, 8);
  endOfDirectory.writeUInt16LE(entryNames.length, 10);
  endOfDirectory.writeUInt32LE(directory.length, 12);
  endOfDirectory.writeUInt32LE(0, 16);
  return Buffer.concat([directory, endOfDirectory]);
}

function zipWithLocalEntries(entries: Array<{ name: string; data: string }>) {
  const localEntries: Buffer[] = [];
  const centralEntries: Buffer[] = [];
  let localOffset = 0;

  for (const { name, data } of entries) {
    const filename = Buffer.from(name, "utf8");
    const contents = Buffer.from(data, "utf8");
    const localEntry = Buffer.alloc(30 + filename.length + contents.length);
    localEntry.writeUInt32LE(0x04034b50, 0);
    localEntry.writeUInt16LE(20, 4);
    localEntry.writeUInt16LE(0, 6);
    localEntry.writeUInt16LE(0, 8);
    localEntry.writeUInt32LE(contents.length, 18);
    localEntry.writeUInt32LE(contents.length, 22);
    localEntry.writeUInt16LE(filename.length, 26);
    filename.copy(localEntry, 30);
    contents.copy(localEntry, 30 + filename.length);
    localEntries.push(localEntry);

    const centralEntry = Buffer.alloc(46 + filename.length);
    centralEntry.writeUInt32LE(0x02014b50, 0);
    centralEntry.writeUInt16LE(20, 4);
    centralEntry.writeUInt16LE(20, 6);
    centralEntry.writeUInt16LE(0, 8);
    centralEntry.writeUInt16LE(0, 10);
    centralEntry.writeUInt32LE(contents.length, 20);
    centralEntry.writeUInt32LE(contents.length, 24);
    centralEntry.writeUInt16LE(filename.length, 28);
    centralEntry.writeUInt32LE(localOffset, 42);
    filename.copy(centralEntry, 46);
    centralEntries.push(centralEntry);
    localOffset += localEntry.length;
  }

  const directory = Buffer.concat(centralEntries);
  const endOfDirectory = Buffer.alloc(22);
  endOfDirectory.writeUInt32LE(0x06054b50, 0);
  endOfDirectory.writeUInt16LE(entries.length, 8);
  endOfDirectory.writeUInt16LE(entries.length, 10);
  endOfDirectory.writeUInt32LE(directory.length, 12);
  endOfDirectory.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localEntries, directory, endOfDirectory]);
}

function mockR2Client(archive: Buffer, mimeType: string) {
  return {
    send: async (command: { input?: { Range?: string } }) => {
      const range = command.input?.Range;
      if (!range) {
        return { ContentLength: archive.length, ContentType: mimeType };
      }

      const suffix = /^bytes=-(\d+)$/.exec(range);
      if (suffix) {
        return { Body: archive.subarray(-Number(suffix[1])) };
      }

      const bounded = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (!bounded) {
        throw new Error(`Unexpected range ${range}`);
      }
      return { Body: archive.subarray(Number(bounded[1]), Number(bounded[2]) + 1) };
    },
  };
}

test("upload validation rejects non-integer and oversized metadata", () => {
  const service = new R2StorageService();
  assert.throws(
    () => service.validateUpload({ mimeType: "application/pdf", sizeBytes: 1.5, filename: "brief.pdf" }),
    BadRequestException,
  );
  assert.throws(
    () => service.validateUpload({ mimeType: "application/pdf", sizeBytes: 1, filename: "a".repeat(256) }),
    BadRequestException,
  );
});

test("upload validation accepts the supported MIME type case-insensitively", () => {
  const service = new R2StorageService();
  assert.doesNotThrow(() => service.validateUpload({
    mimeType: "APPLICATION/PDF",
    sizeBytes: 1,
    filename: "brief.pdf",
  }));
});

test("storage refuses legacy DOC before creating an upload intent", async () => {
  const r2 = new R2StorageService();
  Object.defineProperties(r2, {
    bucket: { value: "test-bucket" },
    client: { value: {} },
  });

  await assert.rejects(
    r2.createPresignedUpload({
      organizationId: "org-1",
      sessionId: "session-1",
      filename: "legacy.doc",
      mimeType: "application/msword",
      sizeBytes: 1,
    }),
    /Unsupported file type/,
  );

  const memory = new InMemoryStorageAdapter();
  assert.throws(
    () => memory.createPresignedUpload({
      organizationId: "org-1",
      sessionId: "session-1",
      filename: "legacy.doc",
      mimeType: "application/msword",
      sizeBytes: 1,
    }),
    /Unsupported file type/,
  );
});

test("upload validation rejects spreadsheet uploads with a safe containment error", () => {
  const service = new R2StorageService();

  for (const [mimeType, filename] of [
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "financials.xlsx"],
    ["application/vnd.ms-excel", "financials.xls"],
  ]) {
    assert.throws(
      () => service.validateUpload({ mimeType, sizeBytes: 1, filename }),
      /Spreadsheet uploads are temporarily unavailable/,
    );
  }
});

test("in-memory storage rejects spreadsheet uploads before accepting a test upload", () => {
  const storage = new InMemoryStorageAdapter();

  assert.throws(
    () => storage.validateUpload({
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 1,
      filename: "financials.xlsx",
    }),
    /Spreadsheet uploads are temporarily unavailable/,
  );
});

test("upload validation continues to accept PDF and DOCX uploads", () => {
  const service = new R2StorageService();

  assert.doesNotThrow(() => service.validateUpload({
    mimeType: "application/pdf",
    sizeBytes: 1,
    filename: "brief.pdf",
  }));
  assert.doesNotThrow(() => service.validateUpload({
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 1,
    filename: "brief.docx",
  }));
});

test("R2 verification rejects missing objects and metadata mismatches", async () => {
  const service = new R2StorageService();
  Object.defineProperties(service, {
    bucket: { value: "test-bucket" },
    client: {
      value: {
        send: async () => ({ ContentLength: 12, ContentType: "application/pdf" }),
      },
    },
  });

  await assert.rejects(
    service.verifyUploadedObject({
      storageKey: "public-intake/org/session/file.pdf",
      mimeType: "application/pdf",
      sizeBytes: 11,
    }),
    /metadata does not match/,
  );

  Object.defineProperty(service, "client", {
    value: { send: async () => { throw new Error("not found"); } },
  });
  await assert.rejects(
    service.verifyUploadedObject({
      storageKey: "public-intake/org/session/file.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12,
    }),
    /could not be verified/,
  );
});

test("R2 verification rejects content whose magic bytes do not match its declared MIME type", async () => {
  const service = new R2StorageService();
  Object.defineProperties(service, {
    bucket: { value: "test-bucket" },
    client: {
      value: {
        send: async (command: { input?: { Range?: string } }) =>
          command.input?.Range
            ? { Body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }
            : { ContentLength: 8, ContentType: "application/pdf" },
      },
    },
  });

  await assert.rejects(
    service.verifyUploadedObject({
      storageKey: "public-intake/org/session/file.pdf",
      mimeType: "application/pdf",
      sizeBytes: 8,
    }),
    /content does not match/,
  );
});

test("R2 verification rejects a generic ZIP declared as DOCX without OOXML entries", async () => {
  const archive = zipCentralDirectory(["unrelated.txt"]);
  const service = new R2StorageService();
  Object.defineProperties(service, {
    bucket: { value: "test-bucket" },
    client: {
      value: mockR2Client(archive, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    },
  });

  await assert.rejects(
    service.verifyUploadedObject({
      storageKey: "public-intake/org/session/file.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: archive.length,
    }),
    /content does not match/,
  );
});

test("R2 verification rejects central-directory-only OOXML entries without local file headers", async () => {
  const archive = zipCentralDirectory(["[Content_Types].xml", "word/document.xml"]);
  const service = new R2StorageService();
  Object.defineProperties(service, {
    bucket: { value: "test-bucket" },
    client: {
      value: mockR2Client(archive, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    },
  });

  await assert.rejects(
    service.verifyUploadedObject({
      storageKey: "public-intake/org/session/file.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: archive.length,
    }),
    /content does not match/,
  );
});

test("R2 verification accepts a DOCX with genuine local OOXML entries and file data", async () => {
  const archive = zipWithLocalEntries([
    { name: "[Content_Types].xml", data: "<Types/>" },
    { name: "word/document.xml", data: "<w:document/>" },
  ]);
  const service = new R2StorageService();
  Object.defineProperties(service, {
    bucket: { value: "test-bucket" },
    client: {
      value: mockR2Client(archive, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    },
  });

  await assert.doesNotReject(
    service.verifyUploadedObject({
      storageKey: "public-intake/org/session/file.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: archive.length,
    }),
  );
});

test("R2 verification accepts a PDF whose leading bytes match its declared MIME type", async () => {
  const service = new R2StorageService();
  Object.defineProperties(service, {
    bucket: { value: "test-bucket" },
    client: {
      value: {
        send: async (command: { input?: { Range?: string } }) =>
          command.input?.Range
            ? { Body: new TextEncoder().encode("%PDF-1.7") }
            : { ContentLength: 8, ContentType: "application/pdf" },
      },
    },
  });

  await assert.doesNotReject(
    service.verifyUploadedObject({
      storageKey: "public-intake/org/session/file.pdf",
      mimeType: "application/pdf",
      sizeBytes: 8,
    }),
  );
});

test("R2 presigned upload contract expires in ten minutes", async () => {
  const service = new R2StorageService();
  Object.defineProperties(service, {
    bucket: { value: "test-bucket" },
    client: {
      value: new S3Client({
        region: "auto",
        endpoint: "https://example.r2.cloudflarestorage.com",
        credentials: { accessKeyId: "test-access", secretAccessKey: "test-secret" },
      }),
    },
  });

  const result = await service.createPresignedUpload({
    organizationId: "org-1",
    sessionId: "session-1",
    filename: "financials.pdf",
    mimeType: "application/pdf",
    sizeBytes: 12,
  }) as { uploadUrl: string; expiresInSeconds: number };

  assert.equal(result.expiresInSeconds, 600);
  assert.match(result.uploadUrl, /X-Amz-Expires=600/);
});
