import assert from "node:assert/strict";
import test from "node:test";

import {
  behavioralPracticeScenariosSchema,
  behavioralPracticeScenariosFingerprint,
  projectBehavioralPracticeScenarios,
  renderBehavioralPracticeScenariosHtml,
  renderBehavioralPracticeScenariosMarkdown,
} from "../db/behavioral-practice-scenario.ts";

const scenario = (overrides = {}) => ({
  schemaVersion: 1,
  scenarioId: "retry-recovery-scenario",
  revision: 1,
  mode: "hypothetical",
  label: "Hypothetical practice scenario — not the owner's experience",
  purpose: "Practice a reliability incident with a constrained recovery path.",
  canon: {
    realSourceFacts: [{
      statement: "The project uses stable operation identities.",
      acceptedEvidenceIds: ["evidence-retry-boundary"],
    }],
    inventedPremises: ["A regional queue is delayed."],
    inventedActions: ["I introduce a bounded replay worker."],
    inventedResults: ["Recovery time falls below ten minutes."],
  },
  answer: "I bounded replay by stable operation identity and verified recovery receipts.",
  challengeMap: [{ challenge: "Why not retry inline?", response: "Inline retries extend user-visible latency." }],
  likelyFollowUps: ["How did you test ambiguous commits?"],
  limitations: ["The incident and result are invented for practice."],
  visibility: "owner_private",
  ...overrides,
});

test("typed scenarios preserve canon, provenance references, and conspicuous labels", () => {
  const parsed = behavioralPracticeScenariosSchema.parse([scenario()]);
  assert.equal(parsed[0].scenarioId, "retry-recovery-scenario");
  assert.equal(parsed[0].canon.realSourceFacts[0].acceptedEvidenceIds[0], "evidence-retry-boundary");
  assert.equal(parsed[0].visibility, "owner_private");
  assert.throws(() => behavioralPracticeScenariosSchema.parse([scenario({ label: "Practice answer" })]));
  assert.throws(() => behavioralPracticeScenariosSchema.parse([scenario(), scenario()]));
});

test("fictional scenarios require the exact fictional disclaimer", () => {
  assert.doesNotThrow(() => behavioralPracticeScenariosSchema.parse([scenario({
    mode: "fictional",
    label: "Fictional practice scenario — not the owner's experience",
  })]));
  assert.throws(() => behavioralPracticeScenariosSchema.parse([scenario({ mode: "fictional" })]));
});

test("Markdown and local HTML preserve the same authoritative scenario content", () => {
  const projection = projectBehavioralPracticeScenarios({
    questionId: "behavioral-reliability-1",
    solutionProfileRevision: 3,
    scenarios: [scenario()],
  });
  const markdown = renderBehavioralPracticeScenariosMarkdown(projection);
  const html = renderBehavioralPracticeScenariosHtml(projection);
  const renderedHtmlText = html.replaceAll("&#039;", "'");
  for (const exact of [
    scenario().label,
    scenario().purpose,
    scenario().answer,
    "behavioral-reliability-1 · revision 3",
    "evidence references: evidence-retry-boundary",
    scenario().canon.inventedResults[0],
    scenario().limitations[0],
  ]) {
    assert.match(markdown, new RegExp(exact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(renderedHtmlText, new RegExp(exact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal(projection.solutionProfile.revision, 3);
});

test("scenario-only changes alter the revision fingerprint used by Solution Profiles", () => {
  assert.notEqual(
    behavioralPracticeScenariosFingerprint([scenario()]),
    behavioralPracticeScenariosFingerprint([scenario({ revision: 2, answer: "A revised practice answer." })]),
  );
});
