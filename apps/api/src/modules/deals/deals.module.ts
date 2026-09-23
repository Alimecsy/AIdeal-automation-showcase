import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { DealsService } from "./deals.service";
import { InternalDealsController, InternalWorkerAuthentication } from "./internal-deals.controller";

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [InternalDealsController],
  providers: [DealsService, InternalWorkerAuthentication],
  exports: [DealsService],
})
export class DealsModule {}
