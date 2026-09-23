import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { backendApiFetch } from "@/lib/backend-api";

type PublicFormRecord = {
  id: string;
  name: string;
  publicSlug: string;
  status: "draft" | "active" | "archived";
  sectionsJson: unknown;
  documentRequirementsJson: unknown;
  sopTemplate: {
    id: string;
    name: string;
    dealType: {
      id: string;
      name: string;
    };
  };
  organization: {
    id: string;
    name: string;
  };
};

async function getPublicForm(slug: string) {
  const response = await backendApiFetch(`/public/intake-forms/${slug}`);

  if (response.status === 404) {
    notFound();
  }

  if (!response.ok) {
    throw new Error(`Failed to load public intake form: ${response.status}`);
  }

  return response.json() as Promise<PublicFormRecord>;
}

async function createSessionAction(formData: FormData) {
  "use server";

  const slug = String(formData.get("slug") ?? "");
  const applicantEmail = String(formData.get("applicantEmail") ?? "").trim();
  const response = await backendApiFetch(`/public/intake-forms/${slug}/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      applicantEmail,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create intake session: ${response.status}`);
  }

  const payload = (await response.json()) as { token: string; publicSlug: string };

  revalidatePath(`/forms/${slug}`);
  redirect(`/forms/${payload.publicSlug}/session/${payload.token}`);
}

export default async function PublicFormStartPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const form = await getPublicForm(slug);
  const sections = Array.isArray(form.sectionsJson) ? form.sectionsJson : [];
  const documents = Array.isArray(form.documentRequirementsJson)
    ? form.documentRequirementsJson
    : [];

  return (
    <main className="public-form-shell">
      <section className="public-form-hero">
        <div className="public-form-badge">{form.organization.name}</div>
        <h1 className="public-form-title">{form.name}</h1>
        <p className="public-form-subtitle">
          {form.sopTemplate.dealType.name} · {form.sopTemplate.name}
        </p>
      </section>

      <section className="public-form-layout">
        <div className="panel">
          <h2 className="panel-title">Start Application</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Enter the applicant email to begin. The next screen provides a
            resumable wizard link and autosaves your progress.
          </p>
          <form action={createSessionAction} className="form-stack">
            <input name="slug" type="hidden" value={slug} />
            <label className="field">
              <span className="field-label">Applicant Email</span>
              <input
                className="input"
                name="applicantEmail"
                placeholder="applicant@company.com"
                required
                type="email"
              />
            </label>
            <button className="button button-primary" type="submit">
              Start intake wizard
            </button>
          </form>
        </div>

        <aside className="panel">
          <h2 className="panel-title">Preview</h2>
          <div className="stack-list">
            <div className="list-card">
              <strong>Sections</strong>
              <div className="muted small-text">
                {sections.length} configured section
                {sections.length === 1 ? "" : "s"}
              </div>
            </div>
            <div className="list-card">
              <strong>Document Requirements</strong>
              <div className="muted small-text">
                {documents.length} configured document
                {documents.length === 1 ? "" : "s"}
              </div>
            </div>
            <div className="list-card">
              <strong>Status</strong>
              <div className="muted small-text">{form.status}</div>
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
