# Synthetic sample data

Everything in this folder is invented for demonstration. There is no real applicant, company, customer, or client data here, and no value in these files corresponds to anything in a real environment.

| File | What it is |
| --- | --- |
| [`sop-template.json`](sop-template.json) | A sample organization's SOP configuration: document requirements, scoring weights, mandatory rules, red-flag rules, recommendation rules. This is per-organization configuration, not code. |
| [`intake-answers.json`](intake-answers.json) | A sample public intake submission for a fictional company, in the shape the finalizer reads. |
| [`evaluate-sample.ts`](evaluate-sample.ts) | Runs the real `evaluateSop` function from `apps/worker/src/sop-evaluation.ts` against the two files above. Nothing is mocked and no network call is made. |
| [`expected-sop-evaluation.json`](expected-sop-evaluation.json) | The recorded output of that script. |

Reproduce it:

```bash
pnpm demo:sop
```

The output should match `expected-sop-evaluation.json` exactly. It scores the same applicant twice — once with a required document missing, once with it supplied — to show that the score, the rating, and the recommendation follow from the configured rules rather than from a model.
