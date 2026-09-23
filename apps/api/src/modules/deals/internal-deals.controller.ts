import { Body, Controller, Headers, Injectable, Param, Post, UnauthorizedException } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { env } from "@aideal/env";
import { DealsService } from "./deals.service";

export function hasValidInternalWorkerToken(
  presented: string | undefined,
  expected = env.INTERNAL_WORKER_TOKEN,
) {
  if (!expected || !presented) return false;
  const expectedBuffer = Buffer.from(expected);
  const presentedBuffer = Buffer.from(presented);
  return expectedBuffer.length === presentedBuffer.length
    && timingSafeEqual(expectedBuffer, presentedBuffer);
}

@Injectable()
export class InternalWorkerAuthentication {
  hasValidToken(presented: string | undefined) {
    return hasValidInternalWorkerToken(presented);
  }
}

/**
 * Internal-only lifecycle command for the database worker.  It deliberately
 * exposes one fixed transition instead of a general-purpose privileged API.
 */
@Controller("internal/deals")
export class InternalDealsController {
  constructor(
    private readonly dealsService: DealsService,
    private readonly authentication: InternalWorkerAuthentication,
  ) {}

  @Post(":dealId/review-ready")
  transitionToReviewReady(
    @Param("dealId") dealId: string,
    @Body() body: { organizationId?: string },
    @Headers("x-aideal-worker-token") workerToken?: string,
  ) {
    if (!this.authentication.hasValidToken(workerToken)) {
      throw new UnauthorizedException("Invalid internal worker credentials");
    }
    if (!body.organizationId) {
      throw new UnauthorizedException("Missing internal worker organization scope");
    }

    return this.dealsService.transition({
      organizationId: body.organizationId,
      dealId,
      toStatus: "review_ready",
      actor: { actorType: "system", actorReference: "worker" },
    });
  }
}
