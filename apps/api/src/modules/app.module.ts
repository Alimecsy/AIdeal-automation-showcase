import { Module } from "@nestjs/common";
import { ApplicantsModule } from "./applicants/applicants.module";
import { DealTypesModule } from "./deal-types/deal-types.module";
import { DocumentsModule } from "./documents/documents.module";
import { HealthController } from "./health.controller";
import { IntakeFormsModule } from "./intake-forms/intake-forms.module";
import { IntakeSubmissionsModule } from "./intake-submissions/intake-submissions.module";
import { JobsModule } from "./jobs/jobs.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { PrismaModule } from "./prisma.module";
import { SopTemplatesModule } from "./sop-templates/sop-templates.module";
import { UsageModule } from "./usage/usage.module";

@Module({
  imports: [
    PrismaModule,
    ApplicantsModule,
    OrganizationsModule,
    DealTypesModule,
    DocumentsModule,
    SopTemplatesModule,
    IntakeFormsModule,
    IntakeSubmissionsModule,
    JobsModule,
    UsageModule,
    NotificationsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
