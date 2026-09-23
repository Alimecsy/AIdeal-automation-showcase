import Link from "next/link";
import { apiFetch } from "@/lib/server-api";

type DocumentRecord = {
  id: string;
  documentType: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  uploadedAt: string;
  deal: {
    id: string;
    title: string;
    intakeSubmissionId: string | null;
  } | null;
};

async function getDocuments() {
  const response = await apiFetch("/documents");

  if (!response.ok) {
    throw new Error(`Failed to load documents: ${response.status}`);
  }

  return response.json() as Promise<DocumentRecord[]>;
}

export default async function DocumentsPage() {
  const documents = await getDocuments();

  return (
    <section>
      <h1 className="page-title">Documents</h1>
      <p className="page-subtitle">
        Track uploaded files, extraction status, and evidence references.
      </p>

      <div className="stack-list" style={{ marginTop: 24 }}>
        {documents.length === 0 ? (
          <div className="panel">
            <h2 className="panel-title">No document records yet</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Uploaded applicant files will appear here once storage is configured
              and submissions include supporting documents.
            </p>
          </div>
        ) : (
          documents.map((document) => (
            <div className="list-card" key={document.id}>
              <div className="list-card-header">
                <strong>{document.originalFilename}</strong>
                <span className="muted small-text">{document.status}</span>
              </div>
              <div className="list-card-meta">
                {document.documentType} · {document.mimeType}
              </div>
              <div className="list-card-meta">
                {Math.ceil(document.sizeBytes / 1024)} KB ·{" "}
                {new Date(document.uploadedAt).toLocaleString()}
              </div>
              {document.deal ? (
                <div className="list-card-meta">
                  Linked deal:{" "}
                  {document.deal.intakeSubmissionId ? (
                    <Link href={`/app/deals/${document.deal.intakeSubmissionId}`}>
                      {document.deal.title}
                    </Link>
                  ) : (
                    document.deal.title
                  )}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
