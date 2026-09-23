/**
 * Runs the real SOP evaluator against the synthetic sample inputs in this
 * folder and prints the result. Nothing is mocked and no external service is
 * contacted: this is the same deterministic function the worker calls.
 *
 *   pnpm --filter @aideal/worker exec tsx docs/portfolio/samples/evaluate-sample.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateSop } from "../../../apps/worker/src/sop-evaluation";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => JSON.parse(readFileSync(join(here, name), "utf8"));

const sop = read("sop-template.json");
const answers = read("intake-answers.json");

const common = {
  scoringWeights: sop.scoringWeights,
  mandatoryRules: sop.mandatoryRules,
  redFlagRules: sop.redFlagRules,
  recommendationRules: sop.recommendationRules,
  answers,
  companyName: answers.legalName as string,
  research: { confidence: "provisional:medium", redFlags: [] },
};

const result = {
  // Only the company registration document was supplied.
  missingProofOfFunds: evaluateSop({
    ...common,
    documents: [{ documentType: "company_registration", status: "analyzed" }],
  }),
  // The applicant later supplies the outstanding document.
  allDocumentsSupplied: evaluateSop({
    ...common,
    documents: [
      { documentType: "company_registration", status: "analyzed" },
      { documentType: "proof_of_funds", status: "analyzed" },
    ],
  }),
};

console.log(JSON.stringify(result, null, 2));
