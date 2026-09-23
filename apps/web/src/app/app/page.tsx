import Link from "next/link";
import { apiFetch } from "@/lib/server-api";

type SubmissionRecord = {
  id: string;
  status: string;
  submittedAt: string | null;
  title: string;
  applicant: {
    name: string;
    email: string;
  } | null;
  company: {
    legalName: string;
    jurisdiction: string | null;
  } | null;
  intakeSession: {
    applicantEmail: string;
  };
  summary: {
    requestType: string | null;
    jurisdiction: string | null;
  };
};

type DocumentRecord = {
  id: string;
  status: string;
};

async function getDashboardData() {
  const [submissionsResponse, documentsResponse] = await Promise.all([
    apiFetch("/intake-submissions"),
    apiFetch("/documents"),
  ]);

  if (!submissionsResponse.ok) {
    throw new Error(`Failed to load dashboard submissions: ${submissionsResponse.status}`);
  }

  if (!documentsResponse.ok) {
    throw new Error(`Failed to load dashboard documents: ${documentsResponse.status}`);
  }

  return {
    submissions: ((await submissionsResponse.json()) as { items: SubmissionRecord[] }).items,
    documents: (await documentsResponse.json()) as DocumentRecord[],
  };
}

export default async function CommandCenterPage() {
  const { submissions, documents } = await getDashboardData();

  const metrics = [
    ["Submitted requests", String(submissions.length)],
    [
      "Needs identity review",
      String(submissions.filter((submission) => !submission.applicant || !submission.company).length),
    ],
    [
      "Documents uploaded",
      String(documents.length),
    ],
    [
      "Extraction pending",
      String(documents.filter((document) => document.status === "uploaded").length),
    ],
  ] as const;

  const priorityQueue = submissions.slice(0, 5);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Deal Command Center</h1>
          <p className="page-subtitle">
            Review the financing and trade requests that need attention now.
          </p>
        </div>
        <Link className="button button-primary" href="/app/intake-forms">
          Create intake form
        </Link>
      </header>

      <section className="metric-grid" aria-label="Deal metrics">
        {metrics.map(([label, value]) => (
          <div className="metric-card" key={label}>
            <div className="metric-label">{label}</div>
            <div className="metric-value">{value}</div>
          </div>
        ))}
      </section>

      <section className="dashboard-grid">
        <div className="panel">
          <h2 className="panel-title">Priority Queue</h2>
          {priorityQueue.length === 0 ? (
            <div className="muted">No submissions yet.</div>
          ) : (
            priorityQueue.map((submission) => (
              <Link className="deal-row" href={`/app/deals/${submission.id}`} key={submission.id}>
                <div>
                  <strong>{submission.company?.legalName ?? submission.title}</strong>
                  <div className="muted">
                    {submission.summary.requestType ?? "Financing / trade request"} ·{" "}
                    {submission.applicant?.email ?? submission.intakeSession.applicantEmail}
                  </div>
                </div>
                <strong>{submission.company?.jurisdiction ?? "Review"}</strong>
                <span className="chip chip-blue">{submission.status}</span>
                <span className="chip chip-warning">
                  {!submission.applicant || !submission.company
                    ? "Materialize identity"
                    : "Review packet"}
                </span>
              </Link>
            ))
          )}
        </div>

        <aside className="panel">
          <h2 className="panel-title">AIDEAL Briefing</h2>
          <p className="muted">
            {submissions.length === 0
              ? "No submitted requests yet. Activate an intake form and begin collecting applicant packets."
              : `${submissions.length} submitted request${submissions.length === 1 ? "" : "s"} are available for review. ${
                  submissions.filter((submission) => !submission.applicant || !submission.company).length
                } still require applicant/company materialization checks.`}
          </p>
        </aside>
      </section>
    </>
  );
}
