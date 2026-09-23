import assert from "node:assert/strict";
import { test } from "node:test";
import { assignResearchSourceIds, normalizeResearchSources, parseResearchSynthesis } from "../src/research";

test("research source normalization keeps URLs and bounds snippets", () => {
  const sources = normalizeResearchSources([
    { title: "Company registry", url: "https://example.test/registry", content: "x".repeat(2_000) },
    { title: "Invalid result", content: "missing url" },
  ]);

  assert.equal(sources.length, 1);
  assert.equal(sources[0]?.url, "https://example.test/registry");
  assert.equal(sources[0]?.snippet.length, 1_000);
});

test("research evidence receives stable source IDs and validates citations", () => {
  const sources = assignResearchSourceIds([
    { title: "Registry", url: "https://example.test/registry", snippet: "Registered in 2024" },
    { title: "News", url: "https://example.test/news", snippet: "A report" },
  ]);

  assert.deepEqual(sources.map((source) => source.sourceId), ["source-1", "source-2"]);
  const synthesis = parseResearchSynthesis(JSON.stringify({
    summary: "Two provisional signals require review.",
    verifiedFacts: [{ text: "The registry states the company was registered in 2024.", sourceIds: ["source-1"] }],
    unverifiedClaims: [{ text: "A news report makes an unverified allegation.", sourceIds: ["source-2"] }],
    inconsistencies: [],
    redFlags: [],
    confidence: "low",
  }), sources);

  assert.equal(synthesis.verifiedFacts[0]?.status, "provisional");
  assert.deepEqual(synthesis.unverifiedClaims[0]?.sourceIds, ["source-2"]);
  assert.throws(() => parseResearchSynthesis(JSON.stringify({
    summary: "Invalid citation",
    verifiedFacts: [{ text: "Unsupported", sourceIds: ["source-99"] }],
    unverifiedClaims: [], inconsistencies: [], redFlags: [], confidence: "low",
  }), sources), /valid sourceIds/);
});
