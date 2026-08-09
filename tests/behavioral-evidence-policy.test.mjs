import assert from "node:assert/strict";
import test from "node:test";

import {
  assertBehavioralEvidenceRemoteSafe,
  validateBehavioralClaimWrite,
  validateBehavioralEvidenceWrite,
} from "../db/behavioral-evidence-policy.ts";

function evidencePayload() {
  return {
    evidence: {
      evidenceId: "evidence-safe-1",
      projectKey: "example-project",
      origin: "user_statement",
      statement: "I confirmed one exact personal contribution.",
      evidenceGrade: "E1",
      attributionGrade: "A3",
      claimStrength: "personal_contribution_candidate",
      candidateState: "accepted",
      safeProvenance: [{ kind: "conversation", reference: "behavioral-confirmation-1" }],
      supports: ["The scoped contribution is owner-attested."],
      limitations: ["No production result is established."],
      tags: ["ownership"],
      ownerAttestation: {
        activityId: "activity-safe-1",
        userTurnId: "turn-safe-1",
        confirmedAt: 1,
      },
    },
    questionLink: { questionId: "question-safe-1", relevance: "supporting" },
  };
}

test("sanitized owner-attested evidence passes pre-enqueue validation", () => {
  assert.doesNotThrow(() => validateBehavioralEvidenceWrite(evidencePayload()));
});

test("remote-safety validation rejects locator and identity classes without echoing them", () => {
  const unsafeValues = [
    "/Users/example/private/project",
    "Source:\n/Users/example/private/project",
    "path=/root/private/project",
    "/private/tmp/private-project",
    "~/private/resume.pdf",
    "../private/resume.pdf",
    "private-sources/employer/dossier.md",
    String.raw`C:\Users\example\private\project`,
    String.raw`\\server\private\project`,
    "person@example.test",
    "https://private.example.test/repository",
    "git@example.test:private/repository.git",
    "-----BEGIN PRIVATE KEY-----",
    "Bearer secret-token-value",
    "sk-proj-privatecredentialvalue",
    "AKIA1234567890ABCDEF",
    "123-45-6789",
  ];
  for (const unsafe of unsafeValues) {
    assert.throws(
      () => assertBehavioralEvidenceRemoteSafe({ statement: unsafe }),
      (error) => error.code === "behavioral_evidence_unsafe_payload"
        && !error.message.includes(unsafe),
    );
  }
});

test("A3 stays an atomic E1 owner statement with exact attestation provenance", () => {
  const base = evidencePayload();
  assert.throws(
    () => validateBehavioralEvidenceWrite({
      ...base,
      evidence: { ...base.evidence, ownerAttestation: undefined },
    }),
    (error) => error.code === "behavioral_evidence_owner_attestation_required",
  );
  assert.throws(
    () => validateBehavioralEvidenceWrite({
      ...base,
      evidence: {
        ...base.evidence,
        origin: "document",
        sourceRevision: "document-revision-1",
        safeProvenance: [{ kind: "document_observation", reference: "document-observation-1" }],
      },
    }),
    (error) => error.code === "behavioral_evidence_invalid_a3_origin",
  );
  assert.throws(
    () => validateBehavioralEvidenceWrite({
      ...base,
      evidence: { ...base.evidence, evidenceGrade: "E3" },
    }),
    (error) => error.code === "behavioral_evidence_grade_overstated",
  );
});

test("claim payloads reject duplicate evidence identities before enqueue", () => {
  assert.throws(
    () => validateBehavioralClaimWrite({
      expectedRevision: 0,
      claim: {
        claimId: "claim-safe-1",
        questionId: "question-safe-1",
        text: "I confirmed one exact personal contribution.",
        scope: "personal_contribution",
        status: "partial",
        claimStrength: "personal_contribution_candidate",
        evidenceIds: ["evidence-safe-1", "evidence-safe-1"],
        contraryEvidenceIds: [],
        gaps: [],
        tags: [],
      },
    }),
    (error) => error.code === "behavioral_claim_duplicate_evidence",
  );
});

test("non-conversation evidence requires matching sanitized provenance and revision", () => {
  const base = evidencePayload();
  assert.throws(
    () => validateBehavioralEvidenceWrite({
      ...base,
      evidence: {
        ...base.evidence,
        origin: "document",
        attributionGrade: "A0",
        ownerAttestation: undefined,
        safeProvenance: [{ kind: "conversation", reference: "source-safe-1" }],
      },
    }),
    (error) => error.code === "behavioral_evidence_provenance_mismatch",
  );
  assert.throws(
    () => validateBehavioralEvidenceWrite({
      ...base,
      evidence: {
        ...base.evidence,
        origin: "document",
        attributionGrade: "A0",
        ownerAttestation: undefined,
        safeProvenance: [{ kind: "document_observation", reference: "source-safe-1" }],
      },
    }),
    (error) => error.code === "behavioral_evidence_source_revision_required",
  );
});
