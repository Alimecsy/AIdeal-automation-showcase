import type { Prisma } from "@aideal/db";
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

@Injectable()
export class SopTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  listTemplates(organizationId: string) {
    return this.prisma.sopTemplate.findMany({
      where: {
        organizationId,
      },
      orderBy: {
        updatedAt: "desc",
      },
      select: {
        id: true,
        name: true,
        version: true,
        status: true,
        scoringWeightsJson: true,
        mandatoryRulesJson: true,
        redFlagRulesJson: true,
        recommendationRulesJson: true,
        createdAt: true,
        updatedAt: true,
        dealType: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  async createTemplate(input: {
    organizationId: string;
    dealTypeId: string;
    name: string;
    scoringWeightsJson?: Prisma.InputJsonValue;
    mandatoryRulesJson?: Prisma.InputJsonValue;
    redFlagRulesJson?: Prisma.InputJsonValue;
    recommendationRulesJson?: Prisma.InputJsonValue;
  }) {
    const dealType = await this.prisma.dealType.findFirst({
      where: {
        id: input.dealTypeId,
        organizationId: input.organizationId,
      },
      select: {
        id: true,
      },
    });

    if (!dealType) {
      throw new NotFoundException("Deal type not found in active organization");
    }

    return this.prisma.sopTemplate.create({
      data: {
        organizationId: input.organizationId,
        dealTypeId: input.dealTypeId,
        name: input.name,
        scoringWeightsJson: input.scoringWeightsJson,
        mandatoryRulesJson: input.mandatoryRulesJson,
        redFlagRulesJson: input.redFlagRulesJson,
        recommendationRulesJson: input.recommendationRulesJson,
      },
      select: {
        id: true,
        name: true,
        version: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        dealType: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }
}
