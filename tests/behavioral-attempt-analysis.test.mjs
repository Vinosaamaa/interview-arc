import assert from "node:assert/strict";
import test from "node:test";

import {
  behavioralAttemptAnalysisSchema,
  renderBehavioralAttemptAnalysisHtml,
  renderBehavioralAttemptAnalysisMarkdown,
} from "../db/behavioral-attempt-analysis.ts";

const analysis = (overrides = {}) => ({
  schemaVersion: 1,
  answerFormat: "STARL",
  competencies: ["ownership", "reliability"],
  claimAudit: [
    {
      claim: "I introduced stable retry identities.",
      status: "verified",
      supportingEvidenceIds: ["evidence-retry-boundary"],
      contraryEvidenceIds: [],
      gaps: [],
      contradictions: [],
    },
    {
      claim: "Recovery completed within ten minutes.",
      status: "unverified",
      supportingEvidenceIds: [],
      contraryEvidenceIds: [],
      gaps: ["The exact recovery duration is not confirmed."],
      contradictions: [],
    },
  ],
  reviewDimensions: {
    relevance: { status: "strength", observation: "Directly answered the recovery prompt." },
    structure: { status: "strength", observation: "Used a clear STARL progression." },
    specificity: { status: "mixed", observation: "Named the mechanism but not a measured result." },
    personalOwnership: { status: "strength", observation: "Separated the owner's decision from team work." },
    decisions: { status: "strength", observation: "Explained the stable-identity choice." },
    result: { status: "improvement", observation: "The measured production outcome remains unconfirmed." },
    learning: { status: "strength", observation: "Connected the incident to a reusable retry invariant." },
    delivery: { status: "not_observed" },
  },
  strengths: ["The answer names the recovery invariant."],
  improvements: ["Quantify only after owner confirmation."],
  coachingNotes: ["Generated coaching — not evidence: lead with the failure mode."],
  likelyFollowUps: ["How did you test an ambiguous commit?"],
  nextDrill: "Rehearse the rollback decision in two minutes.",
  ...overrides,
});

test("claim audit keeps verified, missing, contrary, and coaching material distinct", () => {
  const parsed = behavioralAttemptAnalysisSchema.parse(analysis());
  assert.equal(parsed.claimAudit[0].supportingEvidenceIds[0], "evidence-retry-boundary");
  assert.equal(parsed.claimAudit[1].status, "unverified");
  assert.throws(() => behavioralAttemptAnalysisSchema.parse(analysis({
    claimAudit: [{
      claim: "Unsupported claim",
      status: "verified",
      supportingEvidenceIds: [],
      contraryEvidenceIds: [],
      gaps: [],
      contradictions: [],
    }],
  })));
  assert.throws(() => behavioralAttemptAnalysisSchema.parse(analysis({
    claimAudit: [{
      claim: "Contradicted claim",
      status: "contradicted",
      supportingEvidenceIds: [],
      contraryEvidenceIds: [],
      gaps: [],
      contradictions: ["A saved observation conflicts."],
    }],
  })));
});

test("Markdown and local HTML preserve the same authoritative analysis", () => {
  const projection = {
    source: "analysis_v1",
    snapshotRevision: 2,
    question: { questionId: "behavioral-reliability-1", title: "Tell me about a recovery", prompt: "Describe a recovery." },
    solutionProfile: { questionId: "behavioral-reliability-1", revision: 3 },
    scope: "universal",
    target: null,
    story: { storyId: "story-retry-boundary" },
    analysis: behavioralAttemptAnalysisSchema.parse(analysis()),
  };
  const markdown = renderBehavioralAttemptAnalysisMarkdown(projection);
  const html = renderBehavioralAttemptAnalysisHtml(projection).replaceAll("&#039;", "'");
  for (const exact of [
    "behavioral-reliability-1 · Profile revision 3 · Answer snapshot 2",
    "I introduced stable retry identities.",
    "evidence-retry-boundary",
    "The exact recovery duration is not confirmed.",
    "delivery: not_observed",
    "Story: story-retry-boundary",
    "Generated coaching — not evidence: lead with the failure mode.",
    "Rehearse the rollback decision in two minutes.",
  ]) {
    const pattern = new RegExp(exact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    assert.match(markdown, pattern);
    assert.match(html, pattern);
  }
});
