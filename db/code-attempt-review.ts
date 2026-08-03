export type CodeAttemptReviewPendingV1 = {
  schemaVersion: 1;
  status: "pending";
};

export type CodeAttemptReviewCompleteV1 = {
  schemaVersion: 1;
  status: "complete";
  summary: string;
  whatWentWell: string[];
  whatToImprove: string[];
  testingEvidence: string[];
  nextStep?: string;
  provenance: "specialist_observed" | "explicit_evidence_backfill";
  reviewedAt: number;
};

export type CodeAttemptReviewV1 = CodeAttemptReviewPendingV1 | CodeAttemptReviewCompleteV1;
export type CodeAttemptReviewDisplay = CodeAttemptReviewV1 | {
  schemaVersion: 0;
  status: "not_recorded";
};

export type CodeAttemptReviewWrite = {
  id: string;
  activityId: string;
  originatingTurnId: string;
  sequence: number;
  language: string;
  code: string;
  occurredAt: number;
  review: CodeAttemptReviewV1;
  reviewResponseTurnId: string | null;
  observedCorrectness: "not_verified" | "appears_correct" | "issues_found" | "incomplete";
  concreteFindings: string[];
  edgeCases: string[];
  complexity: { time?: string; space?: string } | null;
  finalDeclaration: string;
};

export type CodeAttemptWritePlan =
  | { kind: "insert" }
  | { kind: "update_evaluation" }
  | { kind: "backfill_review" }
  | { kind: "duplicate" };

const PENDING_KEYS = ["schemaVersion", "status"] as const;
const COMPLETE_REQUIRED_KEYS = [
  "schemaVersion",
  "status",
  "summary",
  "whatWentWell",
  "whatToImprove",
  "testingEvidence",
  "provenance",
  "reviewedAt",
] as const;

function hasOnlyKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function nonEmptyTextList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmptyText);
}

export function normalizeCodeAttemptReview(value: unknown): CodeAttemptReviewV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) return null;
  if (candidate.status === "pending") {
    return hasOnlyKeys(candidate, PENDING_KEYS)
      ? { schemaVersion: 1, status: "pending" }
      : null;
  }
  if (candidate.status !== "complete" || !hasOnlyKeys(candidate, COMPLETE_REQUIRED_KEYS, ["nextStep"])) {
    return null;
  }
  if (
    !nonEmptyText(candidate.summary)
    || !nonEmptyTextList(candidate.whatWentWell)
    || !nonEmptyTextList(candidate.whatToImprove)
    || !nonEmptyTextList(candidate.testingEvidence)
    || (candidate.nextStep !== undefined && !nonEmptyText(candidate.nextStep))
    || (candidate.provenance !== "specialist_observed" && candidate.provenance !== "explicit_evidence_backfill")
    || !Number.isInteger(candidate.reviewedAt)
    || (candidate.reviewedAt as number) <= 0
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    status: "complete",
    summary: candidate.summary,
    whatWentWell: [...candidate.whatWentWell],
    whatToImprove: [...candidate.whatToImprove],
    testingEvidence: [...candidate.testingEvidence],
    ...(candidate.nextStep === undefined ? {} : { nextStep: candidate.nextStep }),
    provenance: candidate.provenance,
    reviewedAt: candidate.reviewedAt as number,
  };
}

export function codeAttemptReviewForDisplay(value: unknown): CodeAttemptReviewDisplay {
  return normalizeCodeAttemptReview(value) ?? { schemaVersion: 0, status: "not_recorded" };
}

const IMMUTABLE_ATTEMPT_FIELDS = [
  "id",
  "activityId",
  "originatingTurnId",
  "sequence",
  "language",
  "code",
  "occurredAt",
] as const;
const EVALUATION_EVIDENCE_FIELDS = [
  "observedCorrectness",
  "concreteFindings",
  "edgeCases",
  "complexity",
  "finalDeclaration",
] as const;
const MUTABLE_ATTEMPT_FIELDS = [
  "review",
  "reviewResponseTurnId",
  ...EVALUATION_EVIDENCE_FIELDS,
] as const;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function planCodeAttemptWrite(
  existing: (Omit<CodeAttemptReviewWrite, "review"> & { review: unknown }) | null,
  incoming: CodeAttemptReviewWrite,
): CodeAttemptWritePlan {
  if (!existing) return { kind: "insert" };
  const identityChanged = IMMUTABLE_ATTEMPT_FIELDS.some((field) => existing[field] !== incoming[field]);
  if (identityChanged) {
    throw new Error("A code attempt retry cannot change immutable code attempt identity.");
  }
  const mutableFieldsMatch = MUTABLE_ATTEMPT_FIELDS.every(
    (field) => canonicalJson(existing[field]) === canonicalJson(incoming[field]),
  );
  if (mutableFieldsMatch) return { kind: "duplicate" };
  const existingReview = normalizeCodeAttemptReview(existing.review);
  if (!existingReview) {
    if (incoming.review.status === "complete" && incoming.review.provenance === "explicit_evidence_backfill") {
      const evidenceChanged = EVALUATION_EVIDENCE_FIELDS.some(
        (field) => canonicalJson(existing[field]) !== canonicalJson(incoming[field]),
      );
      if (evidenceChanged) {
        throw new Error("An explicit review backfill cannot change stored attempt evidence.");
      }
      return { kind: "backfill_review" };
    }
    throw new Error("A historical review can only be completed through an explicit evidence backfill.");
  }
  if (existingReview.status === "complete") {
    throw new Error("A complete code attempt review is immutable; revised code needs a new attempt.");
  }
  if (incoming.review.status === "pending") return { kind: "update_evaluation" };
  return { kind: "update_evaluation" };
}

function comparableText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}+#]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function codeLineCount(code: string) {
  let lines = 1;
  for (let index = 0; index < code.length; index += 1) {
    if (code.charCodeAt(index) === 10) lines += 1;
  }
  return lines;
}

export function assertCodeAttemptReviewParity(
  review: CodeAttemptReviewCompleteV1,
  visibleSpecialistResponse: string,
  storedEvaluationEvidence: string[],
) {
  const visible = comparableText(visibleSpecialistResponse);
  const requiredVisibleStatements = [
    review.summary,
    ...review.whatWentWell,
    ...review.whatToImprove,
    ...review.testingEvidence,
    ...(review.nextStep ? [review.nextStep] : []),
  ];
  const hiddenStatement = requiredVisibleStatements.find((statement) => !visible.includes(comparableText(statement)));
  if (hiddenStatement) {
    throw new Error(`The structured review contains a conclusion missing from the visible specialist review: ${hiddenStatement}`);
  }
  const evidence = comparableText(storedEvaluationEvidence.join("\n"));
  const unsupportedTest = review.testingEvidence.find((item) => !evidence.includes(comparableText(item)));
  if (unsupportedTest) {
    throw new Error(`Testing evidence is not supported by the stored evaluation evidence: ${unsupportedTest}`);
  }
}

export function codeAttemptEvaluationEvidence(attempt: Pick<CodeAttemptReviewWrite,
  "observedCorrectness" | "concreteFindings" | "edgeCases" | "complexity" | "finalDeclaration"
>) {
  return [
    `Observed correctness: ${attempt.observedCorrectness}`,
    ...attempt.concreteFindings,
    ...attempt.edgeCases,
    ...(attempt.complexity?.time ? [`Time complexity: ${attempt.complexity.time}`] : []),
    ...(attempt.complexity?.space ? [`Space complexity: ${attempt.complexity.space}`] : []),
    attempt.finalDeclaration,
  ];
}

export function pendingCodeAttemptReviewIds(attempts: Array<{ id: string; review: unknown }>) {
  return attempts.flatMap((attempt) => {
    const review = normalizeCodeAttemptReview(attempt.review);
    return review?.status === "pending" ? [attempt.id] : [];
  });
}
