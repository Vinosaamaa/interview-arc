export const EVIDENCE_SOURCE_REVISION_PATTERN = /^source-set-[a-f0-9]{64}$/;
export const EVIDENCE_IMMUTABLE_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

export function evidenceProvenanceViolations(evidence) {
  const violations = [];
  if (
    evidence.sourceRevision !== undefined
    && !EVIDENCE_SOURCE_REVISION_PATTERN.test(evidence.sourceRevision)
  ) {
    violations.push({
      field: "sourceRevision",
      message: "must be an immutable source-set digest",
    });
  }
  if (evidence.origin === "user_statement" && evidence.sourceRevision !== undefined) {
    violations.push({
      field: "sourceRevision",
      message: "owner statements use exact conversation attestation instead of a source revision",
    });
  }
  if (
    evidence.immutableContentFingerprint !== undefined
    && !EVIDENCE_IMMUTABLE_FINGERPRINT_PATTERN.test(evidence.immutableContentFingerprint)
  ) {
    violations.push({
      field: "immutableContentFingerprint",
      message: "must be a SHA-256 digest",
    });
  }
  return violations;
}

export function assertEvidenceProvenanceShape(evidence) {
  const [violation] = evidenceProvenanceViolations(evidence);
  if (violation) throw new Error(`Evidence ${violation.field} ${violation.message}.`);
}
