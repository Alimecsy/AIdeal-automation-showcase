import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { apiFetch } from "@/lib/server-api";

export default async function WorkspaceBootstrapPage() {
  const authState = await auth();

  if (!authState.isAuthenticated) {
    redirect("/sign-in");
  }

  if (!authState.orgId) {
    redirect("/workspace/new");
  }

  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const email = user.primaryEmailAddress?.emailAddress;

  if (!email) {
    throw new Error("Signed-in user is missing a primary email address");
  }

  const client = await clerkClient();
  const organization = await client.organizations.getOrganization({
    organizationId: authState.orgId,
  });

  const response = await apiFetch("/organizations/bootstrap", {
    method: "POST",
    body: JSON.stringify({
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug ?? authState.orgSlug ?? organization.id,
      },
      user: {
        email,
        name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();

    throw new Error(`Failed to bootstrap workspace: ${detail}`);
  }

  redirect("/app");
}
