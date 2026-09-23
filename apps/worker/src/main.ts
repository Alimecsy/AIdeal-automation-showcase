import { PrismaClient } from "@aideal/db";
import { PrismaNeon } from "@prisma/adapter-neon";
import { env } from "@aideal/env";
import { JobProcessor } from "./job-processor";
import { NotificationOutboxDispatcher } from "./notification-outbox";

const pollIntervalMs = 1_000;

async function startWorker() {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  // The pooled driver, not the HTTP one: the finalizer, job completion, and
  // the notification outbox all depend on real transactions, which HTTP mode
  // cannot open.
  const prisma = new PrismaClient({
    adapter: new PrismaNeon({ connectionString: env.DATABASE_URL }),
      // Measured against this database: acquiring a cold pooled connection can
      // take several seconds, and each statement inside a transaction costs
      // roughly 300-450ms. Prisma's 5s default is sized for a local Postgres
      // and expires mid-transaction here -- the finalizer alone issues more
      // than ten statements. These bounds are generous but still bounded.
      transactionOptions: { maxWait: 15_000, timeout: 30_000 },
  });
  const processor = new JobProcessor(prisma);
  const notificationOutbox = new NotificationOutboxDispatcher(prisma);

  console.log(JSON.stringify({ ok: true, service: "aideal-worker", environment: env.NODE_ENV }));

  const shutdown = async () => {
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  while (true) {
    const [processedJob, processedNotification] = await Promise.all([
      processor.processNext(), notificationOutbox.processNext(),
    ]);
    if (!processedJob && !processedNotification) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

void startWorker().catch((error) => {
  console.error(error);
  process.exit(1);
});
