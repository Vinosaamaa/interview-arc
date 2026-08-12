import assert from "node:assert/strict";
import test from "node:test";

import {
  BehavioralFinalAnswerError,
  behavioralFinalAnswerFingerprint,
  behavioralFinalAnswerSnapshotInputSchema,
  projectBehavioralFinalAnswer,
  renderBehavioralFinalAnswerHtml,
  renderBehavioralFinalAnswerMarkdown,
  validateBehavioralFinalAnswerCorrection,
} from "../db/behavioral-final-answer.ts";

function universalSnapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    answer: "I stabilized delivery by making retries identity-idempotent.",
    scope: "universal",
    question: {
      questionId: "behavioral-reliability-1",
      title: "Tell me about a reliability improvement",
      prompt: "Tell me about a time you improved reliability.",
    },
    solutionProfile: {
      questionId: "behavioral-reliability-1",
      revision: 3,
    },
    story: {
      storyId: "delivery-reliability",
      revision: 2,
      alternativeId: "universal",
    },
    acceptedEvidenceIds: ["evidence-retry-boundary"],
    evidenceGaps: ["Production impact is not independently measured."],
    contradictions: [],
    provenance: {
      responseTurnId: "behavioral-response-1",
    },
    ...overrides,
  };
}

test("universal snapshots preserve exact answer and revision identities", () => {
  const snapshot = behavioralFinalAnswerSnapshotInputSchema.parse(universalSnapshot());
  assert.equal(snapshot.answer, universalSnapshot().answer);
  assert.equal(snapshot.question.questionId, snapshot.solutionProfile.questionId);
  assert.equal(snapshot.solutionProfile.revision, 3);
});

test("scope validation keeps universal answers neutral and accepts one exact tailored context", () => {
  assert.throws(
    () => behavioralFinalAnswerSnapshotInputSchema.parse(universalSnapshot({
      target: {
        targetId: "target-example",
        revision: 2,
        label: "Example company · Staff backend",
        competencyEmphasis: ["reliability", "ownership"],
      },
    })),
  );

  assert.throws(
    () => behavioralFinalAnswerSnapshotInputSchema.parse(universalSnapshot({ scope: "target_tailored" })),
  );

  const tailored = behavioralFinalAnswerSnapshotInputSchema.parse(universalSnapshot({
    scope: "target_tailored",
    target: {
      targetId: "target-example",
      revision: 2,
      label: "Example company · Staff backend",
      competencyEmphasis: ["reliability", "ownership"],
    },
  }));
  assert.equal(tailored.target.revision, 2);

  const loopTailored = behavioralFinalAnswerSnapshotInputSchema.parse(universalSnapshot({
    scope: "target_tailored",
    roleBrief: {
      loopId: "loop-example-staff-backend",
      revision: 4,
      label: "Example company · Staff backend",
      company: "Example company",
      roleTitle: "Staff backend engineer",
      competencyEmphasis: ["reliability", "ownership"],
    },
  }));
  assert.equal(loopTailored.roleBrief.revision, 4);

  assert.throws(
    () => behavioralFinalAnswerSnapshotInputSchema.parse({
      ...tailored,
      roleBrief: loopTailored.roleBrief,
    }),
  );

  assert.throws(
    () => behavioralFinalAnswerSnapshotInputSchema.parse({
      ...tailored,
      target: { ...tailored.target, rawJobDescription: "private JD" },
    }),
  );

  assert.throws(
    () => behavioralFinalAnswerSnapshotInputSchema.parse({
      ...loopTailored,
      roleBrief: { ...loopTailored.roleBrief, rawJobDescription: "private JD" },
    }),
  );
});

test("Role Brief projections preserve exact Loop ownership without raw job-description data", () => {
  const stored = {
    snapshotRevision: 1,
    correctionOfRevision: null,
    correctionReason: null,
    finalizedAt: 1_786_363_200_000,
    snapshot: universalSnapshot({
      scope: "target_tailored",
      roleBrief: {
        loopId: "loop-example-staff-backend",
        revision: 4,
        label: "Example company · Staff backend",
        company: "Example company",
        roleTitle: "Staff backend engineer",
        competencyEmphasis: ["reliability", "ownership"],
      },
    }),
  };
  const projection = projectBehavioralFinalAnswer({ snapshots: [stored] });
  assert.equal(projection.roleBrief.loopId, "loop-example-staff-backend");
  assert.equal(projection.target, null);
  assert.match(renderBehavioralFinalAnswerMarkdown(projection), /Role Brief Example company · Staff backend · revision 4/);
  assert.match(renderBehavioralFinalAnswerHtml(projection), /Role Brief Example company · Staff backend · revision 4/);
});

test("final-answer identity includes the typed target review", async () => {
  const base = {
    activityId: "activity-target-review",
    questionId: "behavioral-reliability-1",
    snapshot: universalSnapshot(),
  };
  const first = await behavioralFinalAnswerFingerprint({
    ...base,
    behavioralReview: {
      schemaVersion: 1,
      universalQuality: { strengths: ["Clear."], improvements: [] },
      targetAlignment: { strengths: [], gaps: [], competencySignals: [] },
      assistance: { level: "none", details: [] },
      evidenceGaps: [],
    },
  });
  const changed = await behavioralFinalAnswerFingerprint({
    ...base,
    behavioralReview: {
      schemaVersion: 1,
      universalQuality: { strengths: ["Specific."], improvements: [] },
      targetAlignment: { strengths: [], gaps: [], competencySignals: [] },
      assistance: { level: "none", details: [] },
      evidenceGaps: [],
    },
  });
  assert.notEqual(first, changed);
});

test("final-answer identity binds the exact resume revision when supplied", async () => {
  const base = {
    activityId: "activity-resume-context",
    questionId: "behavioral-reliability-1",
    snapshot: universalSnapshot(),
  };
  const withoutResume = await behavioralFinalAnswerFingerprint(base);
  const first = await behavioralFinalAnswerFingerprint({
    ...base,
    resumeContext: { resumeId: "resume-primary", revisionId: "resume-revision-1" },
  });
  const changed = await behavioralFinalAnswerFingerprint({
    ...base,
    resumeContext: { resumeId: "resume-primary", revisionId: "resume-revision-2" },
  });
  assert.notEqual(first, withoutResume);
  assert.notEqual(first, changed);
});

test("correction validation never silently replaces an immutable snapshot", () => {
  const prior = { snapshotRevision: 2, snapshot: universalSnapshot() };
  assert.throws(
    () => validateBehavioralFinalAnswerCorrection(prior, universalSnapshot({ answer: "Changed answer." })),
    (error) => error instanceof BehavioralFinalAnswerError
      && error.code === "behavioral_final_answer_correction_required",
  );
  assert.throws(
    () => validateBehavioralFinalAnswerCorrection(
      prior,
      universalSnapshot({ answer: "Changed answer." }),
      { replacesSnapshotRevision: 1, reason: "Correct an attribution error." },
    ),
    (error) => error instanceof BehavioralFinalAnswerError
      && error.code === "behavioral_final_answer_correction_conflict",
  );
  assert.deepEqual(
    validateBehavioralFinalAnswerCorrection(
      prior,
      universalSnapshot({ answer: "Changed answer." }),
      { replacesSnapshotRevision: 2, reason: "Correct an attribution error." },
    ),
    { status: "corrected", snapshotRevision: 3 },
  );
});

test("dependency races are explicitly retryable while validation errors remain terminal", () => {
  assert.equal(new BehavioralFinalAnswerError("validation", "terminal").retryable, false);
  assert.equal(new BehavioralFinalAnswerError("dependency", "reread and retry", true).retryable, true);
});

test("Markdown and local HTML exports project the same authoritative snapshot", () => {
  const stored = {
    snapshotRevision: 1,
    correctionOfRevision: null,
    correctionReason: null,
    finalizedAt: 1_786_363_200_000,
    snapshot: universalSnapshot(),
  };
  const projection = projectBehavioralFinalAnswer({ snapshots: [stored], legacyModelAnswer: "legacy" });
  const markdown = renderBehavioralFinalAnswerMarkdown(projection);
  const html = renderBehavioralFinalAnswerHtml(projection);
  assert.equal(projection.answer, stored.snapshot.answer);
  assert.match(markdown, /## Final tailored answer/);
  assert.match(markdown, new RegExp(stored.snapshot.answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /<h2>Final tailored answer<\/h2>/);
  assert.match(html, new RegExp(stored.snapshot.answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(markdown, /legacy/);
  assert.doesNotMatch(html, /legacy/);
});

test("legacy modelAnswer is an explicit fallback and is never fabricated as a snapshot", () => {
  const projection = projectBehavioralFinalAnswer({
    snapshots: [],
    legacyModelAnswer: "A historical answer saved before snapshot v1.",
  });
  assert.equal(projection.source, "legacy_model_answer");
  assert.equal(projection.snapshotRevision, null);
  assert.equal(projection.answer, "A historical answer saved before snapshot v1.");
  assert.equal(projection.scope, null);
});

test("historical snapshots keep unversioned story identities without fabricating a revision", () => {
  const legacyStorySnapshot = universalSnapshot({
    story: { storyId: "delivery-reliability" },
  });
  const projection = projectBehavioralFinalAnswer({
    snapshots: [{
      snapshotRevision: 1,
      correctionOfRevision: null,
      correctionReason: null,
      finalizedAt: 1,
      snapshot: legacyStorySnapshot,
    }],
  });
  assert.deepEqual(projection.story, { storyId: "delivery-reliability" });
  assert.match(renderBehavioralFinalAnswerMarkdown(projection), /legacy unversioned reference/);
  assert.match(renderBehavioralFinalAnswerHtml(projection), /legacy unversioned reference/);
});
