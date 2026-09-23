import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@aideal/db";
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { JobsPort } from "../jobs/jobs.port";
import { DealsService } from "../deals/deals.service";
import {
  MAX_SUBMISSION_BYTES,
  R2StorageService,
} from "../storage/r2-storage.service";
import { StoragePort } from "../storage/storage.port";
import { UsageService } from "../usage/usage.service";

type UploadedDraftDocument = {
  documentType: string;
  originalFilename: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
};

type DocumentRequirement = {
  key?: string;
  label?: string;
  required?: boolean;
};

type CompanyDraft = {
  legalName: string;
  jurisdiction: string | null;
  registrationNumber: string | null;
  website: string | null;
  address: string | null;
};

type ApplicantDraft = {
  name: string;
  email: string;
  roleTitle: string | null;
  phone: string | null;
  authorityConfirmed: boolean;
};

function isUniqueConstraintViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

@Injectable()
export class IntakeFormsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StoragePort,
    private readonly jobsService: JobsPort,
    private readonly dealsService: DealsService,
    @Optional() private readonly usage?: UsageService,
  ) {}

  listForms(organizationId: string) {
    return this.prisma.intakeForm.findMany({
      where: {
        organizationId,
      },
      orderBy: {
        updatedAt: "desc",
      },
      select: {
        id: true,
        name: true,
        publicSlug: true,
        status: true,
        sectionsJson: true,
        documentRequirementsJson: true,
        createdAt: true,
        updatedAt: true,
        sopTemplate: {
          select: {
            id: true,
            name: true,
            dealType: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });
  }

  async createForm(input: {
    organizationId: string;
    sopTemplateId: string;
    name: string;
    publicSlug?: string | null;
    status?: "draft" | "active" | "archived";
    sectionsJson?: Prisma.InputJsonValue;
    documentRequirementsJson?: Prisma.InputJsonValue;
  }) {
    const template = await this.prisma.sopTemplate.findFirst({
      where: {
        id: input.sopTemplateId,
        organizationId: input.organizationId,
      },
      select: {
        id: true,
      },
    });

    if (!template) {
      throw new NotFoundException("SOP template not found in active organization");
    }

    const publicSlug = await this.generateUniqueSlug(
      input.publicSlug || input.name,
    );

    return this.prisma.intakeForm.create({
      data: {
        organizationId: input.organizationId,
        sopTemplateId: input.sopTemplateId,
        name: input.name,
        publicSlug,
        status: input.status ?? "draft",
        sectionsJson: input.sectionsJson,
        documentRequirementsJson: input.documentRequirementsJson,
      },
      select: {
        id: true,
        name: true,
        publicSlug: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        sopTemplate: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  async getPublicForm(publicSlug: string) {
    const form = await this.prisma.intakeForm.findUnique({
      where: {
        publicSlug,
      },
      select: {
        id: true,
        name: true,
        publicSlug: true,
        status: true,
        sectionsJson: true,
        documentRequirementsJson: true,
        sopTemplate: {
          select: {
            id: true,
            name: true,
            dealType: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        organization: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!form) {
      throw new NotFoundException("Intake form not found");
    }

    if (form.status !== "active") {
      throw new NotFoundException("Intake form not found");
    }

    return form;
  }

  async createPublicSession(input: {
    publicSlug: string;
    applicantEmail: string;
  }) {
    const form = await this.prisma.intakeForm.findUnique({
      where: {
        publicSlug: input.publicSlug,
      },
      select: {
        id: true,
        organizationId: true,
        publicSlug: true,
        status: true,
      },
    });

    if (!form) {
      throw new NotFoundException("Intake form not found");
    }

    if (form.status !== "active") {
      throw new BadRequestException("Intake form is not accepting submissions");
    }

    const token = randomBytes(24).toString("hex");
    const resumeTokenHash = this.hashToken(token);
    const session = await this.prisma.intakeSession.create({
      data: {
        organizationId: form.organizationId,
        intakeFormId: form.id,
        applicantEmail: input.applicantEmail,
        resumeTokenHash,
        answersJson: {
          applicantEmail: input.applicantEmail,
        },
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      },
      select: {
        id: true,
        applicantEmail: true,
        status: true,
        expiresAt: true,
      },
    });

    return {
      ...session,
      publicSlug: form.publicSlug,
      token,
    };
  }

  async getPublicSession(token: string) {
    const session = await this.prisma.intakeSession.findFirst({
      where: {
        resumeTokenHash: this.hashToken(token),
      },
      select: {
        id: true,
        applicantEmail: true,
        answersJson: true,
        status: true,
        expiresAt: true,
        intakeForm: {
          select: {
            id: true,
            name: true,
            publicSlug: true,
            status: true,
            sectionsJson: true,
            documentRequirementsJson: true,
            sopTemplate: {
              select: {
                id: true,
                name: true,
                dealType: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
            organization: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException("Intake session not found");
    }

    if (session.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException("Intake session has expired");
    }

    return session;
  }

  async savePublicSession(
    token: string,
    input: {
      applicantEmail: string;
      answersJson: Prisma.InputJsonValue;
    },
  ) {
    const session = await this.requireActiveSession(token);

    if (session.status === "submitted") {
      throw new BadRequestException("Submitted sessions cannot be updated");
    }

    return this.prisma.intakeSession.update({
      where: {
        id: session.id,
      },
      data: {
        applicantEmail: input.applicantEmail,
        answersJson: input.answersJson,
      },
      select: {
        id: true,
        applicantEmail: true,
        status: true,
        updatedAt: true,
      },
    });
  }

  async submitPublicSession(
    token: string,
    input: {
      applicantEmail: string;
      answersJson: Prisma.InputJsonValue;
    },
  ) {
    const session = await this.requireActiveSession(token);

    if (session.status === "submitted") {
      const submission = await this.prisma.intakeSubmission.findUnique({
        where: { intakeSessionId: session.id },
        select: {
          id: true,
          status: true,
          submittedAt: true,
        },
      });

      if (!submission) {
        throw new NotFoundException("Finalized intake submission not found");
      }

      return { submission };
    }

    const form = await this.prisma.intakeForm.findUnique({
      where: {
        id: session.intakeFormId,
      },
      select: {
        id: true,
        organizationId: true,
        documentRequirementsJson: true,
        sopTemplate: {
          select: {
            dealTypeId: true,
          },
        },
      },
    });

    if (!form) {
      throw new NotFoundException("Intake form not found");
    }

    const answers = this.asAnswersRecord(input.answersJson);
    const uploadedDocuments = this.getUploadedDocuments(answers);
    this.assertSubmissionSizeWithinLimit(uploadedDocuments);
    this.assertRequiredDocumentsPresent(
      this.asDocumentRequirements(form.documentRequirementsJson),
      uploadedDocuments,
    );

    const submittedAt = new Date();

    let submission;
    try {
      submission = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.intakeSubmission.create({
          data: {
            organizationId: session.organizationId,
            intakeFormId: session.intakeFormId,
            intakeSessionId: session.id,
            rawAnswersJson: input.answersJson,
            status: "submitted",
            submittedAt,
          },
          select: { id: true, status: true, submittedAt: true },
        });

        await transaction.intakeSession.update({
          where: { id: session.id },
          data: {
            applicantEmail: input.applicantEmail,
            answersJson: input.answersJson,
            status: "submitted",
          },
        });

        await transaction.job.create({
          data: {
            organizationId: session.organizationId,
            type: "intake.finalize",
            intakeSubmissionId: created.id,
            payloadJson: { submissionId: created.id },
            maxAttempts: 10,
          },
          select: { id: true },
        });
        return created;
      });
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }

      const existingSubmission = await this.prisma.intakeSubmission.findUnique({
        where: { intakeSessionId: session.id },
        select: {
          id: true,
          status: true,
          submittedAt: true,
        },
      });

      if (!existingSubmission) {
        throw error;
      }

      return { submission: existingSubmission };
    }

    this.usage?.record({
      organizationId: session.organizationId,
      eventType: "submission.created",
      relatedEntityType: "IntakeSubmission",
      relatedEntityId: submission.id,
      metadata: { documentCount: uploadedDocuments.length },
    });

    return {
      submission,
    };
  }

  async createUploadIntent(
    token: string,
    input: {
      documentType: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
    },
  ) {
    const session = await this.requireActiveSession(token);

    if (session.status === "submitted") {
      throw new BadRequestException("Submitted sessions cannot accept uploads");
    }

    return this.storageService.createPresignedUpload({
      organizationId: session.organizationId,
      sessionId: session.id,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    });
  }

  async confirmUploadedDocument(
    token: string,
    input: {
      documentType: string;
      originalFilename: string;
      storageKey: string;
      mimeType: string;
      sizeBytes: number;
    },
  ) {
    const session = await this.requireActiveSession(token);

    if (session.status === "submitted") {
      throw new BadRequestException("Submitted sessions cannot accept uploads");
    }

    this.storageService.validateUpload({
      filename: input.originalFilename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    });

    const expectedStoragePrefix = `public-intake/${session.organizationId}/${session.id}/`;
    if (!input.storageKey.startsWith(expectedStoragePrefix) || input.storageKey.includes("..")) {
      throw new BadRequestException("Uploaded object does not belong to this intake session");
    }
    await this.storageService.verifyUploadedObject({
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    });

    const sessionRecord = await this.prisma.intakeSession.findUnique({
      where: {
        id: session.id,
      },
      select: {
        answersJson: true,
      },
    });

    const answers = this.asAnswersRecord(sessionRecord?.answersJson);
    const documents = this.getUploadedDocuments(answers).filter(
      (document) => document.storageKey !== input.storageKey,
    );

    const nextTotalBytes =
      documents.reduce((sum, document) => sum + document.sizeBytes, 0) +
      input.sizeBytes;

    if (nextTotalBytes > MAX_SUBMISSION_BYTES) {
      throw new BadRequestException(
        "Total uploaded files exceed maximum submission size of 500MB",
      );
    }

    documents.push({
      documentType: input.documentType,
      originalFilename: input.originalFilename,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      uploadedAt: new Date().toISOString(),
    });

    answers.__documents = documents as unknown as Prisma.InputJsonValue;

    await this.prisma.intakeSession.update({
      where: {
        id: session.id,
      },
      data: {
        answersJson: answers as Prisma.InputJsonValue,
      },
    });

    return {
      documents,
    };
  }

  private async requireActiveSession(token: string) {
    const session = await this.prisma.intakeSession.findFirst({
      where: {
        resumeTokenHash: this.hashToken(token),
      },
      select: {
        id: true,
        organizationId: true,
        intakeFormId: true,
        status: true,
        expiresAt: true,
      },
    });

    if (!session) {
      throw new NotFoundException("Intake session not found");
    }

    if (session.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException("Intake session has expired");
    }

    return session;
  }

  private asAnswersRecord(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? ({ ...(value as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  }

  private getUploadedDocuments(
    answers: Record<string, unknown>,
  ): UploadedDraftDocument[] {
    const rawDocuments = answers.__documents;

    if (!Array.isArray(rawDocuments)) {
      return [];
    }

    return rawDocuments.flatMap((document) => {
      if (!document || typeof document !== "object" || Array.isArray(document)) {
        return [];
      }

      const record = document as Record<string, unknown>;

      if (
        typeof record.documentType !== "string" ||
        typeof record.originalFilename !== "string" ||
        typeof record.storageKey !== "string" ||
        typeof record.mimeType !== "string" ||
        typeof record.sizeBytes !== "number" ||
        typeof record.uploadedAt !== "string"
      ) {
        return [];
      }

      return [
        {
          documentType: record.documentType,
          originalFilename: record.originalFilename,
          storageKey: record.storageKey,
          mimeType: record.mimeType,
          sizeBytes: record.sizeBytes,
          uploadedAt: record.uploadedAt,
        },
      ];
    });
  }

  private asDocumentRequirements(value: unknown): DocumentRequirement[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.map((requirement) =>
      requirement && typeof requirement === "object" && !Array.isArray(requirement)
        ? (requirement as DocumentRequirement)
        : {},
    );
  }

  private assertRequiredDocumentsPresent(
    requirements: DocumentRequirement[],
    uploadedDocuments: UploadedDraftDocument[],
  ) {
    const uploadedTypes = new Set(
      uploadedDocuments.map((document) => document.documentType),
    );

    const missing = requirements.filter(
      (requirement) =>
        requirement.required && requirement.key && !uploadedTypes.has(requirement.key),
    );

    if (missing.length > 0) {
      throw new BadRequestException(
        `Missing required documents: ${missing
          .map((requirement) => requirement.label || requirement.key)
          .join(", ")}`,
      );
    }
  }

  private assertSubmissionSizeWithinLimit(
    uploadedDocuments: UploadedDraftDocument[],
  ) {
    const totalSizeBytes = uploadedDocuments.reduce(
      (sum, document) => sum + document.sizeBytes,
      0,
    );

    if (totalSizeBytes > MAX_SUBMISSION_BYTES) {
      throw new BadRequestException(
        "Total uploaded files exceed maximum submission size of 500MB",
      );
    }
  }

  private deriveSubmissionTitle(
    answers: Record<string, unknown>,
    fallbackEmail: string,
  ) {
    const candidates = [
      answers.legalName,
      answers.companyName,
      answers.projectName,
      answers.requestTitle,
      answers.requestType,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }

    return fallbackEmail;
  }

  private extractCompanyDraft(
    answers: Record<string, unknown>,
  ): CompanyDraft | null {
    const legalName = this.firstNonEmptyString(
      answers.legalName,
      answers.companyName,
    );

    if (!legalName) {
      return null;
    }

    return {
      legalName,
      jurisdiction: this.firstNonEmptyString(answers.jurisdiction),
      registrationNumber: this.firstNonEmptyString(
        answers.registrationNumber,
        answers.companyRegistrationNumber,
      ),
      website: this.firstNonEmptyString(answers.website, answers.companyWebsite),
      address: this.firstNonEmptyString(
        answers.address,
        answers.companyAddress,
      ),
    };
  }

  private extractApplicantDraft(
    answers: Record<string, unknown>,
    fallbackEmail: string,
  ): ApplicantDraft | null {
    const email =
      this.firstNonEmptyString(
        answers.applicantEmail,
        answers.email,
        answers.contactEmail,
      ) ?? fallbackEmail.trim();

    if (!email) {
      return null;
    }

    const name =
      this.firstNonEmptyString(
        answers.applicantName,
        answers.contactName,
        answers.name,
      ) ?? email;

    return {
      name,
      email,
      roleTitle: this.firstNonEmptyString(
        answers.roleTitle,
        answers.contactRole,
        answers.applicantRole,
      ),
      phone: this.firstNonEmptyString(
        answers.phone,
        answers.contactPhone,
        answers.applicantPhone,
      ),
      authorityConfirmed:
        this.firstTruthyBoolean(
          answers.authorityConfirmed,
          answers.__declarationAccepted,
        ) ?? false,
    };
  }

  private async findOrCreateCompany(
    organizationId: string,
    input: CompanyDraft,
  ) {
    const existing = await this.prisma.company.findFirst({
      where: {
        organizationId,
        legalName: input.legalName,
        jurisdiction: input.jurisdiction,
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      return this.prisma.company.update({
        where: {
          id: existing.id,
        },
        data: {
          registrationNumber: input.registrationNumber,
          website: input.website,
          address: input.address,
        },
        select: {
          id: true,
        },
      });
    }

    return this.prisma.company.create({
      data: {
        organizationId,
        legalName: input.legalName,
        jurisdiction: input.jurisdiction,
        registrationNumber: input.registrationNumber,
        website: input.website,
        address: input.address,
      },
      select: {
        id: true,
      },
    });
  }

  private async findOrCreateApplicant(
    organizationId: string,
    input: ApplicantDraft,
    companyId: string | null,
  ) {
    const existing = await this.prisma.applicant.findFirst({
      where: {
        organizationId,
        email: input.email,
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      return this.prisma.applicant.update({
        where: {
          id: existing.id,
        },
        data: {
          name: input.name,
          roleTitle: input.roleTitle,
          phone: input.phone,
          authorityConfirmed: input.authorityConfirmed,
          companyId,
        },
        select: {
          id: true,
        },
      });
    }

    return this.prisma.applicant.create({
      data: {
        organizationId,
        companyId,
        name: input.name,
        roleTitle: input.roleTitle,
        email: input.email,
        phone: input.phone,
        authorityConfirmed: input.authorityConfirmed,
      },
      select: {
        id: true,
      },
    });
  }

  private firstNonEmptyString(...values: unknown[]) {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }

    return null;
  }

  private firstTruthyBoolean(...values: unknown[]) {
    for (const value of values) {
      if (typeof value === "boolean") {
        return value;
      }

      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true") {
          return true;
        }
        if (normalized === "false") {
          return false;
        }
      }
    }

    return null;
  }

  private async generateUniqueSlug(input: string) {
    const base = slugify(input) || "request-form";

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const existing = await this.prisma.intakeForm.findUnique({
        where: {
          publicSlug: candidate,
        },
        select: {
          id: true,
        },
      });

      if (!existing) {
        return candidate;
      }
    }

    return `${base}-${Date.now().toString(36)}`;
  }

  private hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }
}
