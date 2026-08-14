export type PracticeRecordReaderSection =
  | "problem"
  | "attempt_summary"
  | "conversation"
  | "code_attempts"
  | "final_answer"
  | "your_design"
  | "activity_review"
  | "technical_audit";

type ReaderPayload = {
  revision: number;
  specialty: "leetcode" | "system_design" | "behavioral";
  transcript: { revision: number; turnCount: number; firstTurnId: string | null; lastTurnId: string | null };
  notesRevision: number | null;
  specialtyOutput: {
    kind: "code_attempts" | "final_tailored_answer" | "your_design";
    codeAttemptIds: string[];
    finalAnswerRevision: number | null;
    designAssetIds: string[];
  };
  references: Array<unknown>;
  solutionLink: { profileRevision: number };
  assetLinks: Array<unknown>;
  finalizationOperationId: string;
};

export function orderedPracticeRecordSections(
  payload: ReaderPayload,
  available: {
    hasConversation: boolean;
    hasCodeAttempts: boolean;
    hasFinalAnswer: boolean;
    hasDesign: boolean;
  },
): PracticeRecordReaderSection[] {
  const specialtySection = payload.specialtyOutput.kind === "code_attempts"
    ? "code_attempts"
    : payload.specialtyOutput.kind === "final_tailored_answer"
      ? "final_answer"
      : "your_design";
  return [
    "problem",
    "attempt_summary",
    payload.transcript.turnCount > 0 || available.hasConversation ? "conversation" : null,
    specialtySection,
    "activity_review",
    "technical_audit",
  ].filter((section): section is PracticeRecordReaderSection => section !== null);
}

export function practiceRecordTechnicalAudit(receipt: {
  revision: number;
  fingerprint: string;
  operationId: string;
  requestFingerprint: string;
  payload: ReaderPayload;
  createdAt: number;
}) {
  return {
    practiceRecordRevision: receipt.revision,
    fingerprint: receipt.fingerprint,
    operationId: receipt.operationId,
    requestFingerprint: receipt.requestFingerprint,
    transcriptRevision: receipt.payload.transcript.revision,
    transcriptTurnCount: receipt.payload.transcript.turnCount,
    firstTurnId: receipt.payload.transcript.firstTurnId,
    lastTurnId: receipt.payload.transcript.lastTurnId,
    notesRevision: receipt.payload.notesRevision,
    solutionRevisionAtCompletion: receipt.payload.solutionLink.profileRevision,
    codeAttemptCount: receipt.payload.specialtyOutput.codeAttemptIds.length,
    assetCount: receipt.payload.assetLinks.length,
    referenceCount: receipt.payload.references.length,
    finalizationOperationId: receipt.payload.finalizationOperationId,
    createdAt: receipt.createdAt,
  };
}
