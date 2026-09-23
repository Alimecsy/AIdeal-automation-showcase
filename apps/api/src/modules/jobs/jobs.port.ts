export type EnqueueJobInput = {
  organizationId: string;
  type: string;
  payload?: Record<string, unknown>;
};

export abstract class JobsPort {
  abstract enqueue(input: EnqueueJobInput): Promise<unknown>;
  abstract enqueueAi(input: {
    organizationId: string;
    dealId?: string;
    provider?: string;
    model?: string;
    prompt: string;
    runType?: string;
    promptVersion?: string;
  }): Promise<unknown>;
}
