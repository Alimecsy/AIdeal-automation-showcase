import type { Prisma } from "@aideal/db";

type JsonRecord = Record<string, unknown>;

type EvaluationInput = {
  scoringWeights: unknown;
  mandatoryRules: unknown;
  redFlagRules: unknown;
  recommendationRules: unknown;
  answers: unknown;
  companyName: string | null;
  documents: Array<{ documentType: string; status: string }>;
  research: {
    confidence: string | null;
    redFlags: unknown;
    confirmedRedFlagEvidence?: boolean;
    followUpEvidence?: boolean;
  } | null;
};

export type SopEvaluationResult = {
  score: number;
  rating: string;
  categoryScores: JsonRecord;
  mandatoryFailures: string[];
  redFlags: string[];
  missingRequirements: string[];
  recommendation: string;
  explanation: string;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function asStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function hasEvidence(value: unknown) {
  return value === true || (typeof value === "string" && value.trim().length > 0);
}

export function evaluateSop(input: EvaluationInput): SopEvaluationResult {
  const weights = asRecord(input.scoringWeights);
  const mandatory = asRecord(input.mandatoryRules);
  const redFlagRules = asRecord(input.redFlagRules);
  const recommendations = asRecord(input.recommendationRules);
  const answers = asRecord(input.answers);
  const availableDocuments = new Set(
    input.documents
      .filter((document) => document.status !== "failed")
      .map((document) => document.documentType),
  );
  const requiredDocuments = asStringList(mandatory.requiredDocuments);
  const missingDocuments = requiredDocuments.filter((document) => !availableDocuments.has(document));
  const missingRequirements = [...missingDocuments];
  const mandatoryFailures = [...missingDocuments];

  if (mandatory.mustHaveCompanyName && !hasEvidence(input.companyName ?? answers.companyName ?? answers.legalName)) {
    mandatoryFailures.push("company_name");
    missingRequirements.push("company_name");
  }

  const redFlags = Object.keys(redFlagRules).filter((key) => {
    if (redFlagRules[key] !== true) return false;
    if (answers[key] === true) return true;
    const researchFlags = asStringList(input.research?.redFlags);
    return researchFlags.includes(key);
  });
  if (input.research?.confirmedRedFlagEvidence) redFlags.push("research_evidence");

  const categoryScores: JsonRecord = {};
  let score = 0;
  const documentWeight = asNumber(weights.documentCompleteness);
  if (documentWeight > 0) {
    const earned = missingDocuments.length === 0 ? documentWeight : 0;
    categoryScores.documentCompleteness = { earned, weight: documentWeight, status: missingDocuments.length === 0 ? "met" : "missing" };
    score += earned;
  }

  const companyWeight = asNumber(weights.companyVerification);
  if (companyWeight > 0) {
    const companyPresent = hasEvidence(input.companyName ?? answers.companyName ?? answers.legalName);
    const earned = companyPresent ? companyWeight : 0;
    categoryScores.companyVerification = { earned, weight: companyWeight, status: companyPresent ? "met" : "missing" };
    score += earned;
  }

  for (const [key, weightValue] of Object.entries(weights)) {
    if (key === "documentCompleteness" || key === "companyVerification") continue;
    const weight = asNumber(weightValue);
    if (!weight) continue;
    const observed = hasEvidence(answers[key]);
    categoryScores[key] = { earned: observed ? weight : 0, weight, status: observed ? "met" : "not_demonstrated" };
    if (observed) score += weight;
  }

  const roundedScore = Math.max(0, Math.min(100, Math.round(score)));
  const rating = redFlags.length > 0
    ? "Reject"
    : mandatoryFailures.length > 0
      ? "D"
      : roundedScore >= 80
        ? "A"
        : roundedScore >= 60
          ? "B"
          : roundedScore >= 40
            ? "C"
            : "D";

  const missingKey = missingDocuments.includes("proof_of_funds")
    ? "missingProofOfFunds"
    : missingRequirements.length > 0
      ? "missingRequirements"
      : null;
  const recommendationRule = missingKey ? recommendations[missingKey] : undefined;
  const recommendation = input.research?.followUpEvidence
    ? "manual_review"
    : typeof recommendationRule === "string"
    ? recommendationRule
    : redFlags.length > 0
      ? "manual_review"
      : mandatoryFailures.length > 0
        ? "request_missing_information"
        : typeof recommendations.proceed === "string"
          ? recommendations.proceed
          : "manual_review";

  const explanation = input.research?.followUpEvidence
    ? "Research evidence requires follow-up before a final recommendation."
    : redFlags.length > 0
    ? `Red flags require review: ${redFlags.join(", ")}.`
    : mandatoryFailures.length > 0
      ? `Mandatory requirements are not satisfied: ${mandatoryFailures.join(", ")}.`
      : `Evaluation is based on ${Object.keys(categoryScores).length} configured scoring categories.`;

  return {
    score: roundedScore,
    rating,
    categoryScores,
    mandatoryFailures,
    redFlags,
    missingRequirements,
    recommendation,
    explanation,
  };
}

export function toEvaluationJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}
