import { revalidatePath } from "next/cache";
import { apiFetch } from "@/lib/server-api";
import { parseJsonInput } from "@/lib/json";
import { requireAdminWorkspace, requireWorkspace } from "@/lib/workspace";

type DealTypeOption = {
  id: string;
  name: string;
};

type SopTemplateRecord = {
  id: string;
  name: string;
  version: number;
  status: "draft" | "active" | "archived";
  createdAt: string;
  updatedAt: string;
  dealType: DealTypeOption;
};

async function createSopTemplateAction(formData: FormData) {
  "use server";

  await requireAdminWorkspace();

  const response = await apiFetch("/sop-templates", {
    method: "POST",
    body: JSON.stringify({
      dealTypeId: String(formData.get("dealTypeId") ?? ""),
      name: String(formData.get("name") ?? "").trim(),
      scoringWeightsJson: parseJsonInput(
        String(formData.get("scoringWeightsJson") ?? ""),
        {},
      ),
      mandatoryRulesJson: parseJsonInput(
        String(formData.get("mandatoryRulesJson") ?? ""),
        {},
      ),
      redFlagRulesJson: parseJsonInput(
        String(formData.get("redFlagRulesJson") ?? ""),
        {},
      ),
      recommendationRulesJson: parseJsonInput(
        String(formData.get("recommendationRulesJson") ?? ""),
        {},
      ),
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create SOP template: ${response.status}`);
  }

  revalidatePath("/app/sop-rules");
  revalidatePath("/app/intake-forms");
}

export default async function SopRulesPage() {
  const workspace = await requireWorkspace();
  const [templatesResponse, dealTypesResponse] = await Promise.all([
    apiFetch("/sop-templates"),
    apiFetch("/deal-types"),
  ]);

  if (!templatesResponse.ok) {
    throw new Error(`Failed to load SOP templates: ${templatesResponse.status}`);
  }

  if (!dealTypesResponse.ok) {
    throw new Error(`Failed to load deal types: ${dealTypesResponse.status}`);
  }

  const templates = (await templatesResponse.json()) as SopTemplateRecord[];
  const dealTypes = (await dealTypesResponse.json()) as DealTypeOption[];
  const isAdmin = workspace.membership.role === "owner_admin";

  return (
    <section>
      <header className="page-header">
        <div>
          <h1 className="page-title">SOP &amp; Rules</h1>
          <p className="page-subtitle">
            Define the rating logic, non-negotiables, red flags, and
            recommendation rules that AIDEAL should apply per request type.
          </p>
        </div>
      </header>

      <div className="dashboard-grid" style={{ gridTemplateColumns: "minmax(0, 1fr) 420px" }}>
        <div className="panel">
          <h2 className="panel-title">SOP Templates</h2>
          <div className="stack-list">
            {templates.map((template) => (
              <div className="list-card" key={template.id}>
                <div className="list-card-header">
                  <div>
                    <strong>{template.name}</strong>
                    <div className="muted">{template.dealType.name}</div>
                  </div>
                  <div className="list-card-meta">
                    <span className="chip chip-blue">v{template.version}</span>
                    <span className="chip chip-neutral">{template.status}</span>
                  </div>
                </div>
                <div className="muted small-text">
                  Updated {new Date(template.updatedAt).toLocaleDateString()}
                </div>
              </div>
            ))}
            {templates.length === 0 ? (
              <div className="empty-state">
                No SOP templates yet. Create the first ruleset for one of your
                deal types.
              </div>
            ) : null}
          </div>
        </div>

        <aside className="panel">
          <h2 className="panel-title">Create SOP Template</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Start with draft templates. Review flows, rule editors, and scoring
            UI will deepen in the next slice.
          </p>
          {isAdmin ? (
            <form action={createSopTemplateAction} className="form-stack">
              <label className="field">
                <span className="field-label">Template Name</span>
                <input className="input" name="name" required placeholder="Commodity Trade Base SOP" />
              </label>
              <label className="field">
                <span className="field-label">Deal Type</span>
                <select className="input" name="dealTypeId" required>
                  <option value="">Select deal type</option>
                  {dealTypes.map((dealType) => (
                    <option key={dealType.id} value={dealType.id}>
                      {dealType.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Scoring Weights JSON</span>
                <textarea
                  className="textarea code-textarea"
                  defaultValue={`{\n  "documentCompleteness": 20,\n  "companyVerification": 20,\n  "financialReadiness": 20,\n  "transactionClarity": 20,\n  "riskProfile": 20\n}`}
                  name="scoringWeightsJson"
                  rows={8}
                />
              </label>
              <label className="field">
                <span className="field-label">Mandatory Rules JSON</span>
                <textarea
                  className="textarea code-textarea"
                  defaultValue={`{\n  "requiredDocuments": ["proof_of_funds", "company_registration"],\n  "mustHaveCompanyName": true\n}`}
                  name="mandatoryRulesJson"
                  rows={6}
                />
              </label>
              <label className="field">
                <span className="field-label">Red Flag Rules JSON</span>
                <textarea
                  className="textarea code-textarea"
                  defaultValue={`{\n  "adverseMedia": true,\n  "sanctionsCheck": true,\n  "unverifiableCounterparty": true\n}`}
                  name="redFlagRulesJson"
                  rows={6}
                />
              </label>
              <label className="field">
                <span className="field-label">Recommendation Rules JSON</span>
                <textarea
                  className="textarea code-textarea"
                  defaultValue={`{\n  "missingProofOfFunds": "request_proof_of_funds",\n  "lowConfidenceResearch": "manual_review"\n}`}
                  name="recommendationRulesJson"
                  rows={6}
                />
              </label>
              <button className="button button-dark" type="submit">
                Create SOP template
              </button>
            </form>
          ) : (
            <div className="empty-state">
              Only workspace admins can create or edit SOP templates.
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
