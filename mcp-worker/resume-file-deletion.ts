import { privateResumeObjectKey } from "../db/private-resume-object";
import {
  completeResumeRevisionFileDeletion,
  failResumeRevisionFileDeletion,
  reserveResumeRevisionFileDeletion,
  ResumeImportError,
} from "../db/resume-revisions";
import {
  resumeFileDeletionRequestSchema,
  resumeFileDeletionStableIdSchema,
} from "../db/resume-file-deletion-contract";
import { deleteAndVerifyPrivateResumePair } from "./private-resume-deletion-storage";

type ResumeDeletionBucket = Pick<R2Bucket, "delete" | "head">;

export async function deletePrivateResumeRevisionFiles(
  ownerId: string,
  resumeId: string,
  revisionId: string,
  request: Request,
  bucket: ResumeDeletionBucket,
) {
  if (!resumeFileDeletionStableIdSchema.safeParse(resumeId).success
      || !resumeFileDeletionStableIdSchema.safeParse(revisionId).success) {
    throw new ResumeImportError(
      "resume_revision_files_not_found",
      "That complete owner-private resume file pair is unavailable.",
      404,
      false,
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ResumeImportError(
      "resume_file_deletion_invalid_request",
      "A stable operation ID, explicit authorization, and audit reason are required.",
      400,
      false,
    );
  }
  const parsed = resumeFileDeletionRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ResumeImportError(
      "resume_file_deletion_invalid_request",
      "A stable operation ID, explicit authorization, and audit reason are required.",
      400,
      false,
    );
  }
  const input = { ...parsed.data, resumeId, revisionId };
  const reservation = await reserveResumeRevisionFileDeletion(ownerId, input);
  if (reservation.duplicate) return reservation.receipt;

  const keys = await Promise.all(reservation.files.map((file) => privateResumeObjectKey({
    ownerId,
    resumeId,
    revisionId,
    storageGeneration: reservation.storageGeneration,
    format: file.format,
  }))) as [string, string];
  if (!await deleteAndVerifyPrivateResumePair(bucket, keys)) {
    await failResumeRevisionFileDeletion(
      ownerId,
      input.operationId,
      reservation.requestFingerprint,
      "resume_file_deletion_storage_failure",
    );
    throw new ResumeImportError(
      "resume_file_deletion_storage_failure",
      "The private resume file pair was not fully removed. Retry the exact operation receipt.",
      503,
      true,
    );
  }

  try {
    return await completeResumeRevisionFileDeletion(
      ownerId,
      input,
      reservation.requestFingerprint,
    );
  } catch {
    await failResumeRevisionFileDeletion(
      ownerId,
      input.operationId,
      reservation.requestFingerprint,
      "resume_file_deletion_commit_unavailable",
    );
    throw new ResumeImportError(
      "resume_file_deletion_commit_unavailable",
      "The private files were removed, but the durable receipt needs an exact retry.",
      503,
      true,
    );
  }
}
