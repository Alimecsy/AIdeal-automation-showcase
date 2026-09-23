import { Module } from "@nestjs/common";
import { OrganizationsModule } from "../organizations/organizations.module";
import { PrismaModule } from "../prisma.module";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { WorkspaceGuard } from "../auth/workspace.guard";
import { DealsModule } from "../deals/deals.module";
import { JobsModule } from "../jobs/jobs.module";
import { IntakeSubmissionsController } from "./intake-submissions.controller";
import { IntakeSubmissionsService } from "./intake-submissions.service";

@Module({
  imports: [PrismaModule, OrganizationsModule, DealsModule, JobsModule],
  controllers: [IntakeSubmissionsController],
  providers: [ClerkAuthGuard, IntakeSubmissionsService, RolesGuard, WorkspaceGuard],
})
export class IntakeSubmissionsModule {}
