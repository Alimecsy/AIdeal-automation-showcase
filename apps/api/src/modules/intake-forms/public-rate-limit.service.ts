import { createHash } from "node:crypto";
import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { Redis } from "@upstash/redis";
import { env } from "@aideal/env";

type Counter = { count: number; expiresAt: number };

@Injectable()
export class PublicRateLimitService {
  private readonly redis =
    env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
      ? Redis.fromEnv()
      : null;
  private readonly localCounters = new Map<string, Counter>();

  async assertAllowed(scope: string, identity: string, limit: number, windowSeconds: number) {
    const key = `aideal:public-rate:${scope}:${this.hash(identity)}`;
    if (this.redis) {
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, windowSeconds);
      if (count > limit) throw new HttpException("Too many requests", HttpStatus.TOO_MANY_REQUESTS);
      return;
    }

    const now = Date.now();
    const current = this.localCounters.get(key);
    const counter = !current || current.expiresAt <= now
      ? { count: 1, expiresAt: now + windowSeconds * 1000 }
      : { count: current.count + 1, expiresAt: current.expiresAt };
    this.localCounters.set(key, counter);
    if (this.localCounters.size > 10_000) {
      for (const [counterKey, value] of this.localCounters) {
        if (value.expiresAt <= now) this.localCounters.delete(counterKey);
      }
    }
    if (counter.count > limit) throw new HttpException("Too many requests", HttpStatus.TOO_MANY_REQUESTS);
  }

  private hash(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
}
