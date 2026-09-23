import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { env } from "@aideal/env";
import { StoragePort } from "./storage.port";

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_SUBMISSION_BYTES = 500 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
]);

const DISABLED_SPREADSHEET_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

const MAGIC_BYTES = {
  pdf: Buffer.from("%PDF-"),
  jpeg: Buffer.from([0xff, 0xd8, 0xff]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  zip: Buffer.from([0x50, 0x4b]),
  ole: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
} as const;

function startsWithBytes(value: Uint8Array, prefix: Uint8Array) {
  return prefix.every((byte, index) => value[index] === byte);
}

function matchesMagicBytes(mimeType: string, bytes: Uint8Array) {
  switch (mimeType.trim().toLowerCase()) {
    case "application/pdf":
      return startsWithBytes(bytes, MAGIC_BYTES.pdf);
    case "image/jpeg":
      return startsWithBytes(bytes, MAGIC_BYTES.jpeg);
    case "image/png":
      return startsWithBytes(bytes, MAGIC_BYTES.png);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return startsWithBytes(bytes, MAGIC_BYTES.zip);
    case "application/msword":
    case "application/vnd.ms-excel":
      return startsWithBytes(bytes, MAGIC_BYTES.ole);
    default:
      return false;
  }
}

type ZipEntry = {
  filename: string;
  flags: number;
  compressionMethod: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

function findRequiredDocxEntries(bytes: Uint8Array, contentLength: number): ZipEntry[] | null {
  const archive = Buffer.from(bytes);
  const endOfDirectorySignature = 0x06054b50;
  const centralDirectorySignature = 0x02014b50;
  const minimumEndOfDirectoryLength = 22;
  const endSearchStart = Math.max(0, archive.length - 65_557);
  let endOfDirectoryOffset = -1;

  for (let offset = archive.length - minimumEndOfDirectoryLength; offset >= endSearchStart; offset -= 1) {
    if (archive.readUInt32LE(offset) === endOfDirectorySignature) {
      endOfDirectoryOffset = offset;
      break;
    }
  }

  if (endOfDirectoryOffset === -1) {
    return null;
  }

  const diskNumber = archive.readUInt16LE(endOfDirectoryOffset + 4);
  const centralDirectoryDisk = archive.readUInt16LE(endOfDirectoryOffset + 6);
  const entryCount = archive.readUInt16LE(endOfDirectoryOffset + 10);
  const centralDirectorySize = archive.readUInt32LE(endOfDirectoryOffset + 12);
  const centralDirectoryOffset = archive.readUInt32LE(endOfDirectoryOffset + 16);
  const tailStart = contentLength - archive.length;
  const directoryStart = centralDirectoryOffset - tailStart;
  const directoryEnd = directoryStart + centralDirectorySize;

  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    directoryStart < 0 ||
    directoryEnd > endOfDirectoryOffset
  ) {
    return null;
  }

  const requiredEntryNames = new Set(["[Content_Types].xml", "word/document.xml"]);
  const requiredEntries = new Map<string, ZipEntry>();
  let cursor = directoryStart;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > directoryEnd || archive.readUInt32LE(cursor) !== centralDirectorySignature) {
      return null;
    }

    const filenameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const filenameStart = cursor + 46;
    const entryEnd = filenameStart + filenameLength + extraLength + commentLength;
    if (entryEnd > directoryEnd) {
      return null;
    }

    const filename = archive.toString("utf8", filenameStart, filenameStart + filenameLength);
    const localHeaderOffset = archive.readUInt32LE(cursor + 42);
    if (requiredEntryNames.has(filename)) {
      if (requiredEntries.has(filename) || localHeaderOffset >= contentLength) {
        return null;
      }

      requiredEntries.set(filename, {
        filename,
        flags: archive.readUInt16LE(cursor + 8),
        compressionMethod: archive.readUInt16LE(cursor + 10),
        crc32: archive.readUInt32LE(cursor + 16),
        compressedSize: archive.readUInt32LE(cursor + 20),
        uncompressedSize: archive.readUInt32LE(cursor + 24),
        localHeaderOffset,
      });
    }
    cursor = entryEnd;
  }

  if (cursor !== directoryEnd || requiredEntries.size !== requiredEntryNames.size) {
    return null;
  }

  return [...requiredEntries.values()];
}

function localHeaderDataOffset(bytes: Uint8Array, entry: ZipEntry, contentLength: number): number | null {
  const localFileHeaderSignature = 0x04034b50;
  const localHeaderLength = 30;
  const archive = Buffer.from(bytes);
  const filenameLength = Buffer.byteLength(entry.filename, "utf8");
  const hasDataDescriptor = (entry.flags & 0x0008) !== 0;

  if (
    entry.compressedSize === 0 ||
    entry.uncompressedSize === 0 ||
    archive.length < localHeaderLength + filenameLength ||
    archive.readUInt32LE(0) !== localFileHeaderSignature ||
    archive.readUInt16LE(6) !== entry.flags ||
    archive.readUInt16LE(8) !== entry.compressionMethod ||
    archive.readUInt16LE(26) !== filenameLength ||
    archive.toString("utf8", localHeaderLength, localHeaderLength + filenameLength) !== entry.filename
  ) {
    return null;
  }

  const dataOffset = entry.localHeaderOffset + localHeaderLength + filenameLength + archive.readUInt16LE(28);
  if (dataOffset >= contentLength || dataOffset + entry.compressedSize > contentLength) {
    return null;
  }

  if (!hasDataDescriptor && (
    archive.readUInt32LE(14) !== entry.crc32 ||
    archive.readUInt32LE(18) !== entry.compressedSize ||
    archive.readUInt32LE(22) !== entry.uncompressedSize
  )) {
    return null;
  }

  return dataOffset;
}

async function readObjectPrefix(body: unknown) {
  if (body instanceof Uint8Array) {
    return body;
  }

  if (
    body &&
    typeof body === "object" &&
    "transformToByteArray" in body &&
    typeof body.transformToByteArray === "function"
  ) {
    return new Uint8Array(await body.transformToByteArray());
  }

  return null;
}

function sanitizeFilename(filename: string) {
  const parsed = path.parse(filename);
  const safeName = parsed.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const extension = parsed.ext.toLowerCase().replace(/[^.a-z0-9]/g, "");

  return `${safeName || "document"}${extension}`;
}

@Injectable()
export class R2StorageService extends StoragePort {
  private readonly bucket = env.R2_BUCKET;
  private readonly client =
    env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY
      ? new S3Client({
          region: "auto",
          endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
          credentials: {
            accessKeyId: env.R2_ACCESS_KEY_ID,
            secretAccessKey: env.R2_SECRET_ACCESS_KEY,
          },
        })
      : null;

  ensureConfigured() {
    if (!this.client || !this.bucket) {
      throw new ServiceUnavailableException(
        "Object storage is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET.",
      );
    }
  }

  validateUpload(input: {
    mimeType: string;
    sizeBytes: number;
    filename: string;
  }) {
    const mimeType = input.mimeType.trim().toLowerCase();
    if (DISABLED_SPREADSHEET_MIME_TYPES.has(mimeType)) {
      throw new BadRequestException("Spreadsheet uploads are temporarily unavailable");
    }

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new BadRequestException("Unsupported file type");
    }

    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > MAX_FILE_BYTES) {
      throw new BadRequestException("File exceeds maximum size of 100MB");
    }

    if (!input.filename.trim() || input.filename.length > 255) {
      throw new BadRequestException("Original filename is required");
    }
  }

  async createPresignedUpload(input: {
    organizationId: string;
    sessionId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }) {
    this.ensureConfigured();
    this.validateUpload(input);

    const storageKey = `public-intake/${input.organizationId}/${input.sessionId}/${randomUUID()}-${sanitizeFilename(input.filename)}`;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      ContentType: input.mimeType,
    });

    return {
      uploadUrl: await getSignedUrl(this.client!, command, {
        expiresIn: 60 * 10,
      }),
      storageKey,
      expiresInSeconds: 60 * 10,
      maxFileBytes: MAX_FILE_BYTES,
    };
  }

  async verifyUploadedObject(input: {
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
  }) {
    this.ensureConfigured();
    let head;
    try {
      head = await this.client!.send(new HeadObjectCommand({ Bucket: this.bucket, Key: input.storageKey }));
    } catch {
      throw new BadRequestException("Uploaded object could not be verified");
    }

    if (head.ContentLength !== input.sizeBytes || head.ContentType?.toLowerCase() !== input.mimeType.trim().toLowerCase()) {
      throw new BadRequestException("Uploaded object metadata does not match the declared file");
    }

    let content: Uint8Array | null;
    try {
      const object = await this.client!.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: input.storageKey,
          Range:
            input.mimeType.trim().toLowerCase() ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              ? "bytes=-65557"
              : "bytes=0-7",
        }),
      );
      content = await readObjectPrefix(object.Body);
    } catch {
      throw new BadRequestException("Uploaded object could not be verified");
    }

    const isDocx =
      input.mimeType.trim().toLowerCase() ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    let contentMatches = content && matchesMagicBytes(input.mimeType, content);
    if (isDocx) {
      const entries = content && findRequiredDocxEntries(content, head.ContentLength);
      contentMatches = Boolean(entries);

      for (const entry of entries ?? []) {
        const filenameLength = Buffer.byteLength(entry.filename, "utf8");
        const rangeEnd = entry.localHeaderOffset + 30 + filenameLength - 1;
        let localHeader: Uint8Array | null;
        try {
          const object = await this.client!.send(
            new GetObjectCommand({
              Bucket: this.bucket,
              Key: input.storageKey,
              Range: `bytes=${entry.localHeaderOffset}-${rangeEnd}`,
            }),
          );
          localHeader = await readObjectPrefix(object.Body);
        } catch {
          contentMatches = false;
          break;
        }

        const dataOffset = localHeader && localHeaderDataOffset(localHeader, entry, head.ContentLength);
        if (dataOffset === null) {
          contentMatches = false;
          break;
        }

        try {
          const object = await this.client!.send(
            new GetObjectCommand({
              Bucket: this.bucket,
              Key: input.storageKey,
              Range: `bytes=${dataOffset}-${dataOffset}`,
            }),
          );
          if (!(await readObjectPrefix(object.Body))?.length) {
            contentMatches = false;
            break;
          }
        } catch {
          contentMatches = false;
          break;
        }
      }
    }
    if (!contentMatches) {
      throw new BadRequestException("Uploaded object content does not match the declared file type");
    }
  }
}
