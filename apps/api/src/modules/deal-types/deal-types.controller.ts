import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import type { Prisma } from "@aideal/db";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { CurrentWorkspaceContext } from "../auth/current-workspace.decorator";
import type { CurrentWorkspace } from "../auth/auth.types";
import { WorkspaceGuard } from "../auth/workspace.guard";
import { DealTypesService } from "./deal-types.service";

type CreateDealTypeBody = {
  name: string;
  description?: string | null;
  subtypeOptionsJson?: unknown;
  active?: boolean;
};

@UseGuards(ClerkAuthGuard, WorkspaceGuard)
@Controller("deal-types")
export class DealTypesController {
  constructor(private readonly dealTypesService: DealTypesService) {}

  @Get()
  listDealTypes(@CurrentWorkspaceContext() workspace: CurrentWorkspace) {
    return this.dealTypesService.listDealTypes(workspace.organization.id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles("owner_admin")
  createDealType(
    @CurrentWorkspaceContext() workspace: CurrentWorkspace,
    @Body() body: CreateDealTypeBody,
  ) {
    return this.dealTypesService.createDealType({
      organizationId: workspace.organization.id,
      name: body.name,
      description: body.description,
      subtypeOptionsJson: body.subtypeOptionsJson as
        | Prisma.InputJsonValue
        | undefined,
      active: body.active,
    });
  }
}
