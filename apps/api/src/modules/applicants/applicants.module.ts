import { Module } from "@nestjs/common";
import { OrganizationsModule } from "../organizations/organizations.module";
import { PrismaModule } from "../prisma.module";
import { ApplicantsController } from "./applicants.controller";
import { ApplicantsService } from "./applicants.service";

@Module({
  imports: [PrismaModule, OrganizationsModule],
  controllers: [ApplicantsController],
  providers: [ApplicantsService],
})
export class ApplicantsModule {}
