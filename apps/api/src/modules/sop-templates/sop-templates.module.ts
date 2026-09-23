import { Module } from "@nestjs/common";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { WorkspaceGuard } from "../auth/workspace.guard";
import { OrganizationsModule } from "../organizations/organizations.module";
import { SopTemplatesController } from "./sop-templates.controller";
import { SopTemplatesService } from "./sop-templates.service";

@Module({
  imports: [OrganizationsModule],
  controllers: [SopTemplatesController],
  providers: [ClerkAuthGuard, RolesGuard, SopTemplatesService, WorkspaceGuard],
})
export class SopTemplatesModule {}
