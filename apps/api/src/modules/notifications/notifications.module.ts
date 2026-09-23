import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { UsageModule } from "../usage/usage.module";
import { OrganizationsModule } from "../organizations/organizations.module";
import { PrismaModule } from "../prisma.module";

@Module({
  imports: [PrismaModule, OrganizationsModule, UsageModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
