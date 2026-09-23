import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import type { Prisma } from "@aideal/db";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import type { CurrentWorkspace } from "../auth/auth.types";
import { CurrentWorkspaceContext } from "../auth/current-workspace.decorator";
import { WorkspaceGuard } from "../auth/workspace.guard";
import { SopTemplatesService } from "./sop-templates.service";

type CreateSopTemplateBody = {
  dealTypeId: string;
  name: string;
  scoringWeightsJson?: unknown;
  mandatoryRulesJson?: unknown;
  redFlagRulesJson?: unknown;
  recommendationRulesJson?: unknown;
};

@UseGuards(ClerkAuthGuard, WorkspaceGuard)
@Controller("sop-templates")
export class SopTemplatesController {
  constructor(private readonly sopTemplatesService: SopTemplatesService) {}

  @Get()
  listTemplates(@CurrentWorkspaceContext() workspace: CurrentWorkspace) {
    return this.sopTemplatesService.listTemplates(workspace.organization.id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles("owner_admin")
  createTemplate(
    @CurrentWorkspaceContext() workspace: CurrentWorkspace,
    @Body() body: CreateSopTemplateBody,
  ) {
    return this.sopTemplatesService.createTemplate({
      organizationId: workspace.organization.id,
      dealTypeId: body.dealTypeId,
      name: body.name,
      scoringWeightsJson: body.scoringWeightsJson as
        | Prisma.InputJsonValue
        | undefined,
      mandatoryRulesJson: body.mandatoryRulesJson as
        | Prisma.InputJsonValue
        | undefined,
      redFlagRulesJson: body.redFlagRulesJson as
        | Prisma.InputJsonValue
        | undefined,
      recommendationRulesJson: body.recommendationRulesJson as
        | Prisma.InputJsonValue
        | undefined,
    });
  }
}
