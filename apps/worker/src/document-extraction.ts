import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import { createWorker } from "tesseract.js";
import * as XLSX from "xlsx";
import { env } from "@aideal/env";

export type ExtractedDocument = {
  text: string;
  pageSummaries: Array<{ page: number; characters: number }>;
  confidence: string;
};

function createStorageClient() {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET) {
    throw new Error("R2 storage is not configured for the worker");
  }

  return {
    bucket: env.R2_BUCKET,
    client: new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    }),
  };
}

export async function readDocument(storageKey: string) {
  const storage = createStorageClient();
  const response = await storage.client.send(
    new GetObjectCommand({ Bucket: storage.bucket, Key: storageKey }),
  );

  if (!response.Body) {
    throw new Error("Document object has no body");
  }

  return Buffer.from(await response.Body.transformToByteArray());
}

export async function writeExtractedText(storageKey: string, text: string) {
  const storage = createStorageClient();
  await storage.client.send(
    new PutObjectCommand({
      Bucket: storage.bucket,
      Key: storageKey,
      Body: text,
      ContentType: "text/plain; charset=utf-8",
    }),
  );
}

function pageSummaries(text: string, pageCount = 1) {
  const pages = text.split(/\f|\n\s*--- page \d+ ---\s*\n/i);
  return pages.map((page, index) => ({
    page: index + 1,
    characters: page.trim().length,
  })).slice(0, Math.max(pageCount, 1));
}

export async function extractDocument(input: {
  buffer: Buffer;
  mimeType: string;
}) : Promise<ExtractedDocument> {
  if (input.mimeType === "application/pdf") {
    const parsed = await pdfParse(input.buffer);
    const text = parsed.text.trim();
    if (!text) {
      throw new Error("PDF contains no text layer; scanned PDF OCR requires rasterization support");
    }
    return {
      text,
      pageSummaries: pageSummaries(text, parsed.numpages),
      confidence: "high",
    };
  }

  if (input.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const parsed = await mammoth.extractRawText({ buffer: input.buffer });
    const text = parsed.value.trim();
    if (!text) {
      throw new Error("DOCX contains no extractable text");
    }
    return { text, pageSummaries: pageSummaries(text), confidence: "high" };
  }

  if (input.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    const workbook = XLSX.read(input.buffer, { type: "buffer" });
    const sections = workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name];
      return `--- ${name} ---\n${sheet ? XLSX.utils.sheet_to_csv(sheet) : ""}`;
    });
    const text = sections.join("\n\n").trim();
    if (!text) {
      throw new Error("XLSX contains no extractable cells");
    }
    return { text, pageSummaries: pageSummaries(text), confidence: "high" };
  }

  if (input.mimeType === "image/jpeg" || input.mimeType === "image/png") {
    const worker = await createWorker("eng");
    try {
      const result = await worker.recognize(input.buffer);
      const text = result.data.text.trim();
      if (!text) {
        throw new Error("OCR produced no text");
      }
      return { text, pageSummaries: pageSummaries(text), confidence: "medium" };
    } finally {
      await worker.terminate();
    }
  }

  throw new Error(`Unsupported extraction MIME type: ${input.mimeType}`);
}
