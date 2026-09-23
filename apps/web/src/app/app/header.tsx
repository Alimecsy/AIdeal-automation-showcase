import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";

export function AppHeader({
  membershipRole,
  organizationName,
}: {
  membershipRole: string;
  organizationName: string;
}) {
  return (
    <div
      style={{
        alignItems: "center",
        display: "flex",
        gap: 12,
        justifyContent: "space-between",
        marginBottom: 24,
      }}
    >
      <div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{organizationName}</div>
        <div className="muted" style={{ textTransform: "capitalize" }}>
          {membershipRole.replaceAll("_", " ")}
        </div>
      </div>
      <div style={{ alignItems: "center", display: "flex", gap: 12 }}>
        <OrganizationSwitcher
          hidePersonal
          afterCreateOrganizationUrl="/workspace/bootstrap"
          afterSelectOrganizationUrl="/workspace/bootstrap"
        />
        <UserButton />
      </div>
    </div>
  );
}
