import { Module } from "@nestjs/common";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { WorkspaceGuard } from "../auth/workspace.guard";
import { OrganizationsModule } from "../organizations/organizations.module";
import { StorageModule } from "../storage/storage.module";
import {
  IntakeFormsController,
  PublicIntakeFormsController,
  PublicIntakeSessionsController,
} from "./intake-forms.controller";
import { IntakeFormsService } from "./intake-forms.service";
import { IntakeWorkflowService } from "./intake-workflow.service";
import { JobsModule } from "../jobs/jobs.module";
import { DealsModule } from "../deals/deals.module";
import { PublicRateLimitService } from "./public-rate-limit.service";
import { UsageModule } from "../usage/usage.module";

@Module({
  imports: [OrganizationsModule, StorageModule, JobsModule, DealsModule, UsageModule],
  controllers: [
    IntakeFormsController,
    PublicIntakeFormsController,
    PublicIntakeSessionsController,
  ],
  providers: [
    ClerkAuthGuard,
    IntakeFormsService,
    IntakeWorkflowService,
    RolesGuard,
    WorkspaceGuard,
    PublicRateLimitService,
  ],
  exports: [IntakeWorkflowService],
})
export class IntakeFormsModule {}
