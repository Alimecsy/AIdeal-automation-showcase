import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { CurrentWorkspace } from "../auth/auth.types";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { CurrentWorkspaceContext } from "../auth/current-workspace.decorator";
import { WorkspaceGuard } from "../auth/workspace.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { IntakeSubmissionsService } from "./intake-submissions.service";

@UseGuards(ClerkAuthGuard, WorkspaceGuard)
@Controller("intake-submissions")
export class IntakeSubmissionsController {
  constructor(
    private readonly intakeSubmissionsService: IntakeSubmissionsService,
  ) {}

  @Get()
  listSubmissions(
    @CurrentWorkspaceContext() workspace: CurrentWorkspace,
    @Query("status") status?: string,
    @Query("q") query?: string,
    @Query("rating") rating?: string,
    @Query("confidence") confidence?: string,
    @Query("researchFollowUp") researchFollowUp?: string,
    @Query("missingDocuments") missingDocuments?: string,
    @Query("olderThanDays") olderThanDays?: string,
    @Query("sort") sort?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return this.intakeSubmissionsService.listSubmissions(
      workspace.organization.id,
      {
        status,
        query,
        rating,
        confidence,
        researchFollowUp,
        missingDocuments,
        olderThanDays,
        sort,
        page,
        pageSize,
      },
    );
  }

  @Get(":submissionId")
  getSubmission(
    @CurrentWorkspaceContext() workspace: CurrentWorkspace,
    @Param("submissionId") submissionId: string,
  ) {
    return this.intakeSubmissionsService.getSubmission(
      workspace.organization.id,
      submissionId,
    );
  }

  @Patch(":submissionId/review")
  @UseGuards(RolesGuard)
  @Roles("owner_admin", "reviewer", "approver")
  reviewDeal(
    @CurrentWorkspaceContext() workspace: CurrentWorkspace,
    @Param("submissionId") submissionId: string,
    @Body() body: { action?: string; note?: string },
  ) {
    return this.intakeSubmissionsService.reviewDeal(
      workspace.organization.id,
      workspace.user.id,
      submissionId,
      body,
    );
  }

  @Patch(":submissionId/research-review")
  @UseGuards(RolesGuard)
  @Roles("owner_admin", "reviewer", "approver")
  reviewResearchEvidence(
    @CurrentWorkspaceContext() workspace: CurrentWorkspace,
    @Param("submissionId") submissionId: string,
    @Body() body: { reportId?: string; sourceId?: string; decision?: string; note?: string },
  ) {
    return this.intakeSubmissionsService.reviewResearchEvidence(
      workspace.organization.id,
      workspace.user.id,
      submissionId,
      body,
    );
  }

  @Post(":submissionId/research-rerun")
  @UseGuards(RolesGuard)
  @Roles("owner_admin", "reviewer", "approver")
  rerunResearch(
    @CurrentWorkspaceContext() workspace: CurrentWorkspace,
    @Param("submissionId") submissionId: string,
  ) {
    return this.intakeSubmissionsService.rerunResearch(
      workspace.organization.id,
      workspace.user.id,
      submissionId,
    );
  }
}
