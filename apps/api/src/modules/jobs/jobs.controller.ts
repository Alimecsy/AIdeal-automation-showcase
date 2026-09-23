import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import type { CurrentWorkspace } from "../auth/auth.types";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { CurrentWorkspaceContext } from "../auth/current-workspace.decorator";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { WorkspaceGuard } from "../auth/workspace.guard";
import { JobsService } from "./jobs.service";

@UseGuards(ClerkAuthGuard, WorkspaceGuard)
@Controller("jobs")
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get()
  list(@CurrentWorkspaceContext() workspace: CurrentWorkspace) {
    return this.jobsService.list(workspace.organization.id);
  }

  @Post("test")
  @UseGuards(RolesGuard)
  @Roles("owner_admin")
  enqueueTest(
    @CurrentWorkspaceContext() workspace: CurrentWorkspace,
    @Body() body: { shouldFail?: boolean },
  ) {
    return this.jobsService.enqueue({
      organizationId: workspace.organization.id,
      type: body.shouldFail ? "test.failure" : "test.success",
      payload: { requestedBy: workspace.user.id },
    });
  }

  @Post("ai-test")
  @UseGuards(RolesGuard)
  @Roles("owner_admin")
  enqueueAiTest(
    @CurrentWorkspaceContext() workspace: CurrentWorkspace,
    @Body() body: { prompt?: string; provider?: string; model?: string },
  ) {
    if (!body.prompt?.trim()) {
      throw new BadRequestException("Prompt is required");
    }
    return this.jobsService.enqueueAi({
      organizationId: workspace.organization.id,
      prompt: body.prompt,
      provider: body.provider,
      model: body.model,
    });
  }

  @Post(":jobId/retry")
  @UseGuards(RolesGuard)
  @Roles("owner_admin")
  retry(
    @CurrentWorkspaceContext() workspace: CurrentWorkspace,
    @Param("jobId") jobId: string,
  ) {
    return this.jobsService.retry(workspace.organization.id, jobId);
  }
}
