import Link from "next/link";
import { revalidatePath } from "next/cache";
import { parseJsonInput } from "@/lib/json";
import { apiFetch } from "@/lib/server-api";
import { requireAdminWorkspace, requireWorkspace } from "@/lib/workspace";

type DealTypeRecord = {
  id: string;
  name: string;
};

type SopTemplateOption = {
  id: string;
  name: string;
  version: number;
  status: "draft" | "active" | "archived";
  dealType: DealTypeRecord;
};

type IntakeFormRecord = {
  id: string;
  name: string;
  publicSlug: string;
  status: "draft" | "active" | "archived";
  sectionsJson: unknown;
  documentRequirementsJson: unknown;
  updatedAt: string;
  sopTemplate: {
    id: string;
    name: string;
    dealType: DealTypeRecord;
  };
};

async function createIntakeFormAction(formData: FormData) {
  "use server";

  await requireAdminWorkspace();

  const response = await apiFetch("/intake-forms", {
    method: "POST",
    body: JSON.stringify({
      sopTemplateId: String(formData.get("sopTemplateId") ?? ""),
      name: String(formData.get("name") ?? "").trim(),
      publicSlug: String(formData.get("publicSlug") ?? "").trim() || null,
      status: String(formData.get("status") ?? "draft"),
      sectionsJson: parseJsonInput(
        String(formData.get("sectionsJson") ?? ""),
        [
          {
            id: "company-profile",
            title: "Company Profile",
            fields: [
              { key: "legalName", label: "Legal company name", type: "text", required: true },
              { key: "jurisdiction", label: "Jurisdiction", type: "text", required: true },
            ],
          },
        ],
      ),
      documentRequirementsJson: parseJsonInput(
        String(formData.get("documentRequirementsJson") ?? ""),
        [
          {
            key: "proof_of_funds",
            label: "Proof of funds",
            required: true,
          },
          {
            key: "company_registration",
            label: "Company registration document",
            required: true,
          },
        ],
      ),
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create intake form: ${response.status}`);
  }

  revalidatePath("/app/intake-forms");
}

function summarizeSections(value: unknown) {
  if (!Array.isArray(value)) {
    return "No configured sections";
  }

  return `${value.length} section${value.length === 1 ? "" : "s"}`;
}

function summarizeDocuments(value: unknown) {
  if (!Array.isArray(value)) {
    return "No document rules";
  }

  const required = value.filter(
    (entry) => typeof entry === "object" && entry !== null && "required" in entry && entry.required,
  ).length;

  return `${value.length} docs · ${required} required`;
}

export default async function IntakeFormsPage() {
  const workspace = await requireWorkspace();
  const [formsResponse, templatesResponse] = await Promise.all([
    apiFetch("/intake-forms"),
    apiFetch("/sop-templates"),
  ]);

  if (!formsResponse.ok) {
    throw new Error(`Failed to load intake forms: ${formsResponse.status}`);
  }

  if (!templatesResponse.ok) {
    throw new Error(`Failed to load SOP templates: ${templatesResponse.status}`);
  }

  const forms = (await formsResponse.json()) as IntakeFormRecord[];
  const templates = (await templatesResponse.json()) as SopTemplateOption[];
  const isAdmin = workspace.membership.role === "owner_admin";

  return (
    <section>
      <header className="page-header">
        <div>
          <h1 className="page-title">Intake Forms</h1>
          <p className="page-subtitle">
            Create applicant-facing request forms from your SOP templates, define
            sections and document rules, and generate a public slug for preview
            and submission.
          </p>
        </div>
      </header>

      <div
        className="dashboard-grid"
        style={{ gridTemplateColumns: "minmax(0, 1fr) 430px" }}
      >
        <div className="panel">
          <h2 className="panel-title">Configured Forms</h2>
          <div className="stack-list">
            {forms.map((form) => (
              <div className="list-card" key={form.id}>
                <div className="list-card-header">
                  <div>
                    <strong>{form.name}</strong>
                    <div className="muted">
                      {form.sopTemplate.name} · {form.sopTemplate.dealType.name}
                    </div>
                  </div>
                  <div className="list-card-meta">
                    <span className="chip chip-blue">{form.status}</span>
                    <Link className="button button-inline" href={`/forms/${form.publicSlug}`}>
                      Preview
                    </Link>
                  </div>
                </div>
                <div className="form-summary-grid">
                  <div className="muted small-text">
                    <strong>Slug:</strong> /forms/{form.publicSlug}
                  </div>
                  <div className="muted small-text">
                    <strong>Structure:</strong> {summarizeSections(form.sectionsJson)}
                  </div>
                  <div className="muted small-text">
                    <strong>Documents:</strong>{" "}
                    {summarizeDocuments(form.documentRequirementsJson)}
                  </div>
                  <div className="muted small-text">
                    <strong>Updated:</strong>{" "}
                    {new Date(form.updatedAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
            ))}
            {forms.length === 0 ? (
              <div className="empty-state">
                No intake forms yet. Create one from a draft or active SOP
                template.
              </div>
            ) : null}
          </div>
        </div>

        <aside className="panel">
          <h2 className="panel-title">Create Intake Form</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Admin only. The JSON editors are temporary scaffolding for form
            sections and document requirements until the visual builder is added.
          </p>
          {isAdmin ? (
            <form action={createIntakeFormAction} className="form-stack">
              <label className="field">
                <span className="field-label">Form Name</span>
                <input
                  className="input"
                  name="name"
                  placeholder="Commodity Trade Request Form"
                  required
                />
              </label>
              <label className="field">
                <span className="field-label">SOP Template</span>
                <select className="input" name="sopTemplateId" required>
                  <option value="">Select SOP template</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} · {template.dealType.name} · v{template.version}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Public Slug</span>
                <input
                  className="input"
                  name="publicSlug"
                  placeholder="commodity-trade-request"
                />
              </label>
              <label className="field">
                <span className="field-label">Status</span>
                <select className="input" defaultValue="draft" name="status">
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
              <label className="field">
                <span className="field-label">Sections JSON</span>
                <textarea
                  className="textarea code-textarea"
                  name="sectionsJson"
                  rows={12}
                  defaultValue={`[
  {
    "id": "company-profile",
    "title": "Company Profile",
    "fields": [
      { "key": "legalName", "label": "Legal company name", "type": "text", "required": true },
      { "key": "jurisdiction", "label": "Jurisdiction", "type": "text", "required": true }
    ]
  },
  {
    "id": "transaction-details",
    "title": "Transaction Details",
    "fields": [
      { "key": "requestType", "label": "Request type", "type": "text", "required": true },
      { "key": "amount", "label": "Requested amount", "type": "text", "required": true }
    ]
  }
]`}
                />
              </label>
              <label className="field">
                <span className="field-label">Document Requirements JSON</span>
                <textarea
                  className="textarea code-textarea"
                  name="documentRequirementsJson"
                  rows={10}
                  defaultValue={`[
  { "key": "proof_of_funds", "label": "Proof of funds", "required": true },
  { "key": "company_registration", "label": "Company registration document", "required": true },
  { "key": "transaction_term_sheet", "label": "Transaction term sheet", "required": false }
]`}
                />
              </label>
              <button className="button button-dark" type="submit">
                Create intake form
              </button>
            </form>
          ) : (
            <div className="empty-state">
              Only workspace admins can create or edit intake forms.
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
