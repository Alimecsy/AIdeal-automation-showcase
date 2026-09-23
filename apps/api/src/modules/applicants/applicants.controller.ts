import { Controller, Get, UseGuards } from "@nestjs/common";
import type { CurrentWorkspace } from "../auth/auth.types";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { CurrentWorkspaceContext } from "../auth/current-workspace.decorator";
import { WorkspaceGuard } from "../auth/workspace.guard";
import { ApplicantsService } from "./applicants.service";

@UseGuards(ClerkAuthGuard, WorkspaceGuard)
@Controller("applicants")
export class ApplicantsController {
  constructor(private readonly applicantsService: ApplicantsService) {}

  @Get()
  listApplicants(@CurrentWorkspaceContext() workspace: CurrentWorkspace) {
    return this.applicantsService.listApplicants(workspace.organization.id);
  }
}
