import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@aideal/db";
import { env } from "@aideal/env";
import { PrismaService } from "../prisma.service";
import { JobsPort, type EnqueueJobInput } from "./jobs.port";

@Injectable()
export class JobsService extends JobsPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async enqueue(input: EnqueueJobInput) {
    // The database row is the durable scheduling record. Workers discover it by
    // availableAt, so Redis outages cannot lose or reject work.
    return this.prisma.job.create({
      data: {
        organizationId: input.organizationId,
        type: input.type,
        payloadJson: input.payload as Prisma.InputJsonValue | undefined,
      },
      select: {
        id: true,
        type: true,
        status: true,
        createdAt: true,
      },
    });

  }

  async enqueueAi(input: {
    organizationId: string;
    dealId?: string;
    provider?: string;
    model?: string;
    prompt: string;
    runType?: string;
    promptVersion?: string;
  }) {
    const aiRun = await this.prisma.aiRun.create({
      data: {
        organizationId: input.organizationId,
        dealId: input.dealId,
        runType: input.runType ?? "deal_packet",
        provider: input.provider ?? env.AI_DEFAULT_PROVIDER,
        model: input.model ?? (input.provider === "openrouter" ? env.OPENROUTER_DEFAULT_MODEL : env.GEMINI_DEFAULT_MODEL),
        promptVersion: input.promptVersion ?? "v1",
        inputRefsJson: { source: "manual_job" },
        status: "queued",
      },
      select: { id: true, provider: true, model: true, status: true, createdAt: true },
    });

    try {
      const job = await this.enqueue({
        organizationId: input.organizationId,
        type: "ai.generate",
        payload: { aiRunId: aiRun.id, prompt: input.prompt },
      });
      return { aiRun, job };
    } catch (error) {
      await this.prisma.aiRun.update({
        where: { id: aiRun.id },
        data: { status: "failed", errorMessage: error instanceof Error ? error.message : "Queue error" },
      });
      throw error;
    }
  }

  list(organizationId: string) {
    return this.prisma.job.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        type: true,
        status: true,
        attempts: true,
        maxAttempts: true,
        errorMessage: true,
        availableAt: true,
        leaseExpiresAt: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async retry(organizationId: string, jobId: string) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, organizationId },
    });

    if (!job) {
      throw new NotFoundException("Job not found");
    }

    // An active lease may already be performing an external side effect. It
    // must be allowed to finish or expire into worker recovery; manual retry
    // must never clear its fencing token.
    if (job.status === "running") {
      throw new ConflictException("Job is currently running and cannot be retried");
    }

    const reset = await this.prisma.job.updateMany({
      where: { id: job.id, organizationId, status: { in: ["queued", "completed", "failed"] } },
      data: {
        status: "queued",
        errorMessage: null,
        availableAt: new Date(),
        leaseExpiresAt: null,
        leaseToken: null,
        startedAt: null,
        completedAt: null,
      },
    });
    if (reset.count === 0) {
      throw new ConflictException("Job state changed; retry was not applied");
    }
    return { id: job.id, type: job.type, status: "queued" as const, attempts: job.attempts };
  }
}
