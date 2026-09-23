import { Controller, Get } from "@nestjs/common";
import { Redis } from "@upstash/redis";
import { env } from "@aideal/env";

const redis =
  env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: env.UPSTASH_REDIS_REST_URL,
        token: env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

@Controller("health")
export class HealthController {
  @Get()
  async getHealth() {
    const redisStatus = redis ? await checkRedis() : "not_configured";

    return {
      ok: true,
      service: "aideal-api",
      redis: redisStatus,
      timestamp: new Date().toISOString(),
    };
  }
}

async function checkRedis(): Promise<"ok" | "error"> {
  try {
    await redis?.ping();
    return "ok";
  } catch {
    return "error";
  }
}
