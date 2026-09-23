import { PrismaClient } from "@aideal/db";
import { PrismaNeonHTTP } from "@prisma/adapter-neon";
import { env } from "@aideal/env";
import { JobProcessor } from "./job-processor";
import { NotificationOutboxDispatcher } from "./notification-outbox";

const pollIntervalMs = 1_000;

async function startWorker() {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const prisma = new PrismaClient({ adapter: new PrismaNeonHTTP(env.DATABASE_URL, {}) });
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
