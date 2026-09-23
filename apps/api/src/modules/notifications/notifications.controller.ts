import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import type { CurrentWorkspace } from "../auth/auth.types";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { CurrentWorkspaceContext } from "../auth/current-workspace.decorator";
import { WorkspaceGuard } from "../auth/workspace.guard";
import { NotificationsService } from "./notifications.service";

@UseGuards(ClerkAuthGuard, WorkspaceGuard)
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(@CurrentWorkspaceContext() workspace: CurrentWorkspace) {
    return this.notificationsService.list(workspace);
  }

  @Get("unread")
  listUnread(@CurrentWorkspaceContext() workspace: CurrentWorkspace) {
    return this.notificationsService.list(workspace, true);
  }

  @Post(":notificationId/read")
  markRead(
    @CurrentWorkspaceContext() workspace: CurrentWorkspace,
    @Param("notificationId") notificationId: string,
  ) {
    return this.notificationsService.markRead(workspace, notificationId);
  }
}
