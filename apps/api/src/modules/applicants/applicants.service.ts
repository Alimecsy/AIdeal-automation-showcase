import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

@Injectable()
export class ApplicantsService {
  constructor(private readonly prisma: PrismaService) {}

  listApplicants(organizationId: string) {
    return this.prisma.applicant.findMany({
      where: {
        organizationId,
      },
      orderBy: {
        updatedAt: "desc",
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        roleTitle: true,
        authorityConfirmed: true,
        updatedAt: true,
        company: {
          select: {
            id: true,
            legalName: true,
            jurisdiction: true,
          },
        },
        deals: {
          select: {
            id: true,
            title: true,
            status: true,
            intakeSubmissionId: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });
  }
}
