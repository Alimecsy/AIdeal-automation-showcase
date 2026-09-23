import { createHash } from "node:crypto";
import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { Redis } from "@upstash/redis";
import { env } from "@aideal/env";

type Counter = { count: number; expiresAt: number };

@Injectable()
export class PublicRateLimitService {
  // A limiter that can fall back locally should give up quickly rather than
  // wear through the client's default retry budget: every retry is latency on
  // an applicant's request, and the answer at the end of it is the local
  // window either way.
  private readonly redis =
    env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
      ? new Redis({
          url: env.UPSTASH_REDIS_REST_URL,
          token: env.UPSTASH_REDIS_REST_TOKEN,
          retry: { retries: 1, backoff: () => 100 },
        })
      : null;
  private readonly localCounters = new Map<string, Counter>();

  /**
   * Shared counting is the correct behavior, but it must not be the only
   * behavior: these are unauthenticated applicant routes with no signed-in
   * caller to retry, so an unreachable Redis has to degrade to process-local
   * windows rather than fail the request. A genuine limit breach still
   * propagates.
   */
  async assertAllowed(scope: string, identity: string, limit: number, windowSeconds: number) {
    const key = `aideal:public-rate:${scope}:${this.hash(identity)}`;
    if (this.redis) {
      try {
        const count = await this.redis.incr(key);
        // "NX" only sets the TTL when the key has none, so a failure between
        // INCR and EXPIRE cannot leave a counter that never expires.
        await this.redis.expire(key, windowSeconds, "NX");
        if (count > limit) throw new HttpException("Too many requests", HttpStatus.TOO_MANY_REQUESTS);
        return;
      } catch (error) {
        if (error instanceof HttpException) throw error;
        console.log(JSON.stringify({
          event: "public_rate_limit.shared_backend_unavailable",
          scope,
          fallback: "process_local",
          error: error instanceof Error ? error.message : "Unknown rate limiter error",
        }));
      }
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
