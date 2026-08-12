export const BEHAVIORAL_EVIDENCE_LIMIT = 10;
export const BEHAVIORAL_CLAIM_LIMIT = 10;
export const BEHAVIORAL_GAP_LIMIT = 20;

export const behavioralEvidenceOrigins = [
  "user_statement",
  "resume",
  "document",
  "code_observation",
  "test_config_observation",
  "git_metadata",
  "generated_secondary",
  "derived_inference",
  "production_evidence",
] as const;

export const behavioralEvidenceProvenanceKinds = [
  "conversation",
  "resume_claim",
  "repository_observation",
  "document_observation",
  "production_evidence",
  "generated_secondary",
  "derived_inference",
] as const;

export const behavioralClaimStrengths = [
  "project_fact",
  "personal_contribution_candidate",
  "user_confirmation_required",
  "unsupported",
  "contradicted",
] as const;

export const behavioralClaimScopes = [
  "project",
  "personal_contribution",
  "ownership",
  "decision",
  "production",
  "scale",
  "metric",
  "result",
  "leadership",
] as const;

export type BehavioralEvidenceInput = {
  evidenceId: string;
  projectKey: string;
  origin: (typeof behavioralEvidenceOrigins)[number];
  statement: string;
  sourceRevision?: string;
  evidenceGrade: "E0" | "E1" | "E2" | "E3";
  attributionGrade: "A0" | "A1" | "A2" | "A3";
  claimStrength: (typeof behavioralClaimStrengths)[number];
  candidateState: "pending" | "accepted" | "rejected" | "superseded";
  safeProvenance: Array<{
    kind: (typeof behavioralEvidenceProvenanceKinds)[number];
    reference: string;
  }>;
  supports: string[];
  limitations: string[];
  tags: string[];
  ownerAttestation?: {
    activityId: string;
    userTurnId: string;
    confirmedAt: number;
  };
};

export type BehavioralEvidenceWritePayload = {
  evidence: BehavioralEvidenceInput;
  questionLink: {
    questionId: string;
    relevance: "supporting" | "contrary";
  };
};

export type BehavioralClaimInput = {
  claimId: string;
  questionId: string;
  text: string;
  scope: (typeof behavioralClaimScopes)[number];
  status: "unverified" | "partial" | "verified" | "contradicted";
  claimStrength: (typeof behavioralClaimStrengths)[number];
  evidenceIds: string[];
  contraryEvidenceIds: string[];
  gaps: string[];
  saferWording?: string;
  tags: string[];
};

export type BehavioralClaimWritePayload = {
  expectedRevision: number;
  claim: BehavioralClaimInput;
};

const STABLE_ID = /^[a-z0-9][a-z0-9._-]{0,199}$/;
const REMOTE_UNSAFE_PATTERNS = [
  /(?:^|[\s"'(])~[\\/]/m,
  /(?:^|[\s"'(])\.{1,2}[\\/][^\s"']+/m,
  /(?:^|[^A-Za-z0-9])\/(?!\/)[^\s"'<>]+/m,
  /\b[A-Za-z]:\\[^\s"']+/m,
  /(?:^|[\s"'(])\\\\[^\\\s]+\\[^\s"']+/m,
  /(?:^|[\s"'(])(?:private-sources|sources?|documents?|repos?(?:itories)?|projects?|docs?|src|app|packages?)[\\/][^\s"']+/im,
  /\b[A-Za-z0-9._-]+(?:[\\/][A-Za-z0-9._-]+)+\.(?:json|md|txt|pdf|docx?|ya?ml|toml|swift|tsx?|jsx?|mjs|cjs|java|py|go|rs)\b/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\bgit@[A-Za-z0-9.-]+:/i,
  /\bssh:\/\//i,
  /\bfile:\/\//i,
  /\bhttps?:\/\//i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/i,
  /\b(?:github_pat_|gh[pousr]_|sk-(?:proj-)?|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b\d{3}-\d{2}-\d{4}\b/,
];

export class BehavioralEvidenceError extends Error {
  readonly code: string;
  readonly retryable = false;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BehavioralEvidenceError";
    this.code = code;
  }
}

function assertStableId(value: string, label: string) {
  if (!STABLE_ID.test(value)) {
    throw new BehavioralEvidenceError(
      "behavioral_evidence_invalid_identity",
      `${label} must be a lowercase stable ID containing only letters, digits, dots, underscores, or hyphens.`,
    );
  }
}

function stringLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringLeaves);
  return [];
}

export function assertBehavioralEvidenceRemoteSafe(value: unknown) {
  if (stringLeaves(value).some((item) => REMOTE_UNSAFE_PATTERNS.some((pattern) => pattern.test(item)))) {
    throw new BehavioralEvidenceError(
      "behavioral_evidence_unsafe_payload",
      "Behavioral evidence contains private locator, identity, remote, credential, or key material and was rejected before enqueue.",
    );
  }
}

export function validateBehavioralEvidenceWrite(payload: BehavioralEvidenceWritePayload) {
  assertBehavioralEvidenceRemoteSafe(payload);
  assertStableId(payload.evidence.evidenceId, "evidenceId");
  assertStableId(payload.evidence.projectKey, "projectKey");
  assertStableId(payload.questionLink.questionId, "questionId");
  if (["rejected", "superseded"].includes(payload.evidence.candidateState)) {
    throw new BehavioralEvidenceError(
      "behavioral_evidence_review_required",
      "Rejected and superseded states may be reached only through explicit owner review.",
    );
  }
  const provenanceKindsByOrigin: Record<BehavioralEvidenceInput["origin"], BehavioralEvidenceInput["safeProvenance"][number]["kind"]> = {
    user_statement: "conversation",
    resume: "resume_claim",
    document: "document_observation",
    code_observation: "repository_observation",
    test_config_observation: "repository_observation",
    git_metadata: "repository_observation",
    generated_secondary: "generated_secondary",
    derived_inference: "derived_inference",
    production_evidence: "production_evidence",
  };
  const requiredProvenanceKind = provenanceKindsByOrigin[payload.evidence.origin];
  if (payload.evidence.safeProvenance.some((item) => item.kind !== requiredProvenanceKind)) {
    throw new BehavioralEvidenceError(
      "behavioral_evidence_provenance_mismatch",
      "Evidence origin and sanitized provenance kind must agree.",
    );
  }
  for (const provenance of payload.evidence.safeProvenance) {
    assertStableId(provenance.reference, "safeProvenance.reference");
  }
  if (payload.evidence.origin !== "user_statement" && !payload.evidence.sourceRevision) {
    throw new BehavioralEvidenceError(
      "behavioral_evidence_source_revision_required",
      "Non-conversation evidence requires a sanitized source revision.",
    );
  }
  if (payload.evidence.attributionGrade === "A3" && !payload.evidence.ownerAttestation) {
    throw new BehavioralEvidenceError(
      "behavioral_evidence_owner_attestation_required",
      "A3 attribution requires the exact owner-confirming activity, user turn, and timestamp.",
    );
  }
  if (payload.evidence.attributionGrade === "A3" && payload.evidence.origin !== "user_statement") {
    throw new BehavioralEvidenceError(
      "behavioral_evidence_invalid_a3_origin",
      "A3 attribution must be an atomic owner statement, not a code, document, Git, or generated observation.",
    );
  }
  if (payload.evidence.ownerAttestation && payload.evidence.attributionGrade !== "A3") {
    throw new BehavioralEvidenceError(
      "behavioral_evidence_invalid_owner_attestation",
      "Owner-attestation provenance is valid only for an A3 owner statement.",
    );
  }
  if (["user_statement", "resume", "generated_secondary", "derived_inference"].includes(payload.evidence.origin)
      && ["E2", "E3"].includes(payload.evidence.evidenceGrade)) {
    throw new BehavioralEvidenceError(
      "behavioral_evidence_grade_overstated",
      "Owner statements, resume claims, generated material, and inferences cannot be graded above E1.",
    );
  }
}

export function validateBehavioralClaimWrite(payload: BehavioralClaimWritePayload) {
  assertBehavioralEvidenceRemoteSafe(payload);
  if (!Number.isInteger(payload.expectedRevision) || payload.expectedRevision < 0) {
    throw new BehavioralEvidenceError(
      "behavioral_claim_invalid_expected_revision",
      "expectedRevision must be a non-negative integer.",
    );
  }
  assertStableId(payload.claim.claimId, "claimId");
  assertStableId(payload.claim.questionId, "questionId");
  for (const evidenceId of [...payload.claim.evidenceIds, ...payload.claim.contraryEvidenceIds]) {
    assertStableId(evidenceId, "evidenceId");
  }
  if (new Set(payload.claim.evidenceIds).size !== payload.claim.evidenceIds.length
      || new Set(payload.claim.contraryEvidenceIds).size !== payload.claim.contraryEvidenceIds.length) {
    throw new BehavioralEvidenceError(
      "behavioral_claim_duplicate_evidence",
      "A behavioral claim cannot repeat an evidence identity within one relationship list.",
    );
  }
}
