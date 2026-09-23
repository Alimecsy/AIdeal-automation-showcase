import { notFound } from "next/navigation";
import { PublicIntakeWizard } from "@/components/public-intake-wizard";
import { backendApiFetch } from "@/lib/backend-api";

type SessionRecord = {
  id: string;
  applicantEmail: string;
  answersJson: Record<string, unknown> | null;
  status: "draft" | "submitted" | "expired";
  intakeForm: {
    id: string;
    name: string;
    publicSlug: string;
    sectionsJson: unknown;
    documentRequirementsJson: unknown;
    organization: {
      id: string;
      name: string;
    };
  };
};

async function getSession(token: string) {
  const response = await backendApiFetch(`/public/intake-sessions/${token}`);

  if (response.status === 404) {
    notFound();
  }

  if (!response.ok) {
    throw new Error(`Failed to load intake session: ${response.status}`);
  }

  return response.json() as Promise<SessionRecord>;
}

export default async function PublicIntakeSessionPage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  const session = await getSession(token);

  if (session.intakeForm.publicSlug !== slug) {
    notFound();
  }

  const sections = Array.isArray(session.intakeForm.sectionsJson)
    ? (session.intakeForm.sectionsJson as Array<{
        id?: string;
        title?: string;
        fields?: Array<{
          key?: string;
          label?: string;
          type?: string;
          required?: boolean;
          options?: Array<{ label?: string; value?: string }>;
        }>;
      }>)
    : [];
  const documentRequirements = Array.isArray(
    session.intakeForm.documentRequirementsJson,
  )
    ? (session.intakeForm.documentRequirementsJson as Array<{
        key?: string;
        label?: string;
        required?: boolean;
      }>)
    : [];

  return (
    <main className="public-form-shell">
      <PublicIntakeWizard
        documentRequirements={documentRequirements}
        formName={session.intakeForm.name}
        initialAnswers={(session.answersJson ?? {}) as Record<string, unknown>}
        initialApplicantEmail={session.applicantEmail}
        initialStatus={session.status}
        organizationName={session.intakeForm.organization.name}
        publicSlug={session.intakeForm.publicSlug}
        sections={sections}
        sessionToken={token}
      />
    </main>
  );
}
