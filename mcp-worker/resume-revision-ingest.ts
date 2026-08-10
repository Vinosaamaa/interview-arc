import {
  completeResumeImport,
  completeUnchangedResumeImport,
  failResumeImport,
  findResumeRevision,
  findResumeRevisionByFingerprint,
  reserveResumeImport,
  ResumeImportError,
  type ResumeFileFormat,
  type ResumeFileIntegrity,
} from "../db/resume-revisions";
import { privateResumeObjectKey } from "../db/private-resume-object";
import { isDisplaySafeResumeSourceLabel } from "../db/resume-revision-policy";
import { stagePrivateResumePair } from "./private-resume-storage";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_MULTIPART_BYTES = 18 * 1024 * 1024;
const STABLE_ID = /^[a-z0-9][a-z0-9._-]{0,199}$/;
const SHA_256 = /^[a-f0-9]{64}$/;

type ResumeImportBucket = Pick<R2Bucket, "put" | "head" | "delete">;

interface ParsedResumeImport {
  operationId: string;
  resumeId: string;
  revisionId: string;
  sourceLabel: string;
  sourceFingerprint: string;
  docx: { bytes: ArrayBuffer; integrity: ResumeFileIntegrity };
  pdf: { bytes: ArrayBuffer; integrity: ResumeFileIntegrity };
  requestHash: string;
}

async function sha256Hex(value: ArrayBuffer | string) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requiredText(form: FormData, name: string, maximumLength = 200) {
  const value = form.get(name);
  const normalized = typeof value === "string" ? value.normalize("NFKC").trim() : "";
  if (!normalized || normalized.length > maximumLength) {
    throw new ResumeImportError(
      "resume_import_invalid_request",
      `A valid ${name} is required.`,
      400,
      false,
    );
  }
  return normalized;
}

function requireStableId(value: string, name: string) {
  if (!STABLE_ID.test(value)) {
    throw new ResumeImportError(
      "resume_import_invalid_request",
      `${name} must be a lowercase stable ID.`,
      400,
      false,
    );
  }
}

function hasPrefix(bytes: Uint8Array, expected: number[]) {
  return expected.every((byte, index) => bytes[index] === byte);
}

async function parsePrivateFile(
  form: FormData,
  field: ResumeFileFormat,
  mimeType: string,
) {
  const file = form.get(field);
  if (!(file instanceof File)
      || file.type !== mimeType
      || file.size === 0
      || file.size > MAX_FILE_BYTES) {
    throw new ResumeImportError(
      "resume_import_invalid_file",
      `A non-empty ${field.toUpperCase()} file no larger than 8 MB is required.`,
      400,
      false,
    );
  }
  const bytes = await file.arrayBuffer();
  const prefix = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 8));
  const validMagic = field === "docx"
    ? hasPrefix(prefix, [0x50, 0x4b, 0x03, 0x04])
    : hasPrefix(prefix, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  if (!validMagic) {
    throw new ResumeImportError(
      "resume_import_invalid_file",
      `The supplied ${field.toUpperCase()} file does not match its declared format.`,
      400,
      false,
    );
  }
  return {
    bytes,
    integrity: {
      format: field,
      sha256: await sha256Hex(bytes),
      byteSize: bytes.byteLength,
      mimeType,
    } satisfies ResumeFileIntegrity,
  };
}

async function boundedMultipartRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !request.body) {
    throw new ResumeImportError(
      "resume_import_invalid_request",
      "A multipart private resume import is required.",
      400,
      false,
    );
  }
  const declaredHeader = request.headers.get("content-length");
  if (declaredHeader && (!/^\d+$/.test(declaredHeader) || Number(declaredHeader) > MAX_MULTIPART_BYTES)) {
    throw new ResumeImportError(
      "resume_import_request_too_large",
      "The private resume import exceeds the 18 MB request limit.",
      413,
      false,
    );
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_MULTIPART_BYTES) {
      await reader.cancel();
      throw new ResumeImportError(
        "resume_import_request_too_large",
        "The private resume import exceeds the 18 MB request limit.",
        413,
        false,
      );
    }
    chunks.push(value);
  }
  const boundedBody = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    boundedBody.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request.url, {
    method: request.method,
    headers,
    body: boundedBody,
  });
}

async function parseResumeImport(request: Request): Promise<ParsedResumeImport> {
  let form: FormData;
  try {
    form = await (await boundedMultipartRequest(request)).formData();
  } catch (error) {
    if (error instanceof ResumeImportError) throw error;
    throw new ResumeImportError(
      "resume_import_invalid_request",
      "A multipart private resume import is required.",
      400,
      false,
    );
  }
  const operationId = requiredText(form, "operationId");
  const resumeId = requiredText(form, "resumeId");
  const revisionId = requiredText(form, "revisionId");
  requireStableId(operationId, "operationId");
  requireStableId(resumeId, "resumeId");
  requireStableId(revisionId, "revisionId");
  const sourceLabel = requiredText(form, "sourceLabel", 120);
  if (!isDisplaySafeResumeSourceLabel(sourceLabel)) {
    throw new ResumeImportError(
      "resume_import_invalid_request",
      "sourceLabel must be a display-safe label without a private locator or credential.",
      400,
      false,
    );
  }
  const sourceFingerprint = requiredText(form, "sourceFingerprint", 64);
  if (!SHA_256.test(sourceFingerprint)) {
    throw new ResumeImportError(
      "resume_import_invalid_request",
      "sourceFingerprint must be a lowercase SHA-256 digest.",
      400,
      false,
    );
  }
  const docx = await parsePrivateFile(form, "docx", DOCX_MIME);
  const pdf = await parsePrivateFile(form, "pdf", PDF_MIME);
  const requestHash = await sha256Hex(JSON.stringify({
    operationId,
    resumeId,
    revisionId,
    sourceLabel,
    sourceFingerprint,
    docx: docx.integrity,
    pdf: pdf.integrity,
  }));
  return {
    operationId,
    resumeId,
    revisionId,
    sourceLabel,
    sourceFingerprint,
    docx,
    pdf,
    requestHash,
  };
}

async function privateObjectKeys(ownerId: string, input: ParsedResumeImport, storageGeneration: string) {
  return {
    docx: await privateResumeObjectKey({
      ownerId,
      resumeId: input.resumeId,
      revisionId: input.revisionId,
      storageGeneration,
      format: "docx",
    }),
    pdf: await privateResumeObjectKey({
      ownerId,
      resumeId: input.resumeId,
      revisionId: input.revisionId,
      storageGeneration,
      format: "pdf",
    }),
  };
}

export async function ingestResumeRevision(
  ownerId: string,
  request: Request,
  bucket: ResumeImportBucket,
) {
  const input = await parseResumeImport(request);
  const identity = {
    operationId: input.operationId,
    resumeId: input.resumeId,
    revisionId: input.revisionId,
    requestHash: input.requestHash,
  };
  const reservation = await reserveResumeImport(ownerId, identity);
  if (reservation.duplicate) {
    return { status: 200, body: reservation.receipt };
  }

  try {
    const existingRevision = await findResumeRevision(ownerId, input.resumeId, input.revisionId);
    if (existingRevision && existingRevision.sourceFingerprint !== input.sourceFingerprint) {
      await failResumeImport(
        ownerId,
        identity,
        reservation.leaseToken,
        "resume_import_revision_identity_conflict",
        false,
      );
      throw new ResumeImportError(
        "resume_import_revision_identity_conflict",
        "That immutable resume revision ID already belongs to a different source fingerprint.",
        409,
        false,
      );
    }
    const canonical = await findResumeRevisionByFingerprint(
      ownerId,
      input.resumeId,
      input.sourceFingerprint,
    );
    if (canonical) {
      const requestedFiles = new Map([
        ["docx", input.docx.integrity],
        ["pdf", input.pdf.integrity],
      ]);
      const matches = canonical.files.length === 2 && canonical.files.every((file) => {
        const requested = requestedFiles.get(file.format);
        return requested
          && requested.sha256 === file.sha256
          && requested.byteSize === file.byteSize
          && requested.mimeType === file.mimeType;
      });
      if (!matches) {
        await failResumeImport(
          ownerId,
          identity,
          reservation.leaseToken,
          "resume_import_source_fingerprint_conflict",
          false,
        );
        throw new ResumeImportError(
          "resume_import_source_fingerprint_conflict",
          "That source fingerprint already belongs to different private file integrity metadata.",
          409,
          false,
        );
      }
      const unchanged = await completeUnchangedResumeImport(ownerId, identity, reservation.leaseToken, {
        revisionId: canonical.revision.revisionId,
        parentRevisionId: canonical.revision.parentRevisionId,
        sourceFingerprint: canonical.revision.sourceFingerprint,
        importedAt: canonical.revision.importedAt,
        files: canonical.files as [ResumeFileIntegrity, ResumeFileIntegrity],
      });
      return { status: 200, body: unchanged.receipt };
    }

    const keys = await privateObjectKeys(ownerId, input, reservation.leaseToken);
    const staged = await stagePrivateResumePair(bucket, [
      { key: keys.docx, stagingGeneration: reservation.leaseToken, ...input.docx },
      { key: keys.pdf, stagingGeneration: reservation.leaseToken, ...input.pdf },
    ]);
    if (!staged.complete) {
      await failResumeImport(
        ownerId,
        identity,
        reservation.leaseToken,
        "resume_import_storage_unavailable",
        true,
      );
      throw new ResumeImportError(
        "resume_import_storage_unavailable",
        "The private DOCX/PDF pair was not fully staged. Retry the exact operation.",
        503,
        true,
      );
    }

    try {
      const completed = await completeResumeImport(ownerId, {
        ...identity,
        sourceLabel: input.sourceLabel,
        sourceFingerprint: input.sourceFingerprint,
        storageGeneration: reservation.leaseToken,
        files: [input.docx.integrity, input.pdf.integrity],
      }, reservation.leaseToken);
      if (completed.cleanupStaging) {
        await Promise.allSettled([bucket.delete(keys.docx), bucket.delete(keys.pdf)]);
      }
      return { status: completed.duplicate ? 200 : 201, body: completed.receipt };
    } catch (error) {
      if (error instanceof ResumeImportError && !error.retryable) {
        await Promise.allSettled([bucket.delete(keys.docx), bucket.delete(keys.pdf)]);
      }
      throw error;
    }
  } catch (error) {
    if (!(error instanceof ResumeImportError)) {
      await failResumeImport(
        ownerId,
        identity,
        reservation.leaseToken,
        "resume_import_unavailable",
        true,
      ).catch(() => {});
    }
    throw error;
  }
}

export { ResumeImportError };
