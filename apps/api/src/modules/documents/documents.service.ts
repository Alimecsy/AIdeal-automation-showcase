import { Injectable, NotFoundException } from "@nestjs/common";
import { JobsPort } from "../jobs/jobs.port";
import { PrismaService } from "../prisma.service";

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobsService: JobsPort,
  ) {}

  listDocuments(organizationId: string) {
    return this.prisma.document.findMany({
      where: {
        organizationId,
      },
      orderBy: {
        uploadedAt: "desc",
      },
      select: {
        id: true,
        documentType: true,
        originalFilename: true,
        mimeType: true,
        sizeBytes: true,
        status: true,
        uploadedAt: true,
        extractions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            extractionStatus: true,
            textStorageKey: true,
            errorMessage: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        deal: {
          select: {
            id: true,
            title: true,
            intakeSubmissionId: true,
          },
        },
      },
    });
  }

  async getDocument(organizationId: string, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        organizationId,
      },
      select: {
        id: true,
        documentType: true,
        originalFilename: true,
        storageKey: true,
        mimeType: true,
        sizeBytes: true,
        status: true,
        uploadedAt: true,
        deal: {
          select: {
            id: true,
            title: true,
          },
        },
        extractions: {
          select: {
            id: true,
            extractionStatus: true,
            confidence: true,
            errorMessage: true,
            createdAt: true,
          },
        },
      },
    });

    if (!document) {
      throw new NotFoundException("Document not found");
    }

    return document;
  }

  async queueExtraction(organizationId: string, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, organizationId },
      select: { id: true, status: true },
    });

    if (!document) {
      throw new NotFoundException("Document not found");
    }

    const extraction = await this.prisma.documentExtraction.create({
      data: {
        documentId: document.id,
        extractionStatus: "queued",
      },
      select: {
        id: true,
        documentId: true,
        extractionStatus: true,
        createdAt: true,
      },
    });

    try {
      const job = await this.jobsService.enqueue({
        organizationId,
        type: "document.extract",
        payload: {
          documentId: document.id,
          extractionId: extraction.id,
        },
      });

      return { extraction, job };
    } catch (error) {
      await this.prisma.documentExtraction.update({
        where: { id: extraction.id },
        data: {
          extractionStatus: "failed",
          errorMessage: error instanceof Error ? error.message : "Queue error",
        },
      });
      await this.prisma.document.update({
        where: { id: document.id },
        data: { status: "failed" },
      });
      throw error;
    }
  }
}
