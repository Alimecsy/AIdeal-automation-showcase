import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { Prisma } from "@aideal/db";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import type { CurrentWorkspace } from "../auth/auth.types";
import { CurrentWorkspaceContext } from "../auth/current-workspace.decorator";
import { WorkspaceGuard } from "../auth/workspace.guard";
import { IntakeWorkflowService } from "./intake-workflow.service";
import { PublicRateLimitService } from "./public-rate-limit.service";

type PublicRequest = { ip?: string };

type CreateIntakeFormBody = {
  sopTemplateId: string;
  name: string;
  publicSlug?: string | null;
  status?: "draft" | "active" | "archived";
  sectionsJson?: unknown;
  documentRequirementsJson?: unknown;
};

type CreatePublicSessionBody = {
  applicantEmail: string;
};

type SavePublicSessionBody = {
  applicantEmail: string;
  answersJson: unknown;
};

type PresignUploadBody = {
  documentType: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

type ConfirmUploadBody = {
  documentType: string;
  originalFilename: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
};

@UseGuards(ClerkAuthGuard, WorkspaceGuard)
@Controller("intake-forms")
export class IntakeFormsController {
  constructor(private readonly intakeWorkflow: IntakeWorkflowService) {}

  @Get()
  listForms(@CurrentWorkspaceContext() workspace: CurrentWorkspace) {
    return this.intakeWorkflow.listForms(workspace.organization.id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles("owner_admin")
  createForm(
    @CurrentWorkspaceContext() workspace: CurrentWorkspace,
    @Body() body: CreateIntakeFormBody,
  ) {
    return this.intakeWorkflow.createForm({
      organizationId: workspace.organization.id,
      sopTemplateId: body.sopTemplateId,
      name: body.name,
      publicSlug: body.publicSlug,
      status: body.status,
      sectionsJson: body.sectionsJson as Prisma.InputJsonValue | undefined,
      documentRequirementsJson:
        body.documentRequirementsJson as Prisma.InputJsonValue | undefined,
    });
  }
}

@Controller("public/intake-forms")
export class PublicIntakeFormsController {
  constructor(
    private readonly intakeWorkflow: IntakeWorkflowService,
    private readonly rateLimit: PublicRateLimitService,
  ) {}

  @Get(":slug")
  async getPublicForm(@Param("slug") slug: string, @Req() request: PublicRequest) {
    await this.rateLimit.assertAllowed("public-form", `${request.ip ?? "unknown"}:${slug}`, 120, 60);
    return this.intakeWorkflow.getPublicForm(slug);
  }

  @Post(":slug/sessions")
  async createPublicSession(
    @Param("slug") slug: string,
    @Body() body: CreatePublicSessionBody,
    @Req() request: PublicRequest,
  ) {
    await this.rateLimit.assertAllowed("create-session", `${request.ip ?? "unknown"}:${slug}`, 10, 60);
    return this.intakeWorkflow.createPublicSession({
      publicSlug: slug,
      applicantEmail: body.applicantEmail,
    });
  }
}

@Controller("public/intake-sessions")
export class PublicIntakeSessionsController {
  constructor(
    private readonly intakeWorkflow: IntakeWorkflowService,
    private readonly rateLimit: PublicRateLimitService,
  ) {}

  private throttle(token: string, request: PublicRequest) {
    return this.rateLimit.assertAllowed("session", `${request.ip ?? "unknown"}:${token}`, 120, 60);
  }

  @Get(":token")
  async getSession(@Param("token") token: string, @Req() request: PublicRequest) {
    await this.throttle(token, request);
    return this.intakeWorkflow.getPublicSession(token);
  }

  @Patch(":token")
  async saveSession(
    @Param("token") token: string,
    @Body() body: SavePublicSessionBody,
    @Req() request: PublicRequest,
  ) {
    await this.throttle(token, request);
    return this.intakeWorkflow.savePublicSession(token, {
      applicantEmail: body.applicantEmail,
      answersJson: body.answersJson as Prisma.InputJsonValue,
    });
  }

  @Post(":token/submit")
  async submitSession(
    @Param("token") token: string,
    @Body() body: SavePublicSessionBody,
    @Req() request: PublicRequest,
  ) {
    await this.throttle(token, request);
    return this.intakeWorkflow.submitPublicSession(token, {
      applicantEmail: body.applicantEmail,
      answersJson: body.answersJson as Prisma.InputJsonValue,
    });
  }

  @Post(":token/uploads/presign")
  async presignUpload(
    @Param("token") token: string,
    @Body() body: PresignUploadBody,
    @Req() request: PublicRequest,
  ) {
    await this.throttle(token, request);
    return this.intakeWorkflow.createUploadIntent(token, body);
  }

  @Post(":token/uploads/confirm")
  async confirmUpload(
    @Param("token") token: string,
    @Body() body: ConfirmUploadBody,
    @Req() request: PublicRequest,
  ) {
    await this.throttle(token, request);
    return this.intakeWorkflow.confirmUploadedDocument(token, body);
  }
}
