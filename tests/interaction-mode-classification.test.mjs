import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyInteractionModePractice,
  interactionModeClassificationInputSchema,
} from "../db/interaction-mode-classification.ts";
import {
  interactionModeClassificationLabel,
  isRecordedInteractionMode,
  matchesInteractionModeFilter,
} from "../app/interaction-mode-view.ts";

const transition = (toInteractionModeId, occurredAt, toRevision) => ({
  toInteractionModeId,
  occurredAt,
  toRevision,
});

test("active-timer classification keeps the 60/40 boundary deterministic", () => {
  const base = {
    registryModeIds: ["interviewer", "mentor", "grill"],
    turns: [],
    evidence: { schemaVersion: 1, provenance: "recorded", materialSpecialistTurnIds: [], assistanceEvents: [] },
  };
  const sixty = classifyInteractionModePractice({
    ...base,
    transitions: [transition("interviewer", 0, 1), transition("mentor", 60_000, 2)],
    timerIntervals: [{ startedAt: 0, endedAt: 100_000 }],
  });
  assert.equal(sixty.primaryPracticeModeId, "interviewer");
  assert.deepEqual(sixty.modeShares.map((share) => [share.interactionModeId, share.basisPoints]), [
    ["interviewer", 6000],
    ["mentor", 4000],
  ]);

  const fiftyNine = classifyInteractionModePractice({
    ...base,
    transitions: [transition("interviewer", 0, 1), transition("mentor", 59_000, 2)],
    timerIntervals: [{ startedAt: 0, endedAt: 100_000 }],
  });
  assert.equal(fiftyNine.primaryPracticeModeId, "mixed");
});

test("material-turn fallback excludes review turns by exact identity", () => {
  const result = classifyInteractionModePractice({
    registryModeIds: ["interviewer", "mentor", "grill"],
    transitions: [transition("interviewer", 0, 1), transition("mentor", 3_000, 2)],
    timerIntervals: [],
    turns: [
      { turnId: "practice-1", speaker: "specialist", occurredAt: 1_000 },
      { turnId: "practice-2", speaker: "specialist", occurredAt: 2_000 },
      { turnId: "review-1", speaker: "specialist", occurredAt: 4_000 },
    ],
    evidence: {
      schemaVersion: 1,
      provenance: "recorded",
      materialSpecialistTurnIds: ["practice-1", "practice-2"],
      assistanceEvents: [],
    },
  });
  assert.equal(result.method, "material_specialist_turn_share");
  assert.equal(result.primaryPracticeModeId, "interviewer");
  assert.equal(result.hadMentorAssistance, false);
});

test("assistance remains separate from the primary practice mode", () => {
  const result = classifyInteractionModePractice({
    registryModeIds: ["interviewer", "mentor", "grill"],
    transitions: [transition("interviewer", 0, 1), transition("mentor", 80_000, 2)],
    timerIntervals: [{ startedAt: 0, endedAt: 100_000 }],
    turns: [{ turnId: "hint-1", speaker: "specialist", occurredAt: 85_000 }],
    evidence: {
      schemaVersion: 1,
      provenance: "recorded",
      materialSpecialistTurnIds: ["hint-1"],
      assistanceEvents: [{ turnId: "hint-1", rung: "scaffold" }],
    },
  });
  assert.equal(result.primaryPracticeModeId, "interviewer");
  assert.equal(result.hadMentorAssistance, true);
  assert.equal(result.highestHintRung, "scaffold");
});

test("one-turn override uses material turns and leaves the durable timeline unchanged", () => {
  const result = classifyInteractionModePractice({
    registryModeIds: ["interviewer", "mentor", "grill"],
    transitions: [transition("interviewer", 0, 1)],
    timerIntervals: [{ startedAt: 0, endedAt: 100_000 }],
    turns: [
      { turnId: "answer-1", speaker: "specialist", occurredAt: 10_000 },
      { turnId: "answer-2", speaker: "specialist", occurredAt: 20_000, overrideInteractionModeId: "mentor" },
      { turnId: "answer-3", speaker: "specialist", occurredAt: 30_000 },
    ],
    evidence: {
      schemaVersion: 1,
      provenance: "recorded",
      materialSpecialistTurnIds: ["answer-1", "answer-2", "answer-3"],
      assistanceEvents: [{ turnId: "answer-2", rung: "hint" }],
    },
  });
  assert.equal(result.method, "material_specialist_turn_share");
  assert.equal(result.primaryPracticeModeId, "interviewer");
  assert.equal(result.transitionCount, 1);
  assert.equal(result.hadMentorAssistance, true);
});

test("legacy or incomplete evidence remains unrecorded without fabrication", () => {
  const result = classifyInteractionModePractice({
    registryModeIds: ["interviewer", "mentor", "grill"],
    transitions: [],
    timerIntervals: [{ startedAt: 0, endedAt: 100_000 }],
    turns: [],
    evidence: { schemaVersion: 1, provenance: "recorded", materialSpecialistTurnIds: [], assistanceEvents: [] },
  });
  assert.equal(result.primaryPracticeModeId, "unrecorded");
  assert.equal(result.provenance, "unrecorded");
  assert.equal(interactionModeClassificationLabel(result), "Mode not recorded");
  assert.equal(isRecordedInteractionMode(result), false);
});

test("only an explicit recorded mode is eligible for Past badges", () => {
  assert.equal(isRecordedInteractionMode(undefined), false);
  assert.equal(isRecordedInteractionMode({ primaryPracticeModeId: "unrecorded", provenance: "unrecorded" }), false);
  assert.equal(isRecordedInteractionMode({ primaryPracticeModeId: "interviewer", provenance: "reconstructed" }), false);
  assert.equal(isRecordedInteractionMode({ primaryPracticeModeId: "interviewer", provenance: "recorded" }), true);
});

test("Past mode filters keep assistance independent and registry IDs extensible", () => {
  const classification = {
    primaryPracticeModeId: "observer",
    hadMentorAssistance: true,
  };
  assert.equal(matchesInteractionModeFilter(classification, "observer"), true);
  assert.equal(matchesInteractionModeFilter(classification, "mentor_assistance"), true);
  assert.equal(matchesInteractionModeFilter(classification, "mixed"), false);
});

test("classification evidence rejects duplicate or mismatched assistance identities", () => {
  assert.equal(interactionModeClassificationInputSchema.safeParse({
    schemaVersion: 1,
    provenance: "recorded",
    materialSpecialistTurnIds: ["turn-1", "turn-1"],
    assistanceEvents: [],
  }).success, false);
  assert.equal(interactionModeClassificationInputSchema.safeParse({
    schemaVersion: 1,
    provenance: "recorded",
    materialSpecialistTurnIds: ["turn-1"],
    assistanceEvents: [{ turnId: "turn-2", rung: "hint" }],
  }).success, false);
});
