import { Module } from "@nestjs/common";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { WorkspaceGuard } from "../auth/workspace.guard";
import { OrganizationsModule } from "../organizations/organizations.module";
import { PrismaModule } from "../prisma.module";
import { JobsController } from "./jobs.controller";
import { JobsService } from "./jobs.service";
import { JobsPort } from "./jobs.port";

@Module({
  imports: [OrganizationsModule, PrismaModule],
  controllers: [JobsController],
  providers: [
    ClerkAuthGuard,
    JobsService,
    RolesGuard,
    WorkspaceGuard,
    { provide: JobsPort, useExisting: JobsService },
  ],
  exports: [JobsPort, JobsService],
})
export class JobsModule {}
