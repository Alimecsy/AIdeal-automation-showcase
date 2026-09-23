import type { MembershipRole } from "@aideal/db";
import { SetMetadata } from "@nestjs/common";

export const ROLES_KEY = "roles";

export const Roles = (...roles: MembershipRole[]) => SetMetadata(ROLES_KEY, roles);
