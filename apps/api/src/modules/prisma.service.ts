import { PrismaClient } from "@aideal/db";
import { env } from "@aideal/env";
import { PrismaNeonHTTP } from "@prisma/adapter-neon";
import { Injectable, OnModuleDestroy } from "@nestjs/common";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const adapter = new PrismaNeonHTTP(env.DATABASE_URL ?? "", {});

    super({ adapter });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
