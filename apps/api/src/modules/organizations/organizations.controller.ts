import { Body, Controller, ForbiddenException, Get, Post, UseGuards } from "@nestjs/common";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { CurrentAuth } from "../auth/current-auth.decorator";
import type { AuthContext } from "../auth/auth.types";
import { CurrentWorkspaceContext } from "../auth/current-workspace.decorator";
import type { CurrentWorkspace } from "../auth/auth.types";
import { WorkspaceGuard } from "../auth/workspace.guard";
import { OrganizationsService } from "./organizations.service";

type BootstrapOrganizationBody = {
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  user: {
    email: string;
    name: string | null;
  };
};

@UseGuards(ClerkAuthGuard)
@Controller("organizations")
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  listOrganizations(@CurrentAuth() auth: AuthContext) {
    return this.organizationsService.listOrganizationsForUser(auth.clerkUserId);
  }

  @Get("current")
  @UseGuards(WorkspaceGuard)
  getCurrentOrganization(@CurrentWorkspaceContext() workspace: CurrentWorkspace) {
    return workspace;
  }

  @Post("bootstrap")
  bootstrapOrganization(
    @CurrentAuth() auth: AuthContext,
    @Body() body: BootstrapOrganizationBody,
  ) {
    if (body.organization.id !== auth.clerkOrgId) {
      throw new ForbiddenException("Organization does not match the active Clerk organization");
    }

    return this.organizationsService.bootstrapOrganization({
      clerkOrganizationId: body.organization.id,
      organizationName: body.organization.name,
      organizationSlug: body.organization.slug,
      clerkUserId: auth.clerkUserId,
      email: body.user.email,
      name: body.user.name,
    });
  }
}
