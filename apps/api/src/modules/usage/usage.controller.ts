import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import type { CurrentWorkspace } from "../auth/auth.types";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { CurrentWorkspaceContext } from "../auth/current-workspace.decorator";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { WorkspaceGuard } from "../auth/workspace.guard";
import { UsageService } from "./usage.service";

@UseGuards(ClerkAuthGuard, WorkspaceGuard, RolesGuard)
@Roles("owner_admin")
@Controller("usage")
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get("summary")
  summary(@CurrentWorkspaceContext() workspace: CurrentWorkspace, @Query("days") days?: string) {
    return this.usage.summary(workspace.organization.id, Number(days) || 30);
  }
}
