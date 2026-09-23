import { env } from "@aideal/env";

type Fetch = typeof fetch;

export interface DealTransitions {
  transitionToReviewReady(input: { organizationId: string; dealId: string }): Promise<void>;
}

/** Calls the API's narrowly-scoped, authenticated lifecycle command. */
export class InternalApiDealTransitions implements DealTransitions {
  constructor(
    private readonly request: Fetch = fetch,
    private readonly configuration = {
      apiUrl: env.INTERNAL_API_URL,
      workerToken: env.INTERNAL_WORKER_TOKEN,
    },
  ) {}

  async transitionToReviewReady(input: { organizationId: string; dealId: string }) {
    if (!this.configuration.apiUrl || !this.configuration.workerToken) {
      throw new Error("INTERNAL_API_URL and INTERNAL_WORKER_TOKEN are required for governed deal transitions");
    }

    const response = await this.request(
      `${this.configuration.apiUrl.replace(/\/$/, "")}/api/internal/deals/${encodeURIComponent(input.dealId)}/review-ready`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-aideal-worker-token": this.configuration.workerToken,
        },
        body: JSON.stringify({ organizationId: input.organizationId }),
      },
    );
    if (!response.ok) {
      throw new Error(`Governed deal transition failed (${response.status})`);
    }
  }
}
