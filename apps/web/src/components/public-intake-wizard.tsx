"use client";

import type { ChangeEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

type FormField = {
  key?: string;
  label?: string;
  type?: string;
  required?: boolean;
  options?: Array<{ label?: string; value?: string }>;
};

type FormSection = {
  id?: string;
  title?: string;
  fields?: FormField[];
};

type DocumentRequirement = {
  key?: string;
  label?: string;
  required?: boolean;
};

type UploadedDraftDocument = {
  documentType: string;
  originalFilename: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
};

type PublicIntakeWizardProps = {
  initialAnswers: Record<string, unknown>;
  initialApplicantEmail: string;
  initialStatus: "draft" | "submitted" | "expired";
  documentRequirements: DocumentRequirement[];
  organizationName: string;
  formName: string;
  publicSlug: string;
  sessionToken: string;
  sections: FormSection[];
};

const declarationKey = "__declarationAccepted";
const documentsKey = "__documents";

function normalizeAnswers(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, fieldValue]) =>
          key !== documentsKey &&
          (typeof fieldValue === "string" ||
            typeof fieldValue === "number" ||
            typeof fieldValue === "boolean" ||
            fieldValue == null),
      )
      .map(([key, fieldValue]) => [key, String(fieldValue ?? "")]),
  );
}

function normalizeDocuments(value: Record<string, unknown>): UploadedDraftDocument[] {
  const rawDocuments = value[documentsKey];

  if (!Array.isArray(rawDocuments)) {
    return [];
  }

  return rawDocuments.flatMap((document) => {
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      return [];
    }

    const record = document as Record<string, unknown>;

    if (
      typeof record.documentType !== "string" ||
      typeof record.originalFilename !== "string" ||
      typeof record.storageKey !== "string" ||
      typeof record.mimeType !== "string" ||
      typeof record.sizeBytes !== "number" ||
      typeof record.uploadedAt !== "string"
    ) {
      return [];
    }

    return [
      {
        documentType: record.documentType,
        originalFilename: record.originalFilename,
        storageKey: record.storageKey,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        uploadedAt: record.uploadedAt,
      },
    ];
  });
}

export function PublicIntakeWizard({
  initialAnswers,
  initialApplicantEmail,
  initialStatus,
  documentRequirements,
  organizationName,
  formName,
  publicSlug,
  sessionToken,
  sections,
}: PublicIntakeWizardProps) {
  const [applicantEmail, setApplicantEmail] = useState(initialApplicantEmail);
  const [answers, setAnswers] = useState<Record<string, string>>(
    normalizeAnswers(initialAnswers),
  );
  const [uploadedDocuments, setUploadedDocuments] = useState<UploadedDraftDocument[]>(
    normalizeDocuments(initialAnswers),
  );
  const [currentStep, setCurrentStep] = useState(0);
  const [sessionStatus, setSessionStatus] = useState(initialStatus);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadingDocumentType, setUploadingDocumentType] = useState<string | null>(
    null,
  );
  const [saveMessage, setSaveMessage] = useState(
    initialStatus === "submitted" ? "Submission complete" : "Not saved yet",
  );
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const steps = useMemo(
    () => [
      ...sections,
      ...(documentRequirements.length
        ? [{ id: "documents", title: "Supporting Documents", fields: [] }]
        : []),
      { id: "declarations", title: "Declarations", fields: [] },
      { id: "review", title: "Review & Submit", fields: [] },
    ],
    [documentRequirements, sections],
  );

  const current = steps[currentStep] ?? {
    id: "review",
    title: "Review & Submit",
    fields: [],
  };
  const isReviewStep = current.id === "review";
  const isDeclarationStep = current.id === "declarations";
  const isDocumentsStep = current.id === "documents";
  const isReadOnly = sessionStatus === "submitted";

  const resumeUrl = `/forms/${publicSlug}/session/${sessionToken}`;

  useEffect(() => {
    if (isReadOnly) {
      return;
    }

    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
    }

    autosaveTimer.current = setTimeout(() => {
      void saveSession();
    }, 900);

    return () => {
      if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current);
      }
    };
  }, [answers, applicantEmail, uploadedDocuments, isReadOnly]);

  function buildAnswersPayload() {
    return {
      ...answers,
      applicantEmail,
      [documentsKey]: uploadedDocuments,
    };
  }

  async function saveSession() {
    if (isReadOnly) {
      return true;
    }

    setIsSaving(true);

    const response = await fetch(`/api/public/intake-sessions/${sessionToken}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        applicantEmail,
        answersJson: buildAnswersPayload(),
      }),
    });

    setIsSaving(false);

    if (response.ok) {
      setSaveMessage(`Saved at ${new Date().toLocaleTimeString()}`);
      return true;
    }

    setSaveMessage("Save failed");
    return false;
  }

  function validateStep() {
    if (isDeclarationStep) {
      return answers[declarationKey] === "true";
    }

    if (isDocumentsStep) {
      return documentRequirements.every((requirement) => {
        if (!requirement.required || !requirement.key) {
          return true;
        }

        return uploadedDocuments.some(
          (document) => document.documentType === requirement.key,
        );
      });
    }

    if (isReviewStep) {
      return true;
    }

    return (current.fields ?? []).every((field) => {
      if (!field.required) {
        return true;
      }

      if (!field.key) {
        return true;
      }

      return Boolean(answers[field.key]?.trim());
    });
  }

  async function handleNext() {
    if (isReadOnly) {
      return;
    }

    if (!validateStep()) {
      setSubmitMessage("Complete all required fields before continuing.");
      return;
    }

    setSubmitMessage(null);
    await saveSession();
    setCurrentStep((step) => Math.min(step + 1, steps.length - 1));
  }

  async function handleBack() {
    if (isReadOnly) {
      return;
    }

    setSubmitMessage(null);
    await saveSession();
    setCurrentStep((step) => Math.max(step - 1, 0));
  }

  async function handleSubmit() {
    if (isReadOnly) {
      return;
    }

    if (answers[declarationKey] !== "true") {
      setSubmitMessage("You must accept the declaration before submitting.");
      return;
    }

    setIsSubmitting(true);
    setSubmitMessage(null);

    const response = await fetch(
      `/api/public/intake-sessions/${sessionToken}/submit`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          applicantEmail,
          answersJson: buildAnswersPayload(),
        }),
      },
    );

    setIsSubmitting(false);

    if (!response.ok) {
      setSubmitMessage("Submission failed. Please retry.");
      return;
    }

    const payload = (await response.json()) as {
      submission: { id: string };
    };

    setSubmitMessage(
      `Submission received. Reference ${payload.submission.id}. You can keep this page for your records.`,
    );
    setSessionStatus("submitted");
    setSaveMessage("Submission complete");
    setCurrentStep(steps.length - 1);
  }

  async function handleDocumentUpload(
    requirement: DocumentRequirement,
    file: File | null,
  ) {
    if (!file || !requirement.key || isReadOnly) {
      return;
    }

    setUploadingDocumentType(requirement.key);
    setSubmitMessage(null);

    const presignResponse = await fetch(
      `/api/public/intake-sessions/${sessionToken}/uploads/presign`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          documentType: requirement.key,
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      },
    );

    if (!presignResponse.ok) {
      const payload = (await presignResponse.json().catch(() => null)) as
        | { message?: string }
        | null;
      setSubmitMessage(payload?.message ?? "Unable to prepare document upload.");
      setUploadingDocumentType(null);
      return;
    }

    const presignPayload = (await presignResponse.json()) as {
      uploadUrl: string;
      storageKey: string;
    };

    const uploadResponse = await fetch(presignPayload.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": file.type,
      },
      body: file,
    });

    if (!uploadResponse.ok) {
      setSubmitMessage("Document upload failed. Retry the file upload.");
      setUploadingDocumentType(null);
      return;
    }

    const confirmResponse = await fetch(
      `/api/public/intake-sessions/${sessionToken}/uploads/confirm`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          documentType: requirement.key,
          originalFilename: file.name,
          storageKey: presignPayload.storageKey,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      },
    );

    if (!confirmResponse.ok) {
      const payload = (await confirmResponse.json().catch(() => null)) as
        | { message?: string }
        | null;
      setSubmitMessage(payload?.message ?? "Document confirmation failed.");
      setUploadingDocumentType(null);
      return;
    }

    const confirmPayload = (await confirmResponse.json()) as {
      documents: UploadedDraftDocument[];
    };

    setUploadedDocuments(confirmPayload.documents);
    setUploadingDocumentType(null);
    setSaveMessage(`Saved at ${new Date().toLocaleTimeString()}`);
  }

  function renderField(field: FormField) {
    const key = field.key ?? "";
    const label = field.label ?? key;
    const value = answers[key] ?? "";

    if (field.type === "textarea") {
      return (
        <label className="field" key={key}>
          <span className="field-label">
            {label}
            {field.required ? " *" : ""}
          </span>
          <textarea
            className="textarea"
            disabled={isReadOnly}
            rows={5}
            value={value}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
              // Read before updating: React clears currentTarget once the
              // handler returns, and the updater can run after that.
              const nextValue = event.currentTarget.value;
              setAnswers((currentAnswers) => ({
                ...currentAnswers,
                [key]: nextValue,
              }));
            }}
          />
        </label>
      );
    }

    if (field.type === "select" && Array.isArray(field.options)) {
      return (
        <label className="field" key={key}>
          <span className="field-label">
            {label}
            {field.required ? " *" : ""}
          </span>
          <select
            className="input"
            disabled={isReadOnly}
            value={value}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              const nextValue = event.currentTarget.value;
              setAnswers((currentAnswers) => ({
                ...currentAnswers,
                [key]: nextValue,
              }));
            }}
          >
            <option value="">Select</option>
            {field.options.map((option, index) => (
              <option
                key={`${option.value ?? option.label ?? "option"}-${index}`}
                value={option.value ?? option.label ?? ""}
              >
                {option.label ?? option.value}
              </option>
            ))}
          </select>
        </label>
      );
    }

    return (
      <label className="field" key={key}>
        <span className="field-label">
          {label}
          {field.required ? " *" : ""}
        </span>
        <input
          className="input"
          disabled={isReadOnly}
          type={field.type === "number" ? "number" : field.type === "email" ? "email" : "text"}
          value={value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const nextValue = event.currentTarget.value;
            setAnswers((currentAnswers) => ({
              ...currentAnswers,
              [key]: nextValue,
            }));
          }}
        />
      </label>
    );
  }

  return (
    <div className="wizard-shell">
      <aside className="wizard-sidebar">
        <div className="public-form-badge">{organizationName}</div>
        <h1 className="wizard-title">{formName}</h1>
        <div className="wizard-step-list">
          {steps.map((step, index) => (
            <button
              className={`wizard-step ${index === currentStep ? "wizard-step-active" : ""}`}
              key={step.id ?? step.title ?? index}
              disabled={isReadOnly}
              onClick={() => setCurrentStep(index)}
              type="button"
            >
              <span>{index + 1}</span>
              <strong>{step.title ?? `Step ${index + 1}`}</strong>
            </button>
          ))}
        </div>
        <div className="wizard-sidebar-meta">
          <div className="muted small-text">{isSaving ? "Saving..." : saveMessage}</div>
          <div className="muted small-text">
            Resume link: <span className="code-inline">{resumeUrl}</span>
          </div>
        </div>
      </aside>

      <section className="wizard-panel">
        <header className="wizard-header">
          <div>
            <h2 className="panel-title">{current.title ?? "Step"}</h2>
            <p className="muted" style={{ marginTop: 6 }}>
              Progress {currentStep + 1} of {steps.length}
            </p>
          </div>
        </header>

        <div className="form-stack">
          <label className="field">
            <span className="field-label">Applicant Email *</span>
            <input
              className="input"
              disabled={isReadOnly}
              type="email"
              value={applicantEmail}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setApplicantEmail(
                  (event.currentTarget as HTMLInputElement).value,
                )
              }
            />
          </label>

          {!isDeclarationStep && !isReviewStep
            ? (current.fields ?? []).map((field) => renderField(field))
            : null}

          {isDeclarationStep ? (
            <label className="checkbox-row">
              <input
                checked={answers[declarationKey] === "true"}
                disabled={isReadOnly}
                type="checkbox"
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  const nextChecked = event.currentTarget.checked;
                  setAnswers((currentAnswers) => ({
                    ...currentAnswers,
                    [declarationKey]: String(nextChecked),
                  }));
                }}
              />
              <span>
                I confirm that the information submitted is accurate and that I am
                authorized to submit this request.
              </span>
            </label>
          ) : null}

          {isDocumentsStep ? (
            <div className="stack-list">
              {documentRequirements.map((requirement, index) => {
                const uploaded = requirement.key
                  ? uploadedDocuments.find(
                      (document) => document.documentType === requirement.key,
                    )
                  : null;

                return (
                  <div
                    className="list-card"
                    key={`${requirement.key ?? "document"}-${index}`}
                  >
                    <div className="signal">
                      <span>
                        {requirement.label ?? requirement.key ?? `Document ${index + 1}`}
                      </span>
                      <strong>{uploaded ? "Uploaded" : "Pending"}</strong>
                    </div>
                    <div className="muted small-text" style={{ marginTop: 6 }}>
                      Required: {requirement.required ? "Yes" : "No"}
                    </div>
                    {uploaded ? (
                      <div className="muted small-text" style={{ marginTop: 6 }}>
                        {uploaded.originalFilename} ·{" "}
                        {Math.ceil(uploaded.sizeBytes / 1024)} KB
                      </div>
                    ) : null}
                    {!isReadOnly ? (
                      <label className="field" style={{ marginTop: 12 }}>
                        <span className="field-label">Upload file</span>
                        <input
                          className="input"
                          disabled={uploadingDocumentType === requirement.key}
                          type="file"
                          onChange={(event: ChangeEvent<HTMLInputElement>) =>
                            void handleDocumentUpload(
                              requirement,
                              event.currentTarget.files?.[0] ?? null,
                            )
                          }
                        />
                      </label>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {isReviewStep ? (
            <div className="review-panel">
              {isReadOnly ? (
                <div className="inline-alert inline-alert-success">
                  This request has already been submitted. The information below is read-only.
                </div>
              ) : null}
              <div className="signal">
                <span>Applicant email</span>
                <strong>{applicantEmail}</strong>
              </div>
              {Object.entries(answers)
                .filter(([key]) => key !== declarationKey)
                .map(([key, value]) => (
                  <div className="signal" key={key}>
                    <span>{key}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              {uploadedDocuments.map((document) => (
                <div className="signal" key={document.storageKey}>
                  <span>{document.documentType}</span>
                  <strong>{document.originalFilename}</strong>
                </div>
              ))}
            </div>
          ) : null}

          {submitMessage ? <div className="inline-alert">{submitMessage}</div> : null}

          <div className="wizard-actions">
            <button
              className="button button-secondary-dark"
              disabled={isReadOnly || currentStep === 0}
              onClick={handleBack}
              type="button"
            >
              Back
            </button>

            {currentStep < steps.length - 1 ? (
              <button
                className="button button-primary"
                disabled={isReadOnly}
                onClick={handleNext}
                type="button"
              >
                Next
              </button>
            ) : (
              <button
                className="button button-primary"
                disabled={isReadOnly || isSubmitting}
                onClick={handleSubmit}
                type="button"
              >
                {isSubmitting ? "Submitting..." : "Submit request"}
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
