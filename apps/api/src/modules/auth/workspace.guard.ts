import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Injectable, NotFoundException } from "@nestjs/common";
import { OrganizationsService } from "../organizations/organizations.service";
import type { AuthContext, CurrentWorkspace } from "./auth.types";

@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(private readonly organizationsService: OrganizationsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      auth: AuthContext;
      workspace?: CurrentWorkspace;
    }>();

    if (!request.auth?.clerkOrgId) {
      throw new NotFoundException("No active Clerk organization");
    }

    const workspace = await this.organizationsService.getCurrentWorkspace(
      request.auth.clerkUserId,
      request.auth.clerkOrgId,
    );

    if (!workspace) {
      throw new NotFoundException("Organization is not synced locally");
    }

    request.workspace = workspace;

    return true;
  }
}
