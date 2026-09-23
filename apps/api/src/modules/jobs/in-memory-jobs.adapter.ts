import { JobsPort, type EnqueueJobInput } from "./jobs.port";

export class InMemoryJobsAdapter extends JobsPort {
  readonly jobs: EnqueueJobInput[] = [];

  enqueue(input: EnqueueJobInput) {
    this.jobs.push(input);
    return Promise.resolve({ id: `memory-job-${this.jobs.length}`, ...input });
  }

  enqueueAi(input: Parameters<JobsPort["enqueueAi"]>[0]) {
    return this.enqueue({
      organizationId: input.organizationId,
      type: "ai.generate",
      payload: { prompt: input.prompt },
    });
  }
}
