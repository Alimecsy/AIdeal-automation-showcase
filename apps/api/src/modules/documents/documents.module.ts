import { Module } from "@nestjs/common";
import { OrganizationsModule } from "../organizations/organizations.module";
import { PrismaModule } from "../prisma.module";
import { JobsModule } from "../jobs/jobs.module";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";

@Module({
  imports: [PrismaModule, OrganizationsModule, JobsModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
