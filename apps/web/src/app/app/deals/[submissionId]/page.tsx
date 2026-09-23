import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { apiFetch } from "@/lib/server-api";

async function reviewAction(formData: FormData) {
  "use server";

  const submissionId = String(formData.get("submissionId") ?? "");
  const action = String(formData.get("action") ?? "");
  const note = String(formData.get("note") ?? "");
  const response = await apiFetch(`/intake-submissions/${submissionId}/review`, {
    method: "PATCH",
    body: JSON.stringify({ action, note }),
  });

  if (!response.ok) {
    throw new Error(`Failed to update deal review status: ${response.status}`);
  }

  revalidatePath(`/app/deals/${submissionId}`);
  revalidatePath("/app/deals");
}

async function researchReviewAction(formData: FormData) {
  "use server";

  const submissionId = String(formData.get("submissionId") ?? "");
  const reportId = String(formData.get("reportId") ?? "");
  const sourceId = String(formData.get("sourceId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "");
  const response = await apiFetch(`/intake-submissions/${submissionId}/research-review`, {
    method: "PATCH",
    body: JSON.stringify({ reportId, sourceId, decision, note }),
  });

  if (!response.ok) {
    throw new Error(`Failed to record research evidence review: ${response.status}`);
  }

  revalidatePath(`/app/deals/${submissionId}`);
}

async function researchRerunAction(formData: FormData) {
  "use server";

  const submissionId = String(formData.get("submissionId") ?? "");
  const response = await apiFetch(`/intake-submissions/${submissionId}/research-rerun`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Failed to queue research rerun: ${response.status}`);
  }

  revalidatePath(`/app/deals/${submissionId}`);
}

type SubmissionDetail = {
  id: string;
  status: string;
  submittedAt: string | null;
  title: string;
  rawAnswersJson: Record<string, unknown> | null;
  applicant: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    roleTitle: string | null;
    authorityConfirmed: boolean;
  } | null;
  company: {
    id: string;
    legalName: string;
    jurisdiction: string | null;
    registrationNumber: string | null;
    website: string | null;
    address: string | null;
  } | null;
  intakeSession: {
    id: string;
    applicantEmail: string;
    status: string;
  };
  intakeForm: {
    id: string;
    name: string;
    publicSlug: string;
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
  };
  deal: {
    id: string;
    title: string;
    status: string;
    currentRating: string | null;
    currentScore: number | null;
    confidence: string | null;
    recommendedAction: string | null;
    sopEvaluations: Array<{
      id: string;
      score: number;
      rating: string;
      categoryScoresJson: unknown;
      mandatoryFailuresJson: unknown;
      redFlagsJson: unknown;
      missingRequirementsJson: unknown;
      recommendation: string | null;
      explanation: string | null;
      createdAt: string;
    }>;
    researchReports: Array<{
      id: string;
      provider: string;
      status: string;
      summary: string | null;
      verifiedFactsJson: unknown;
      unverifiedClaimsJson: unknown;
      inconsistenciesJson: unknown;
      redFlagsJson: unknown;
      sourcesJson: unknown;
      confidence: string | null;
      errorMessage: string | null;
      createdAt: string;
    }>;
    timeline: Array<{
      id: string;
      type: "status_change" | "audit";
      label: string;
      detail: unknown;
      actorUserId: string | null;
      createdAt: string;
    }>;
    researchReviews: Array<{
      id: string;
      reportId: string;
      sourceId: string;
      decision: string;
      note: string | null;
      actorUserId: string | null;
      createdAt: string;
    }>;
    aiRuns: Array<{
      id: string;
      provider: string;
      model: string;
      promptVersion: string;
      status: string;
      confidence: string | null;
      outputJson: unknown;
      errorMessage: string | null;
      createdAt: string;
    }>;
    documents: Array<{
      id: string;
      documentType: string;
      originalFilename: string;
      mimeType: string;
      sizeBytes: number;
      status: string;
      uploadedAt: string;
    }>;
  } | null;
};

async function getSubmission(submissionId: string) {
  const response = await apiFetch(`/intake-submissions/${submissionId}`);

  if (response.status === 404) {
    notFound();
  }

  if (!response.ok) {
    throw new Error(`Failed to load submission: ${response.status}`);
  }

  return response.json() as Promise<SubmissionDetail>;
}

function toEntries(value: Record<string, unknown> | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  return Object.entries(value);
}

function asPacket(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asEvidenceList(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const record = item as Record<string, unknown>;
        const text = typeof record.text === "string" ? record.text : null;
        const sourceIds = Array.isArray(record.sourceIds)
          ? record.sourceIds.filter((id): id is string => typeof id === "string")
          : [];
        return text ? [{ text, sourceIds }] : [];
      })
    : [];
}

function formatTimelineLabel(value: string) {
  return value.replaceAll("_", " ");
}

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const { submissionId } = await params;
  const submission = await getSubmission(submissionId);
  const answers = toEntries(submission.rawAnswersJson);
  const documents = Array.isArray(submission.intakeForm.documentRequirementsJson)
    ? submission.intakeForm.documentRequirementsJson
    : [];
  const dealStatus = submission.deal?.status ?? "submitted";
  const latestRun = submission.deal?.aiRuns[0] ?? null;
  const latestEvaluation = submission.deal?.sopEvaluations[0] ?? null;
  const latestResearch = submission.deal?.researchReports[0] ?? null;
  const packet = asPacket(latestRun?.outputJson);
  const researchSources = Array.isArray(latestResearch?.sourcesJson)
    ? latestResearch.sourcesJson.filter((source): source is Record<string, unknown> => Boolean(source && typeof source === "object" && !Array.isArray(source)))
    : [];
  const sourceLabels = new Map(researchSources.map((source, index) => [
    String(source.sourceId ?? `source-${index + 1}`),
    String(source.title ?? source.url ?? "Source"),
  ]));
  const evidenceGroups = latestResearch ? [
    ["Provisional fact candidates", latestResearch.verifiedFactsJson],
    ["Unverified claims", latestResearch.unverifiedClaimsJson],
    ["Inconsistencies", latestResearch.inconsistenciesJson],
    ["Red flags", latestResearch.redFlagsJson],
  ] as const : [];
  const researchReviews = latestResearch
    ? (submission.deal?.researchReviews ?? []).filter((review) => review.reportId === latestResearch.id)
    : [];
  const reviewBySource = new Map<string, (typeof researchReviews)[number]>();
  for (const review of researchReviews) {
    if (!reviewBySource.has(review.sourceId)) reviewBySource.set(review.sourceId, review);
  }
  const reviewCounts = {
    confirmed: [...reviewBySource.values()].filter((review) => review.decision === "confirmed").length,
    dismissed: [...reviewBySource.values()].filter((review) => review.decision === "dismissed").length,
    followUp: [...reviewBySource.values()].filter((review) => review.decision === "follow_up").length,
  };

  return (
    <section className="dashboard-grid">
      <div className="panel">
        <Link className="muted small-text" href="/app/deals">
          Back to deals
        </Link>
        <h1 className="page-title" style={{ marginTop: 12 }}>
          {submission.title}
        </h1>
        <p className="page-subtitle">
          {submission.intakeForm.sopTemplate.dealType.name} ·{" "}
          {submission.intakeForm.name}
        </p>

        <div className="metric-grid" style={{ marginTop: 24 }}>
          <div className="metric-card">
            <div className="metric-label">Submission Status</div>
            <div className="metric-value">{dealStatus}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Applicant Email</div>
            <div className="metric-value">{submission.intakeSession.applicantEmail}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Submitted At</div>
            <div className="metric-value">
              {submission.submittedAt
                ? new Date(submission.submittedAt).toLocaleString()
                : "Pending"}
            </div>
          </div>
        </div>
      </div>

      <aside className="panel">
        <h2 className="panel-title">Review Packet</h2>
        <div className="stack-list" style={{ marginTop: 16 }}>
          <div className="list-card">
            <strong>Company</strong>
            <div className="muted small-text">
              {submission.company?.legalName ?? "Not materialized yet"}
            </div>
          </div>
          <div className="list-card">
            <strong>Applicant</strong>
            <div className="muted small-text">
              {submission.applicant?.name ?? submission.intakeSession.applicantEmail}
            </div>
          </div>
          <div className="list-card">
            <strong>SOP Template</strong>
            <div className="muted small-text">{submission.intakeForm.sopTemplate.name}</div>
          </div>
          <div className="list-card">
            <strong>Public Form</strong>
            <div className="muted small-text">
              /forms/{submission.intakeForm.publicSlug}
            </div>
          </div>
          <div className="list-card">
            <strong>Required Documents</strong>
            <div className="muted small-text">
              {documents.length} configured requirement
              {documents.length === 1 ? "" : "s"}
            </div>
          </div>
          <div className="list-card">
            <strong>AI Packet</strong>
            <div className="muted small-text">
              {latestRun ? `${latestRun.status} · ${latestRun.model}` : "Not started"}
            </div>
          </div>
        </div>
      </aside>

      <div className="panel">
        <div className="section-heading-row">
          <div>
            <h2 className="panel-title">AIDEAL Deal Packet</h2>
            <p className="muted small-text" style={{ marginTop: 6 }}>
              {latestRun
                ? `${latestRun.provider} · ${latestRun.model} · ${latestRun.confidence ?? "pending confidence"}`
                : "Waiting for document processing."}
            </p>
          </div>
          <span className="chip chip-blue">{dealStatus}</span>
        </div>

        {!latestRun || latestRun.status === "queued" || latestRun.status === "running" ? (
          <div className="empty-state" style={{ marginTop: 20 }}>
            The deal packet is still processing.
          </div>
        ) : latestRun.status === "failed" ? (
          <div className="empty-state" style={{ marginTop: 20 }}>
            Packet generation failed: {latestRun.errorMessage ?? "Unknown error"}
          </div>
        ) : (
          <div className="review-packet-grid" style={{ marginTop: 20 }}>
            <div className="packet-summary">
              <span className="signal-label">Summary</span>
              <p>{typeof packet.summary === "string" ? packet.summary : "No summary returned."}</p>
            </div>
            <div className="packet-column">
              <span className="signal-label">Key Facts</span>
              {asStringList(packet.keyFacts).length ? (
                <ul>{asStringList(packet.keyFacts).map((item) => <li key={item}>{item}</li>)}</ul>
              ) : <p className="muted">None recorded.</p>}
            </div>
            <div className="packet-column">
              <span className="signal-label">Risks</span>
              {asStringList(packet.risks).length ? (
                <ul>{asStringList(packet.risks).map((item) => <li key={item}>{item}</li>)}</ul>
              ) : <p className="muted">None recorded.</p>}
            </div>
            <div className="packet-column">
              <span className="signal-label">Missing Information</span>
              {asStringList(packet.missingInformation).length ? (
                <ul>{asStringList(packet.missingInformation).map((item) => <li key={item}>{item}</li>)}</ul>
              ) : <p className="muted">None recorded.</p>}
            </div>
            <div className="packet-summary">
              <span className="signal-label">Recommendation</span>
              <p>{typeof packet.recommendation === "string" ? packet.recommendation : "No recommendation returned."}</p>
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="section-heading-row">
          <div>
            <h2 className="panel-title">Research Evidence</h2>
            <p className="muted small-text" style={{ marginTop: 6 }}>
              Public-source results remain provisional until an analyst verifies them.
            </p>
          </div>
          {latestResearch ? <span className="chip chip-neutral">{latestResearch.status}</span> : null}
        </div>
        {!latestResearch ? (
          <div className="empty-state" style={{ marginTop: 20 }}>
            Research has not been requested for this deal.
          </div>
        ) : latestResearch.status === "failed" ? (
          <div className="empty-state" style={{ marginTop: 20 }}>
            <p>Research failed: {latestResearch.errorMessage ?? "Unknown error"}</p>
            <form action={researchRerunAction} style={{ marginTop: 12 }}>
              <input type="hidden" name="submissionId" value={submission.id} />
              <button className="button button-review-secondary" type="submit">Retry research</button>
            </form>
          </div>
        ) : latestResearch.status !== "completed" ? (
          <div className="empty-state" style={{ marginTop: 20 }}>
            Research is {latestResearch.status}. Results will appear after collection completes.
          </div>
        ) : (
          <div className="review-panel" style={{ marginTop: 20 }}>
            <div className="section-heading-row">
              <div>
                <span className="signal-label">Research run</span>
                <p className="muted small-text" style={{ marginTop: 6 }}>
                  Each rerun creates a new report and starts a fresh source review.
                </p>
              </div>
              <form action={researchRerunAction}>
                <input type="hidden" name="submissionId" value={submission.id} />
                <button className="button button-review-secondary" type="submit">
                  Rerun research
                </button>
              </form>
            </div>
            <div className="signal">
              <span>Confidence</span>
              <strong>{latestResearch.confidence ?? "provisional"}</strong>
            </div>
            <div className="signal">
              <span>Reviewer evidence decisions</span>
              <strong>{reviewBySource.size}/{researchSources.length} reviewed</strong>
            </div>
            <p className="muted small-text">
              Confirmed {reviewCounts.confirmed} · Dismissed {reviewCounts.dismissed} · Follow-up {reviewCounts.followUp}
            </p>
            <p className="muted small-text">{latestResearch.summary ?? "Public-source results collected."}</p>
            {evidenceGroups.some(([, value]) => asEvidenceList(value).length) ? (
              <div className="stack-list" style={{ marginBottom: 16 }}>
                {evidenceGroups.map(([label, value]) => asEvidenceList(value).length ? (
                  <div className="list-card" key={label}>
                    <strong>{label}</strong>
                    <ul className="muted small-text" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                      {asEvidenceList(value).map((item, index) => (
                        <li key={`${label}-${index}`}>
                          {item.text} {item.sourceIds.length ? <span>({item.sourceIds.map((id) => sourceLabels.get(id) ?? id).join(", ")})</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null)}
              </div>
            ) : null}
            {researchSources.length ? (
              <div className="stack-list">
                {researchSources.map((source, index) => (
                  <div className="list-card" key={`${String(source.url ?? "source")}-${index}`}>
                    {(() => {
                      const sourceId = String(source.sourceId ?? `source-${index + 1}`);
                      const review = reviewBySource.get(sourceId);
                      return (
                        <>
                    <strong>{String(source.title ?? "Source")}</strong>
                    <span className="chip chip-neutral" style={{ marginLeft: 8 }}>
                      {review?.decision === "follow_up" ? "needs follow-up" : review?.decision ?? "unreviewed"}
                    </span>
                    <div className="muted small-text" style={{ marginTop: 6 }}>
                      {sourceId} · {String(source.url ?? "")}
                    </div>
                    {typeof source.snippet === "string" ? <p className="muted small-text" style={{ margin: "6px 0 0" }}>{source.snippet}</p> : null}
                    <form action={researchReviewAction} className="button-row" style={{ marginTop: 12 }}>
                      <input type="hidden" name="submissionId" value={submission.id} />
                      <input type="hidden" name="reportId" value={latestResearch.id} />
                      <input type="hidden" name="sourceId" value={sourceId} />
                      <input className="input" name="note" placeholder="Dismissal reason required" aria-label={`Reason for reviewing ${sourceId}`} />
                      <button className="button button-review-secondary" name="decision" value="confirmed" type="submit">Confirm evidence</button>
                      <button className="button button-review-secondary" name="decision" value="follow_up" type="submit">Needs follow-up</button>
                      <button className="button button-danger" name="decision" value="dismissed" type="submit">Dismiss</button>
                    </form>
                        </>
                      );
                    })()}
                  </div>
                ))}
              </div>
            ) : <div className="muted small-text">No source records returned.</div>}
          </div>
        )}
      </div>

      <div className="panel">
        <h2 className="panel-title">Reviewer Decision</h2>
        {latestResearch?.status === "completed" && researchSources.length ? (
          <div className="review-panel" style={{ marginTop: 16 }}>
            <div className="signal">
              <span>Evidence review status</span>
              <strong>{reviewBySource.size}/{researchSources.length} sources reviewed</strong>
            </div>
            {reviewCounts.followUp || reviewBySource.size < researchSources.length ? (
              <p className="muted small-text" style={{ margin: "8px 0 0" }}>
                Review outstanding or follow-up evidence before relying on the research signal in a final decision.
              </p>
            ) : (
              <p className="muted small-text" style={{ margin: "8px 0 0" }}>
                All extracted sources have a recorded reviewer decision.
              </p>
            )}
          </div>
        ) : null}
        <form action={reviewAction} className="form-stack" style={{ marginTop: 16 }}>
          <input type="hidden" name="submissionId" value={submission.id} />
          <label className="field-label" htmlFor="review-note">Decision note</label>
          <textarea className="input textarea" id="review-note" name="note" placeholder="Add context for the audit trail" />
          <div className="button-row">
            <button className="button button-primary" name="action" value="accept" type="submit">Accept</button>
            <button className="button button-review-secondary" name="action" value="request_information" type="submit">Request information</button>
            <button className="button button-review-secondary" name="action" value="manual_review" type="submit">Manual review</button>
            <button className="button button-danger" name="action" value="reject" type="submit">Reject</button>
          </div>
        </form>
      </div>

      <div className="panel">
        <div className="section-heading-row">
          <div>
            <h2 className="panel-title">SOP Evaluation</h2>
            <p className="muted small-text" style={{ marginTop: 6 }}>
              Deterministic checks from the active SOP template and available evidence.
            </p>
          </div>
          {latestEvaluation ? <span className="chip chip-blue">{latestEvaluation.rating} · {latestEvaluation.score}/100</span> : null}
        </div>
        {latestEvaluation ? (
          <div className="review-panel" style={{ marginTop: 20 }}>
            <div className="signal">
              <span>Recommendation</span>
              <strong>{latestEvaluation.recommendation ?? "Manual review"}</strong>
            </div>
            <div className="signal">
              <span>Mandatory Failures</span>
              <strong>{asStringList(latestEvaluation.mandatoryFailuresJson).length}</strong>
            </div>
            <div className="signal">
              <span>Red Flags</span>
              <strong>{asStringList(latestEvaluation.redFlagsJson).length}</strong>
            </div>
            <div className="signal">
              <span>Missing Requirements</span>
              <strong>{asStringList(latestEvaluation.missingRequirementsJson).join(", ") || "None recorded"}</strong>
            </div>
            {latestEvaluation.explanation ? <p className="muted small-text">{latestEvaluation.explanation}</p> : null}
          </div>
        ) : (
          <div className="empty-state" style={{ marginTop: 20 }}>
            No active SOP evaluation has been generated for this deal yet.
          </div>
        )}
      </div>

      <div className="panel">
        <div className="section-heading-row">
          <div>
            <h2 className="panel-title">Activity & Audit Timeline</h2>
            <p className="muted small-text" style={{ marginTop: 6 }}>
              Recorded state changes and review events for this deal.
            </p>
          </div>
        </div>
        {submission.deal?.timeline.length ? (
          <div className="timeline" style={{ marginTop: 20 }}>
            {submission.deal.timeline.map((event) => (
              <div className="timeline-item" key={event.id}>
                <div className="timeline-marker" aria-hidden="true" />
                <div className="timeline-content">
                  <div className="list-card-header">
                    <strong>{formatTimelineLabel(event.label)}</strong>
                    <span className="muted small-text">
                      {new Date(event.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {typeof event.detail === "string" && event.detail ? (
                    <p className="muted small-text" style={{ margin: "6px 0 0" }}>
                      {event.detail}
                    </p>
                  ) : null}
                  <span className="muted small-text">
                    {event.type === "status_change" ? "Status change" : "Audit event"}
                    {event.actorUserId ? ` · ${event.actorUserId}` : " · System"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state" style={{ marginTop: 20 }}>
            No activity has been recorded for this deal yet.
          </div>
        )}
      </div>

      <div className="panel">
        <h2 className="panel-title">Applicant & Company</h2>
        <div className="review-panel" style={{ marginTop: 20 }}>
          <div className="signal">
            <span>Applicant Name</span>
            <strong>{submission.applicant?.name ?? "Not available"}</strong>
          </div>
          <div className="signal">
            <span>Applicant Email</span>
            <strong>{submission.applicant?.email ?? submission.intakeSession.applicantEmail}</strong>
          </div>
          <div className="signal">
            <span>Applicant Role</span>
            <strong>{submission.applicant?.roleTitle ?? "Not provided"}</strong>
          </div>
          <div className="signal">
            <span>Authority Confirmed</span>
            <strong>{submission.applicant?.authorityConfirmed ? "Yes" : "No"}</strong>
          </div>
          <div className="signal">
            <span>Company Legal Name</span>
            <strong>{submission.company?.legalName ?? "Not provided"}</strong>
          </div>
          <div className="signal">
            <span>Jurisdiction</span>
            <strong>{submission.company?.jurisdiction ?? "Not provided"}</strong>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2 className="panel-title">Submitted Answers</h2>
        <div className="review-panel" style={{ marginTop: 20 }}>
          {answers.length === 0 ? (
            <div className="muted">No structured answers captured yet.</div>
          ) : (
            answers.map(([key, value]) => (
              <div className="signal" key={key}>
                <span>{key}</span>
                <strong>{String(value ?? "") || "Not provided"}</strong>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="panel">
        <h2 className="panel-title">Configured Document Requirements</h2>
        <div className="stack-list" style={{ marginTop: 20 }}>
          {documents.length === 0 ? (
            <div className="muted">No document requirements configured.</div>
          ) : (
            documents.map((document, index) => {
              const record =
                document && typeof document === "object" && !Array.isArray(document)
                  ? (document as Record<string, unknown>)
                  : {};

              return (
                <div className="list-card" key={`${record.key ?? "document"}-${index}`}>
                  <strong>{String(record.label ?? record.key ?? `Document ${index + 1}`)}</strong>
                  <div className="muted small-text">
                    Required: {record.required ? "Yes" : "No"}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="panel">
        <h2 className="panel-title">Uploaded Documents</h2>
        <div className="stack-list" style={{ marginTop: 20 }}>
          {submission.deal?.documents?.length ? (
            submission.deal.documents.map((document) => (
              <div className="list-card" key={document.id}>
                <strong>{document.originalFilename}</strong>
                <div className="muted small-text" style={{ marginTop: 6 }}>
                  {document.documentType} · {document.status}
                </div>
                <div className="muted small-text" style={{ marginTop: 6 }}>
                  {Math.ceil(document.sizeBytes / 1024)} KB ·{" "}
                  {new Date(document.uploadedAt).toLocaleString()}
                </div>
              </div>
            ))
          ) : (
            <div className="muted">No uploaded documents are linked to this deal yet.</div>
          )}
        </div>
      </div>
    </section>
  );
}
