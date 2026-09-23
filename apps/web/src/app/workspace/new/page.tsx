import { CreateOrganization } from "@clerk/nextjs";

export default function WorkspaceCreatePage() {
  return (
    <main
      className="shell"
      style={{
        display: "grid",
        minHeight: "100vh",
        padding: 24,
        placeItems: "center",
      }}
    >
      <CreateOrganization
        afterCreateOrganizationUrl="/workspace/bootstrap"
        appearance={{
          elements: {
            cardBox: {
              boxShadow: "0 18px 64px rgba(15, 23, 42, 0.08)",
            },
          },
        }}
      />
    </main>
  );
}
