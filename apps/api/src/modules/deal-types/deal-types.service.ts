import type { Prisma } from "@aideal/db";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

@Injectable()
export class DealTypesService {
  constructor(private readonly prisma: PrismaService) {}

  listDealTypes(organizationId: string) {
    return this.prisma.dealType.findMany({
      where: {
        organizationId,
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        name: true,
        description: true,
        subtypeOptionsJson: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            sopTemplates: true,
          },
        },
      },
    });
  }

  createDealType(input: {
    organizationId: string;
    name: string;
    description?: string | null;
    subtypeOptionsJson?: Prisma.InputJsonValue;
    active?: boolean;
  }) {
    return this.prisma.dealType.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        description: input.description ?? null,
        subtypeOptionsJson: input.subtypeOptionsJson,
        active: input.active ?? true,
      },
      select: {
        id: true,
        name: true,
        description: true,
        subtypeOptionsJson: true,
        active: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
}
