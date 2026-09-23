import Link from "next/link";
import { apiFetch } from "@/lib/server-api";

type ApplicantRecord = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  roleTitle: string | null;
  authorityConfirmed: boolean;
  updatedAt: string;
  company: {
    id: string;
    legalName: string;
    jurisdiction: string | null;
  } | null;
  deals: Array<{
    id: string;
    title: string;
    status: string;
    intakeSubmissionId: string | null;
  }>;
};

async function getApplicants() {
  const response = await apiFetch("/applicants");

  if (!response.ok) {
    throw new Error(`Failed to load applicants: ${response.status}`);
  }

  return response.json() as Promise<ApplicantRecord[]>;
}

export default async function ApplicantsPage() {
  const applicants = await getApplicants();

  return (
    <section>
      <h1 className="page-title">Applicants</h1>
      <p className="page-subtitle">
        Review companies, contacts, verification status, and associated deals.
      </p>

      <div className="stack-list" style={{ marginTop: 24 }}>
        {applicants.length === 0 ? (
          <div className="panel">
            <h2 className="panel-title">No applicants yet</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Applicants will appear here once submissions are materialized into
              internal applicant and company records.
            </p>
          </div>
        ) : (
          applicants.map((applicant) => (
            <div className="list-card" key={applicant.id}>
              <div className="list-card-header">
                <div>
                  <strong>{applicant.name}</strong>
                  <div className="muted small-text">{applicant.email}</div>
                </div>
                <div className="list-card-meta">
                  {applicant.authorityConfirmed ? "Authority confirmed" : "Authority pending"}
                </div>
              </div>
              <div className="muted small-text">
                {applicant.roleTitle ?? "No role provided"} ·{" "}
                {applicant.company?.legalName ?? "No company linked"}
              </div>
              <div className="muted small-text" style={{ marginTop: 6 }}>
                Updated {new Date(applicant.updatedAt).toLocaleString()}
              </div>
              {applicant.deals.length > 0 ? (
                <div className="stack-list" style={{ marginTop: 12 }}>
                  {applicant.deals.map((deal) => (
                    <div className="signal" key={deal.id}>
                      <span>{deal.status}</span>
                      <strong>
                        {deal.intakeSubmissionId ? (
                          <Link href={`/app/deals/${deal.intakeSubmissionId}`}>
                            {deal.title}
                          </Link>
                        ) : (
                          deal.title
                        )}
                      </strong>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
