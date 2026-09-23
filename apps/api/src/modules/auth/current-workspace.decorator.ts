import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { CurrentWorkspace } from "./auth.types";

export const CurrentWorkspaceContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentWorkspace => {
    const request = context.switchToHttp().getRequest<{
      workspace: CurrentWorkspace;
    }>();

    return request.workspace;
  },
);
