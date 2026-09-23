import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { AuthContext } from "./auth.types";

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const request = context.switchToHttp().getRequest<{ auth: AuthContext }>();

    return request.auth;
  },
);
