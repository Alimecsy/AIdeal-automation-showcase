import { Module } from "@nestjs/common";
import { R2StorageService } from "./r2-storage.service";
import { StoragePort } from "./storage.port";

@Module({
  providers: [
    R2StorageService,
    { provide: StoragePort, useExisting: R2StorageService },
  ],
  exports: [R2StorageService, StoragePort],
})
export class StorageModule {}
