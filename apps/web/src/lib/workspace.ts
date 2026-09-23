import { redirect } from "next/navigation";
import { apiFetch } from "./server-api";

export type WorkspaceContext = {
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  membership: {
    role: string;
    status: string;
  };
  user: {
    id: string;
    clerkUserId: string;
    email: string;
    name: string | null;
  };
};

export async function requireWorkspace(): Promise<WorkspaceContext> {
  const response = await apiFetch("/organizations/current");

  if (response.status === 404) {
    redirect("/workspace/bootstrap");
  }

  if (!response.ok) {
    throw new Error(`Failed to load workspace context: ${response.status}`);
  }

  return response.json() as Promise<WorkspaceContext>;
}

export async function requireAdminWorkspace(): Promise<WorkspaceContext> {
  const workspace = await requireWorkspace();

  if (workspace.membership.role !== "owner_admin") {
    redirect("/app");
  }

  return workspace;
}
