import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/workspace";
import { AppHeader } from "./header";

const navItems = [
  ["Command Center", "/app"],
  ["Deals", "/app/deals"],
  ["Applicants", "/app/applicants"],
  ["Documents", "/app/documents"],
  ["Intake Forms", "/app/intake-forms"],
  ["SOP & Rules", "/app/sop-rules"],
  ["Notifications", "/app/notifications"],
  ["Settings", "/app/settings"],
] as const;

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated, orgId } = await auth();

  if (!isAuthenticated) {
    redirect("/sign-in");
  }

  if (!orgId) {
    redirect("/workspace/new");
  }

  const workspace = await requireWorkspace();

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="brand">AIDEAL</div>
        <p className="muted" style={{ marginTop: 10 }}>
          {workspace.organization.name}
        </p>
        <nav className="sidebar-nav" aria-label="App navigation">
          {navItems.map(([label, href], index) => (
            <Link
              className={`sidebar-link ${index === 0 ? "active" : ""}`}
              href={href}
              key={href}
            >
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="main">
        <AppHeader
          membershipRole={workspace.membership.role}
          organizationName={workspace.organization.name}
        />
        {children}
      </main>
    </div>
  );
}
