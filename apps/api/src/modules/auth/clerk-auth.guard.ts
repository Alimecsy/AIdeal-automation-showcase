import { env } from "@aideal/env";
import { verifyToken } from "@clerk/backend";
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { AuthContext } from "./auth.types";

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      auth?: AuthContext;
    }>();
    const token = this.getBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException("Missing authorization token");
    }

    const verified = await verifyToken(token, {
      secretKey: env.CLERK_SECRET_KEY,
    });

    if (!verified.data) {
      throw new UnauthorizedException("Invalid Clerk token");
    }

    const claims = verified.data as Record<string, unknown>;

    const clerkUserId =
      typeof claims.sub === "string" ? claims.sub : null;

    if (!clerkUserId) {
      throw new UnauthorizedException("Missing Clerk user id");
    }

    request.auth = {
      clerkUserId,
      clerkOrgId: typeof claims.org_id === "string" ? claims.org_id : null,
      orgRole: typeof claims.org_role === "string" ? claims.org_role : null,
      orgSlug: typeof claims.org_slug === "string" ? claims.org_slug : null,
    };

    return true;
  }

  private getBearerToken(header: string | string[] | undefined) {
    if (!header || Array.isArray(header)) {
      return null;
    }

    if (!header.startsWith("Bearer ")) {
      return null;
    }

    return header.slice("Bearer ".length).trim();
  }
}
