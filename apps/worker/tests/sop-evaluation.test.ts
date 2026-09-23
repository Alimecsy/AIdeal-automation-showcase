import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateSop } from "../src/sop-evaluation";

const rules = {
  scoringWeights: { documentCompleteness: 60, companyVerification: 40 },
  mandatoryRules: { requiredDocuments: ["proof_of_funds", "company_registration"], mustHaveCompanyName: true },
  redFlagRules: { sanctionsCheck: true, adverseMedia: true },
  recommendationRules: { missingProofOfFunds: "request_proof_of_funds", proceed: "proceed" },
};

test("SOP evaluation records missing evidence without inventing positive facts", () => {
  const result = evaluateSop({
    ...rules,
    answers: { companyName: "Acme" },
    companyName: "Acme",
    documents: [{ documentType: "company_registration", status: "analyzed" }],
    research: null,
  });

  assert.equal(result.score, 40);
  assert.equal(result.rating, "D");
  assert.deepEqual(result.mandatoryFailures, ["proof_of_funds"]);
  assert.deepEqual(result.redFlags, []);
  assert.equal(result.recommendation, "request_proof_of_funds");
});

test("SOP evaluation carries explicit evidence-backed red flags into the rating", () => {
  const result = evaluateSop({
    ...rules,
    answers: { companyName: "Acme", sanctionsCheck: true },
    companyName: "Acme",
    documents: [
      { documentType: "proof_of_funds", status: "analyzed" },
      { documentType: "company_registration", status: "analyzed" },
    ],
    research: null,
  });

  assert.equal(result.score, 100);
  assert.equal(result.rating, "Reject");
  assert.deepEqual(result.redFlags, ["sanctionsCheck"]);
  assert.equal(result.recommendation, "manual_review");
});

test("SOP evaluation uses confirmed research red flags and follow-up state", () => {
  const confirmed = evaluateSop({
    ...rules,
    answers: { companyName: "Acme" },
    companyName: "Acme",
    documents: [
      { documentType: "proof_of_funds", status: "analyzed" },
      { documentType: "company_registration", status: "analyzed" },
    ],
    research: { confidence: "provisional:low", redFlags: [], confirmedRedFlagEvidence: true },
  });
  assert.equal(confirmed.rating, "Reject");
  assert.deepEqual(confirmed.redFlags, ["research_evidence"]);

  const followUp = evaluateSop({
    ...rules,
    answers: { companyName: "Acme" },
    companyName: "Acme",
    documents: [
      { documentType: "proof_of_funds", status: "analyzed" },
      { documentType: "company_registration", status: "analyzed" },
    ],
    research: { confidence: "provisional:low", redFlags: [], followUpEvidence: true },
  });
  assert.equal(followUp.recommendation, "manual_review");
  assert.match(followUp.explanation, /follow-up/);
});
