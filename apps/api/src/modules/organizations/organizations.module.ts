import { Module } from "@nestjs/common";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { WorkspaceGuard } from "../auth/workspace.guard";
import { OrganizationsController } from "./organizations.controller";
import { OrganizationsService } from "./organizations.service";

@Module({
  controllers: [OrganizationsController],
  providers: [
    ClerkAuthGuard,
    OrganizationsService,
    RolesGuard,
    WorkspaceGuard,
  ],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
