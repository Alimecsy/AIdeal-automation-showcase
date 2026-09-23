import { Module } from "@nestjs/common";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { WorkspaceGuard } from "../auth/workspace.guard";
import { OrganizationsModule } from "../organizations/organizations.module";
import { DealTypesController } from "./deal-types.controller";
import { DealTypesService } from "./deal-types.service";

@Module({
  imports: [OrganizationsModule],
  controllers: [DealTypesController],
  providers: [ClerkAuthGuard, DealTypesService, RolesGuard, WorkspaceGuard],
})
export class DealTypesModule {}
