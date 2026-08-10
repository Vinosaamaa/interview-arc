import { z } from "zod";

const stableIdSchema = z.string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Use a lowercase stable ID.");
const boundedText = (max: number) => z.string().trim().min(1).max(max);
const boundedTextList = (maxItems: number, maxLength = 500) => z.array(boundedText(maxLength)).max(maxItems);

const targetSnapshotSchema = z.object({
  targetId: stableIdSchema,
  revision: z.number().int().positive(),
  label: boundedText(240),
  competencyEmphasis: boundedTextList(24, 120),
}).strict();

export const behavioralFinalAnswerSnapshotInputSchema = z.object({
  schemaVersion: z.literal(1),
  answer: boundedText(40_000),
  scope: z.enum(["universal", "target_tailored"]),
  question: z.object({
    questionId: stableIdSchema,
    title: boundedText(500),
    prompt: boundedText(10_000),
  }).strict(),
  solutionProfile: z.object({
    questionId: stableIdSchema,
    revision: z.number().int().positive(),
  }).strict(),
  story: z.object({
    storyId: stableIdSchema,
    alternativeId: stableIdSchema.optional(),
  }).strict().optional(),
  acceptedEvidenceIds: z.array(stableIdSchema).max(100),
  evidenceGaps: boundedTextList(100, 1_000),
  contradictions: boundedTextList(100, 1_000),
  provenance: z.object({
    responseTurnId: stableIdSchema,
  }).strict(),
  target: targetSnapshotSchema.optional(),
}).strict().superRefine((snapshot, context) => {
  if (snapshot.question.questionId !== snapshot.solutionProfile.questionId) {
    context.addIssue({
      code: "custom",
      path: ["solutionProfile", "questionId"],
      message: "The exact Solution Profile revision must belong to the snapshot question.",
    });
  }
  if (new Set(snapshot.acceptedEvidenceIds).size !== snapshot.acceptedEvidenceIds.length) {
    context.addIssue({
      code: "custom",
      path: ["acceptedEvidenceIds"],
      message: "Accepted evidence IDs must be unique.",
    });
  }
  if (snapshot.scope === "universal" && snapshot.target) {
    context.addIssue({
      code: "custom",
      path: ["target"],
      message: "Universal answers must not contain Target Profile data.",
    });
  }
  if (snapshot.scope === "target_tailored" && !snapshot.target) {
    context.addIssue({
      code: "custom",
      path: ["target"],
      message: "Target-tailored answers require an exact Target Profile revision.",
    });
  }
});

export const behavioralFinalAnswerCorrectionSchema = z.object({
  replacesSnapshotRevision: z.number().int().positive(),
  reason: boundedText(1_000),
}).strict();

export type BehavioralFinalAnswerSnapshotInput = z.infer<typeof behavioralFinalAnswerSnapshotInputSchema>;
export type BehavioralFinalAnswerCorrection = z.infer<typeof behavioralFinalAnswerCorrectionSchema>;

export async function behavioralFinalAnswerFingerprint(input: {
  activityId: string;
  questionId: string;
  snapshot: BehavioralFinalAnswerSnapshotInput;
  correction?: BehavioralFinalAnswerCorrection;
}) {
  const canonical = JSON.stringify({
    activityId: input.activityId,
    questionId: input.questionId,
    snapshot: behavioralFinalAnswerSnapshotInputSchema.parse(input.snapshot),
    correction: input.correction
      ? behavioralFinalAnswerCorrectionSchema.parse(input.correction)
      : null,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export type StoredBehavioralFinalAnswerSnapshot = {
  snapshotRevision: number;
  correctionOfRevision: number | null;
  correctionReason: string | null;
  finalizedAt: number;
  snapshot: BehavioralFinalAnswerSnapshotInput;
};

export class BehavioralFinalAnswerError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "BehavioralFinalAnswerError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function validateBehavioralFinalAnswerCorrection(
  prior: Pick<StoredBehavioralFinalAnswerSnapshot, "snapshotRevision" | "snapshot"> | null,
  incomingValue: BehavioralFinalAnswerSnapshotInput,
  correctionValue?: BehavioralFinalAnswerCorrection,
) {
  const incoming = behavioralFinalAnswerSnapshotInputSchema.parse(incomingValue);
  const correction = correctionValue
    ? behavioralFinalAnswerCorrectionSchema.parse(correctionValue)
    : undefined;
  if (!prior) {
    if (correction) {
      throw new BehavioralFinalAnswerError(
        "behavioral_final_answer_correction_conflict",
        "A first snapshot cannot replace a prior revision.",
      );
    }
    return { status: "created" as const, snapshotRevision: 1 };
  }
  const priorSnapshot = behavioralFinalAnswerSnapshotInputSchema.parse(prior.snapshot);
  if (JSON.stringify(priorSnapshot) === JSON.stringify(incoming)) {
    if (correction) {
      throw new BehavioralFinalAnswerError(
        "behavioral_final_answer_correction_conflict",
        "An exact retry must not create a correction revision.",
      );
    }
    return { status: "unchanged" as const, snapshotRevision: prior.snapshotRevision };
  }
  if (!correction) {
    throw new BehavioralFinalAnswerError(
      "behavioral_final_answer_correction_required",
      "A completed final answer is immutable; provide an explicit correction of the current snapshot revision.",
    );
  }
  if (correction.replacesSnapshotRevision !== prior.snapshotRevision) {
    throw new BehavioralFinalAnswerError(
      "behavioral_final_answer_correction_conflict",
      "The correction does not replace the current snapshot revision; reread the attempt before retrying.",
    );
  }
  return { status: "corrected" as const, snapshotRevision: prior.snapshotRevision + 1 };
}

export type BehavioralFinalAnswerProjection = {
  source: "snapshot_v1" | "legacy_model_answer";
  snapshotRevision: number | null;
  answer: string;
  scope: BehavioralFinalAnswerSnapshotInput["scope"] | null;
  question: BehavioralFinalAnswerSnapshotInput["question"] | null;
  solutionProfile: BehavioralFinalAnswerSnapshotInput["solutionProfile"] | null;
  story: BehavioralFinalAnswerSnapshotInput["story"] | null;
  acceptedEvidenceIds: string[];
  evidenceGaps: string[];
  contradictions: string[];
  target: BehavioralFinalAnswerSnapshotInput["target"] | null;
  finalizedAt: number | null;
  correctionOfRevision: number | null;
  correctionReason: string | null;
};

export function projectBehavioralFinalAnswer(input: {
  snapshots: StoredBehavioralFinalAnswerSnapshot[];
  legacyModelAnswer?: string | null;
}): BehavioralFinalAnswerProjection | null {
  const current = input.snapshots.reduce<StoredBehavioralFinalAnswerSnapshot | undefined>(
    (latest, candidate) => !latest || candidate.snapshotRevision > latest.snapshotRevision ? candidate : latest,
    undefined,
  );
  if (current) {
    const snapshot = behavioralFinalAnswerSnapshotInputSchema.parse(current.snapshot);
    return {
      source: "snapshot_v1",
      snapshotRevision: current.snapshotRevision,
      answer: snapshot.answer,
      scope: snapshot.scope,
      question: snapshot.question,
      solutionProfile: snapshot.solutionProfile,
      story: snapshot.story ?? null,
      acceptedEvidenceIds: snapshot.acceptedEvidenceIds,
      evidenceGaps: snapshot.evidenceGaps,
      contradictions: snapshot.contradictions,
      target: snapshot.target ?? null,
      finalizedAt: current.finalizedAt,
      correctionOfRevision: current.correctionOfRevision,
      correctionReason: current.correctionReason,
    };
  }
  const legacyModelAnswer = input.legacyModelAnswer?.trim();
  if (!legacyModelAnswer) return null;
  return {
    source: "legacy_model_answer",
    snapshotRevision: null,
    answer: legacyModelAnswer,
    scope: null,
    question: null,
    solutionProfile: null,
    story: null,
    acceptedEvidenceIds: [],
    evidenceGaps: [],
    contradictions: [],
    target: null,
    finalizedAt: null,
    correctionOfRevision: null,
    correctionReason: null,
  };
}

function markdownList(items: string[], empty: string) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${empty}`;
}

export function renderBehavioralFinalAnswerMarkdown(projection: BehavioralFinalAnswerProjection | null) {
  if (!projection) return "";
  const metadata = projection.source === "legacy_model_answer"
    ? "Legacy final answer · saved before snapshot v1"
    : `${projection.scope === "target_tailored" ? "Target-tailored" : "Universal"} · Snapshot revision ${projection.snapshotRevision}`;
  return [
    "## Final tailored answer",
    "",
    metadata,
    "",
    projection.answer,
    "",
    "### Evidence gaps",
    "",
    markdownList(projection.evidenceGaps, "None recorded."),
    "",
    "### Contradictions",
    "",
    markdownList(projection.contradictions, "None recorded."),
  ].join("\n");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function htmlList(items: string[], empty: string) {
  const values = items.length ? items : [empty];
  return `<ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

export function renderBehavioralFinalAnswerHtml(projection: BehavioralFinalAnswerProjection | null) {
  if (!projection) return "";
  const metadata = projection.source === "legacy_model_answer"
    ? "Legacy final answer · saved before snapshot v1"
    : `${projection.scope === "target_tailored" ? "Target-tailored" : "Universal"} · Snapshot revision ${projection.snapshotRevision}`;
  return [
    '<section data-behavioral-final-answer="true">',
    "<h2>Final tailored answer</h2>",
    `<p>${escapeHtml(metadata)}</p>`,
    `<div>${escapeHtml(projection.answer).replaceAll("\n", "<br>")}</div>`,
    "<h3>Evidence gaps</h3>",
    htmlList(projection.evidenceGaps, "None recorded."),
    "<h3>Contradictions</h3>",
    htmlList(projection.contradictions, "None recorded."),
    "</section>",
  ].join("");
}
