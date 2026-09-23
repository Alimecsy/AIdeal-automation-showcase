import { PrismaClient } from "@aideal/db";
import { env } from "@aideal/env";
import { PrismaNeon } from "@prisma/adapter-neon";
import { Injectable, OnModuleDestroy } from "@nestjs/common";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    // The pooled driver, not the HTTP one: HTTP mode cannot open a
    // transaction, and this application's correctness rests on them --
    // intake submission, deal transitions with their audit history, workspace
    // bootstrap, job completion, and the notification outbox are all written
    // inside one.
    const adapter = new PrismaNeon({
      connectionString: env.DATABASE_URL ?? "",
    });

    super({
      adapter,
      // Measured against this database: acquiring a cold pooled connection can
      // take several seconds, and each statement inside a transaction costs
      // roughly 300-450ms. Prisma's 5s default is sized for a local Postgres
      // and expires mid-transaction here -- the finalizer alone issues more
      // than ten statements. These bounds are generous but still bounded.
      transactionOptions: { maxWait: 15_000, timeout: 30_000 },
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
