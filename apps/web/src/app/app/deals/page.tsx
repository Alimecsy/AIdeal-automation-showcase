import Link from "next/link";
import { apiFetch } from "@/lib/server-api";

type SubmissionRecord = {
  id: string;
  status: string;
  submittedAt: string | null;
  title: string;
  intakeSession: {
    applicantEmail: string;
  };
  intakeForm: {
    name: string;
    sopTemplate: {
      name: string;
      dealType: {
        name: string;
      };
    };
  };
  summary: {
    requestType: string | null;
    jurisdiction: string | null;
  };
  rating: string | null;
  confidence: string | null;
  researchFollowUp: boolean;
  missingDocuments: boolean;
  prioritySignals: string[];
};

type QueueResponse = {
  items: SubmissionRecord[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

async function getFilteredSubmissions(filters: Record<string, string>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) search.set(key, value);
  }
  const response = await apiFetch(`/intake-submissions${search.size ? `?${search}` : ""}`);

  if (!response.ok) {
    throw new Error(`Failed to load intake submissions: ${response.status}`);
  }

  return response.json() as Promise<QueueResponse>;
}

const statuses = [
  ["", "All statuses"],
  ["submitted", "Submitted"],
  ["processing", "Processing"],
  ["review_ready", "Review ready"],
  ["action_required", "Action required"],
  ["manual_review", "Manual review"],
  ["accepted", "Accepted"],
  ["rejected", "Rejected"],
  ["failed", "Failed"],
] as const;

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const status = params.status ?? "";
  const query = params.q?.trim() ?? "";
  const rating = params.rating ?? "";
  const confidence = params.confidence ?? "";
  const researchFollowUp = params.researchFollowUp ?? "";
  const missingDocuments = params.missingDocuments ?? "";
  const olderThanDays = params.olderThanDays ?? "";
  const sort = params.sort ?? "priority";
  const page = params.page ?? "1";
  const queue = await getFilteredSubmissions({
    status, q: query, rating, confidence, researchFollowUp,
    missingDocuments, olderThanDays, sort, page,
  });
  const hasFilters = [status, query, rating, confidence, researchFollowUp,
    missingDocuments, olderThanDays].some(Boolean);

  return (
    <section>
      <h1 className="page-title">Deals</h1>
      <p className="page-subtitle">
        Browse, filter, and manage financing and trade requests.
      </p>

      <form className="deal-filters" method="get">
        <div className="field">
          <label className="field-label" htmlFor="deal-search">Search applicant or company</label>
          <input
            className="input"
            defaultValue={query}
            id="deal-search"
            name="q"
            placeholder="Search by email or legal name"
            type="search"
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="deal-status">Status</label>
          <select className="input" defaultValue={status} id="deal-status" name="status">
            {statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="deal-rating">Rating</label>
          <select className="input" defaultValue={rating} id="deal-rating" name="rating">
            <option value="">All ratings</option>
            {(["A", "B", "C", "D", "F"] as const).map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="deal-confidence">Confidence</label>
          <select className="input" defaultValue={confidence} id="deal-confidence" name="confidence">
            <option value="">All confidence</option>
            {(["high", "medium", "low"] as const).map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="deal-research">Research</label>
          <select className="input" defaultValue={researchFollowUp} id="deal-research" name="researchFollowUp">
            <option value="">All research</option>
            <option value="required">Follow-up required</option>
            <option value="clear">No follow-up</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="deal-documents">Documents</label>
          <select className="input" defaultValue={missingDocuments} id="deal-documents" name="missingDocuments">
            <option value="">All document states</option>
            <option value="required">Missing documents</option>
            <option value="clear">Complete documents</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="deal-age">Age</label>
          <select className="input" defaultValue={olderThanDays} id="deal-age" name="olderThanDays">
            <option value="">Any age</option>
            <option value="3">Older than 3 days</option>
            <option value="7">Older than 7 days</option>
            <option value="30">Older than 30 days</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="deal-sort">Sort</label>
          <select className="input" defaultValue={sort} id="deal-sort" name="sort">
            <option value="priority">Priority</option>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
        </div>
        <div className="button-row deal-filter-actions">
          <button className="button button-dark" type="submit">Apply filters</button>
          {hasFilters ? <Link className="button button-secondary-dark" href="/app/deals">Clear</Link> : null}
        </div>
      </form>

      <div className="stack-list" style={{ marginTop: 24 }}>
        {queue.items.length === 0 ? (
          <div className="panel">
            <h2 className="panel-title">No matching deals</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Adjust the status or search terms to broaden the review queue.
            </p>
          </div>
        ) : (
          queue.items.map((submission) => (
            <Link
              className="list-card"
              href={`/app/deals/${submission.id}`}
              key={submission.id}
            >
              <div className="deal-row">
                <div>
                  <strong>{submission.title}</strong>
                  <div className="muted small-text" style={{ marginTop: 6 }}>
                    {submission.intakeForm.sopTemplate.dealType.name} ·{" "}
                    {submission.intakeForm.name}
                  </div>
                </div>
                <div className="signal">
                  <span>Status</span>
                  <strong>{submission.status}</strong>
                </div>
                <div className="signal">
                  <span>Priority</span>
                  <strong>{submission.prioritySignals.length ? submission.prioritySignals.join(", ") : "Standard"}</strong>
                </div>
                <div className="signal">
                  <span>Rating / confidence</span>
                  <strong>{submission.rating ?? "Pending"} · {submission.confidence ?? "Pending"}</strong>
                </div>
                <div className="signal">
                  <span>Applicant</span>
                  <strong>{submission.intakeSession.applicantEmail}</strong>
                </div>
                <div className="signal">
                  <span>Request Type</span>
                  <strong>{submission.summary.requestType ?? "Not provided"}</strong>
                </div>
                <div className="signal">
                  <span>Jurisdiction</span>
                  <strong>{submission.summary.jurisdiction ?? "Not provided"}</strong>
                </div>
                <div className="signal">
                  <span>Submitted</span>
                  <strong>
                    {submission.submittedAt
                      ? new Date(submission.submittedAt).toLocaleString()
                      : "Pending"}
                  </strong>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
      {queue.pagination.totalPages > 1 ? (
        <nav aria-label="Deal queue pages" className="button-row" style={{ marginTop: 24 }}>
          {queue.pagination.page > 1 ? (
            <Link className="button button-secondary-dark" href={{ pathname: "/app/deals", query: { ...params, page: String(queue.pagination.page - 1) } }}>
              Previous
            </Link>
          ) : null}
          <span className="muted small-text">Page {queue.pagination.page} of {queue.pagination.totalPages}</span>
          {queue.pagination.page < queue.pagination.totalPages ? (
            <Link className="button button-secondary-dark" href={{ pathname: "/app/deals", query: { ...params, page: String(queue.pagination.page + 1) } }}>
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}
