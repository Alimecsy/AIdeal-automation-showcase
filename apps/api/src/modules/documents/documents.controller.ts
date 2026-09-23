import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import type { CurrentWorkspace } from "../auth/auth.types";
import { ClerkAuthGuard } from "../auth/clerk-auth.guard";
import { CurrentWorkspaceContext } from "../auth/current-workspace.decorator";
import { WorkspaceGuard } from "../auth/workspace.guard";
import { DocumentsService } from "./documents.service";

@UseGuards(ClerkAuthGuard, WorkspaceGuard)
@Controller("documents")
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  listDocuments(@CurrentWorkspaceContext() workspace: CurrentWorkspace) {
    return this.documentsService.listDocuments(workspace.organization.id);
  }

  @Get(":documentId")
  getDocument(
    @CurrentWorkspaceContext() workspace: CurrentWorkspace,
    @Param("documentId") documentId: string,
  ) {
    return this.documentsService.getDocument(
      workspace.organization.id,
      documentId,
    );
  }

  @Post(":documentId/extract")
  queueExtraction(
    @CurrentWorkspaceContext() workspace: CurrentWorkspace,
    @Param("documentId") documentId: string,
  ) {
    return this.documentsService.queueExtraction(
      workspace.organization.id,
      documentId,
    );
  }
}
