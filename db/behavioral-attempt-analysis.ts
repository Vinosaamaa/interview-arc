import { z } from "zod";

const stableIdSchema = z.string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Use a lowercase stable ID.");
const text = (max: number) => z.string().trim().min(1).max(max);
const textList = (count: number, max = 1_000) => z.array(text(max)).max(count);

const claimAuditSchema = z.object({
  claim: text(2_000),
  status: z.enum(["verified", "partial", "unverified", "contradicted"]),
  supportingEvidenceIds: z.array(stableIdSchema).max(100),
  contraryEvidenceIds: z.array(stableIdSchema).max(100),
  gaps: textList(100),
  contradictions: textList(100),
}).strict().superRefine((claim, context) => {
  const supporting = new Set(claim.supportingEvidenceIds);
  const contrary = new Set(claim.contraryEvidenceIds);
  if (supporting.size !== claim.supportingEvidenceIds.length || contrary.size !== claim.contraryEvidenceIds.length) {
    context.addIssue({ code: "custom", message: "Evidence IDs must be unique." });
  }
  if (claim.supportingEvidenceIds.some((id) => contrary.has(id))) {
    context.addIssue({ code: "custom", message: "One evidence item cannot be both supporting and contrary." });
  }
  if (claim.status === "verified" && (!supporting.size || contrary.size || claim.gaps.length || claim.contradictions.length)) {
    context.addIssue({ code: "custom", message: "Verified claims need supporting evidence and no unresolved gap or contradiction." });
  }
  if (claim.status === "partial" && (!supporting.size || (!contrary.size && !claim.gaps.length && !claim.contradictions.length))) {
    context.addIssue({ code: "custom", message: "Partial claims need support plus an explicit unresolved gap or contradiction." });
  }
  if (claim.status === "unverified" && (supporting.size || contrary.size || claim.contradictions.length || !claim.gaps.length)) {
    context.addIssue({ code: "custom", message: "Unverified claims need an explicit gap and no evidence assertion." });
  }
  if (claim.status === "contradicted" && (!contrary.size || !claim.contradictions.length)) {
    context.addIssue({ code: "custom", message: "Contradicted claims need contrary evidence and an explicit contradiction." });
  }
});

const reviewDimensionSchema = z.object({
  status: z.enum(["not_observed", "strength", "mixed", "improvement"]),
  observation: text(1_000).optional(),
}).strict().superRefine((dimension, context) => {
  if (dimension.status !== "not_observed" && !dimension.observation) {
    context.addIssue({ code: "custom", message: "Observed dimensions require one concise observation." });
  }
});

export const behavioralAttemptAnalysisSchema = z.object({
  schemaVersion: z.literal(1),
  answerFormat: z.enum(["PPF", "STAR", "STARL", "OTHER"]),
  competencies: textList(24, 120).min(1),
  claimAudit: z.array(claimAuditSchema).min(1).max(100),
  reviewDimensions: z.object({
    relevance: reviewDimensionSchema,
    structure: reviewDimensionSchema,
    specificity: reviewDimensionSchema,
    personalOwnership: reviewDimensionSchema,
    decisions: reviewDimensionSchema,
    result: reviewDimensionSchema,
    learning: reviewDimensionSchema,
    delivery: reviewDimensionSchema,
  }).strict(),
  strengths: textList(50),
  improvements: textList(50),
  coachingNotes: textList(50),
  likelyFollowUps: textList(50),
  nextDrill: text(2_000),
}).strict().superRefine((analysis, context) => {
  if (new Set(analysis.competencies).size !== analysis.competencies.length) {
    context.addIssue({ code: "custom", path: ["competencies"], message: "Competencies must be unique." });
  }
});

export type BehavioralAttemptAnalysis = z.infer<typeof behavioralAttemptAnalysisSchema>;

export type BehavioralAttemptAnalysisProjection = {
  source: "analysis_v1";
  snapshotRevision: number;
  question: { questionId: string; title: string; prompt: string };
  solutionProfile: { questionId: string; revision: number };
  scope: "universal" | "target_tailored";
  target: { targetId: string; revision: number; label: string; competencyEmphasis: string[] } | null;
  story: { storyId: string; revision?: number; alternativeId?: string } | null;
  analysis: BehavioralAttemptAnalysis;
};

export function projectBehavioralAttemptAnalysis(
  finalAnswer: {
    source: "snapshot_v1" | "legacy_model_answer";
    snapshotRevision: number | null;
    question: BehavioralAttemptAnalysisProjection["question"] | null;
    solutionProfile: BehavioralAttemptAnalysisProjection["solutionProfile"] | null;
    scope: BehavioralAttemptAnalysisProjection["scope"] | null;
    target: BehavioralAttemptAnalysisProjection["target"];
    story: BehavioralAttemptAnalysisProjection["story"];
    behavioralAnalysis: BehavioralAttemptAnalysis | null;
  } | null,
): BehavioralAttemptAnalysisProjection | null {
  if (
    !finalAnswer
    || finalAnswer.source !== "snapshot_v1"
    || !finalAnswer.snapshotRevision
    || !finalAnswer.question
    || !finalAnswer.solutionProfile
    || !finalAnswer.scope
    || !finalAnswer.behavioralAnalysis
  ) return null;
  return {
    source: "analysis_v1",
    snapshotRevision: finalAnswer.snapshotRevision,
    question: finalAnswer.question,
    solutionProfile: finalAnswer.solutionProfile,
    scope: finalAnswer.scope,
    target: finalAnswer.target,
    story: finalAnswer.story,
    analysis: behavioralAttemptAnalysisSchema.parse(finalAnswer.behavioralAnalysis),
  };
}

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");
const markdownList = (items: string[], empty = "None recorded.") => items.length
  ? items.map((item) => `- ${item}`).join("\n")
  : `- ${empty}`;
const htmlList = (items: string[], empty = "None recorded.") => `<ul>${(items.length ? items : [empty])
  .map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;

export function renderBehavioralAttemptAnalysisMarkdown(projection: BehavioralAttemptAnalysisProjection | null) {
  if (!projection) return "";
  const { analysis } = projection;
  const claims = analysis.claimAudit.flatMap((claim) => [
    `#### ${claim.status.toUpperCase()} · ${claim.claim}`,
    "",
    `Supporting evidence: ${claim.supportingEvidenceIds.join(" · ") || "None"}`,
    `Contrary evidence: ${claim.contraryEvidenceIds.join(" · ") || "None"}`,
    `Gaps: ${claim.gaps.join(" · ") || "None"}`,
    `Contradictions: ${claim.contradictions.join(" · ") || "None"}`,
    "",
  ]);
  return [
    "## Behavioral Attempt",
    "",
    `${projection.question.questionId} · Profile revision ${projection.solutionProfile.revision} · Answer snapshot ${projection.snapshotRevision}`,
    "",
    `Answer format: ${analysis.answerFormat} · Scope: ${projection.scope}`,
    ...(projection.target ? [`Target: ${projection.target.label} · revision ${projection.target.revision}`] : []),
    ...(projection.story ? [`Story: ${projection.story.storyId} · ${projection.story.revision ? `revision ${projection.story.revision}` : "legacy unversioned reference"}${projection.story.alternativeId ? ` · alternative ${projection.story.alternativeId}` : ""}`] : []),
    `Competencies: ${analysis.competencies.join(" · ")}`,
    "",
    "### Claim audit",
    "",
    ...claims,
    "### What worked",
    "",
    markdownList(analysis.strengths),
    "",
    "### Improve next",
    "",
    markdownList(analysis.improvements),
    "",
    "### Review dimensions",
    "",
    ...Object.entries(analysis.reviewDimensions).map(([dimension, value]) => `- ${dimension}: ${value.status}${value.observation ? ` — ${value.observation}` : ""}`),
    "",
    "### Generated coaching — not evidence",
    "",
    markdownList(analysis.coachingNotes),
    "",
    "### Likely follow-ups",
    "",
    markdownList(analysis.likelyFollowUps),
    "",
    "### Next drill",
    "",
    analysis.nextDrill,
  ].join("\n");
}

export function renderBehavioralAttemptAnalysisHtml(projection: BehavioralAttemptAnalysisProjection | null) {
  if (!projection) return "";
  const { analysis } = projection;
  return [
    '<section data-behavioral-attempt-analysis="true">',
    "<h2>Behavioral Attempt</h2>",
    `<p>${escapeHtml(`${projection.question.questionId} · Profile revision ${projection.solutionProfile.revision} · Answer snapshot ${projection.snapshotRevision}`)}</p>`,
    `<p>Answer format: ${escapeHtml(analysis.answerFormat)} · Scope: ${escapeHtml(projection.scope)}</p>`,
    ...(projection.target ? [`<p>Target: ${escapeHtml(projection.target.label)} · revision ${projection.target.revision}</p>`] : []),
    ...(projection.story ? [`<p>Story: ${escapeHtml(projection.story.storyId)} · ${projection.story.revision ? `revision ${projection.story.revision}` : "legacy unversioned reference"}${projection.story.alternativeId ? ` · alternative ${escapeHtml(projection.story.alternativeId)}` : ""}</p>`] : []),
    `<p>Competencies: ${escapeHtml(analysis.competencies.join(" · "))}</p>`,
    "<h3>Claim audit</h3>",
    ...analysis.claimAudit.map((claim) => [
      `<article><h4>${escapeHtml(`${claim.status.toUpperCase()} · ${claim.claim}`)}</h4>`,
      `<p>Supporting evidence: ${escapeHtml(claim.supportingEvidenceIds.join(" · ") || "None")}</p>`,
      `<p>Contrary evidence: ${escapeHtml(claim.contraryEvidenceIds.join(" · ") || "None")}</p>`,
      `<p>Gaps: ${escapeHtml(claim.gaps.join(" · ") || "None")}</p>`,
      `<p>Contradictions: ${escapeHtml(claim.contradictions.join(" · ") || "None")}</p></article>`,
    ].join("")),
    "<h3>What worked</h3>", htmlList(analysis.strengths),
    "<h3>Improve next</h3>", htmlList(analysis.improvements),
    "<h3>Review dimensions</h3>", htmlList(Object.entries(analysis.reviewDimensions).map(([dimension, value]) => `${dimension}: ${value.status}${value.observation ? ` — ${value.observation}` : ""}`)),
    "<h3>Generated coaching — not evidence</h3>", htmlList(analysis.coachingNotes),
    "<h3>Likely follow-ups</h3>", htmlList(analysis.likelyFollowUps),
    "<h3>Next drill</h3>", `<p>${escapeHtml(analysis.nextDrill)}</p>`,
    "</section>",
  ].join("");
}
