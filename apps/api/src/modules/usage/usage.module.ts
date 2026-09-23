import { Module } from "@nestjs/common";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { WorkspaceGuard } from "../auth/workspace.guard";
import { OrganizationsModule } from "../organizations/organizations.module";
import { PrismaModule } from "../prisma.module";
import { UsageController } from "./usage.controller";
import { UsageService } from "./usage.service";

@Module({
  imports: [PrismaModule, OrganizationsModule],
  controllers: [UsageController],
  providers: [ClerkAuthGuard, RolesGuard, WorkspaceGuard, UsageService],
  exports: [UsageService],
})
export class UsageModule {}
