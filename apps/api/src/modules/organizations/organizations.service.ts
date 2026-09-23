import type { MembershipRole, MembershipStatus } from "@aideal/db";
import { Injectable } from "@nestjs/common";
import type { CurrentWorkspace } from "../auth/auth.types";
import { PrismaService } from "../prisma.service";

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  listOrganizationsForUser(clerkUserId: string) {
    return this.prisma.organizationMembership.findMany({
      where: {
        user: {
          clerkUserId,
        },
      },
      orderBy: {
        organization: {
          createdAt: "desc",
        },
      },
      select: {
        role: true,
        status: true,
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async getCurrentWorkspace(
    clerkUserId: string,
    organizationId: string,
  ): Promise<CurrentWorkspace | null> {
    const membership = await this.prisma.organizationMembership.findFirst({
      where: {
        organizationId,
        status: "active",
        user: {
          clerkUserId,
        },
      },
      select: {
        role: true,
        status: true,
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        user: {
          select: {
            id: true,
            clerkUserId: true,
            email: true,
            name: true,
          },
        },
      },
    });

    if (!membership) {
      return null;
    }

    return {
      organization: membership.organization,
      membership: membership,
      user: membership.user,
    };
  }

  async bootstrapOrganization(input: {
    clerkOrganizationId: string;
    organizationName: string;
    organizationSlug: string;
    clerkUserId: string;
    email: string;
    name: string | null;
    role?: MembershipRole;
    status?: MembershipStatus;
  }) {
    const role = input.role ?? "owner_admin";
    const status = input.status ?? "active";

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: {
          clerkUserId: input.clerkUserId,
        },
        update: {
          email: input.email,
          name: input.name,
        },
        create: {
          clerkUserId: input.clerkUserId,
          email: input.email,
          name: input.name,
        },
        select: {
          id: true,
          clerkUserId: true,
          email: true,
          name: true,
        },
      });

      const organization = await tx.organization.upsert({
        where: {
          id: input.clerkOrganizationId,
        },
        update: {
          name: input.organizationName,
          slug: input.organizationSlug,
        },
        create: {
          id: input.clerkOrganizationId,
          name: input.organizationName,
          slug: input.organizationSlug,
        },
        select: {
          id: true,
          name: true,
          slug: true,
        },
      });

      const membership = await tx.organizationMembership.upsert({
        where: {
          organizationId_userId: {
            organizationId: organization.id,
            userId: user.id,
          },
        },
        update: {
          status,
        },
        create: {
          organizationId: organization.id,
          userId: user.id,
          role,
          status,
        },
        select: {
          role: true,
          status: true,
        },
      });

      const existingDealTypeCount = await tx.dealType.count({
        where: {
          organizationId: organization.id,
        },
      });

      if (existingDealTypeCount === 0) {
        await tx.dealType.create({
          data: {
            organizationId: organization.id,
            name: "Generic Financing / Trade Request",
            description:
              "Starter deal type for financing and trade request intake.",
            subtypeOptionsJson: [
              "Trade Finance Request",
              "Commodity Purchase LOI",
              "Project Finance Request",
              "Working Capital Request",
            ],
          },
        });
      }

      return {
        organization,
        membership,
        user,
      };
    });
  }
}
