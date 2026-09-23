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
  /**
   * Token verification is held as a replaceable member so the guard's own
   * behavior can be exercised without a live Clerk instance. Production always
   * uses Clerk's verifier.
   */
  private readonly verify = (token: string) =>
    verifyToken(token, {
      secretKey: env.CLERK_SECRET_KEY,
    }) as unknown as Promise<Record<string, unknown>>;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      auth?: AuthContext;
    }>();
    const token = this.getBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException("Missing authorization token");
    }

    // verifyToken resolves with the payload and throws on any verification
    // failure; it does not report failure through the returned value.
    let claims: Record<string, unknown>;

    try {
      claims = await this.verify(token);
    } catch {
      throw new UnauthorizedException("Invalid Clerk token");
    }

    const clerkUserId =
      typeof claims.sub === "string" ? claims.sub : null;

    if (!clerkUserId) {
      throw new UnauthorizedException("Missing Clerk user id");
    }

    request.auth = {
      clerkUserId,
      ...this.readOrganizationClaims(claims),
    };

    return true;
  }

  /**
   * Version 2 session tokens carry organization claims in a nested `o` object;
   * version 1 tokens use flat `org_*` claims. Only the organization id is load
   * bearing here: authorization reads the locally persisted membership role,
   * not the role claim, so the two role encodings never need reconciling.
   */
  private readOrganizationClaims(claims: Record<string, unknown>) {
    const nested =
      claims.o && typeof claims.o === "object" && !Array.isArray(claims.o)
        ? (claims.o as Record<string, unknown>)
        : null;

    const read = (nestedKey: string, flatKey: string) => {
      const value = nested ? nested[nestedKey] : claims[flatKey];
      return typeof value === "string" && value.length > 0 ? value : null;
    };

    return {
      clerkOrgId: read("id", "org_id"),
      orgRole: read("rol", "org_role"),
      orgSlug: read("slg", "org_slug"),
    };
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
