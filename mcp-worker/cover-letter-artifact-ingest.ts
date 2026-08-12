import {
  completeCoverLetterArtifact,
  CoverLetterArtifactError,
  reserveCoverLetterArtifact,
  type CoverLetterArtifactInput,
  type CoverLetterFileFormat,
  type CoverLetterFileIntegrity,
} from "../db/cover-letter-artifacts";
import { privateCoverLetterObjectKey } from "../db/private-cover-letter-object";
import { isDisplaySafeResumeSourceLabel } from "../db/resume-revision-policy";
import { stagePrivateCoverLetterPair } from "./cover-letter-artifact-storage";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_MULTIPART_BYTES = 18 * 1024 * 1024;
const STABLE_ID = /^[a-z0-9][a-z0-9._-]{0,199}$/;
const SHA_256 = /^[a-f0-9]{64}$/;
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,179}\.(docx|pdf)$/i;

type CoverLetterBucket = Pick<R2Bucket, "put" | "head" | "delete">;

interface ParsedCoverLetterImport {
  input: CoverLetterArtifactInput;
  docx: { bytes: ArrayBuffer; integrity: CoverLetterFileIntegrity };
  pdf: { bytes: ArrayBuffer; integrity: CoverLetterFileIntegrity };
}

async function sha256Hex(value: ArrayBuffer | string) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requiredText(form: FormData, name: string, maximumLength = 200) {
  const values = form.getAll(name);
  const value = values.length === 1 && typeof values[0] === "string"
    ? values[0].normalize("NFKC").trim()
    : "";
  if (!value || value.length > maximumLength) throw new CoverLetterArtifactError(
    "cover_letter_invalid_request",
    `A valid ${name} is required.`,
    400,
    false,
  );
  return value;
}

function optionalText(form: FormData, name: string, maximumLength = 2_048) {
  const values = form.getAll(name);
  if (values.length === 0) return null;
  if (values.length !== 1 || typeof values[0] !== "string") throw new CoverLetterArtifactError(
    "cover_letter_invalid_request",
    `${name} must be supplied at most once.`,
    400,
    false,
  );
  const value = values[0].normalize("NFKC").trim();
  if (!value || value.length > maximumLength) throw new CoverLetterArtifactError(
    "cover_letter_invalid_request",
    `${name} is outside the supported size.`,
    400,
    false,
  );
  return value;
}

function requireStableId(value: string, name: string) {
  if (!STABLE_ID.test(value)) throw new CoverLetterArtifactError(
    "cover_letter_invalid_request",
    `${name} must be a lowercase stable ID.`,
    400,
    false,
  );
}

function requireSha256(value: string, name: string) {
  if (!SHA_256.test(value)) throw new CoverLetterArtifactError(
    "cover_letter_invalid_request",
    `${name} must be a lowercase SHA-256 digest.`,
    400,
    false,
  );
}

function publicSourceUrl(value: string | null) {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CoverLetterArtifactError("cover_letter_invalid_request", "sourceUrl must be a public HTTP(S) URL.", 400, false);
  }
  const hostname = url.hostname.toLowerCase();
  const sensitive = [...url.searchParams.keys()].some((key) => /(?:token|secret|password|signature|auth|api[_-]?key)/i.test(key));
  if (!['http:', 'https:'].includes(url.protocol)
      || url.username || url.password || sensitive
      || hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".localhost")
      || hostname.startsWith("[") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
    throw new CoverLetterArtifactError("cover_letter_invalid_request", "sourceUrl must be a credential-free public HTTP(S) URL.", 400, false);
  }
  return url.toString();
}

function hasPrefix(bytes: Uint8Array, expected: number[]) {
  return expected.every((byte, index) => bytes[index] === byte);
}

async function parsePrivateFile(form: FormData, format: CoverLetterFileFormat, mimeType: string) {
  const values = form.getAll(format);
  const file = values.length === 1 ? values[0] : null;
  if (!(file instanceof File)
      || file.type !== mimeType
      || file.size === 0
      || file.size > MAX_FILE_BYTES
      || !SAFE_FILENAME.test(file.name)
      || !file.name.toLowerCase().endsWith(`.${format}`)) {
    throw new CoverLetterArtifactError(
      "cover_letter_invalid_file",
      `A valid ${format.toUpperCase()} file no larger than 8 MB is required.`,
      400,
      false,
    );
  }
  const bytes = await file.arrayBuffer();
  const prefix = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 8));
  const validMagic = format === "docx"
    ? hasPrefix(prefix, [0x50, 0x4b, 0x03, 0x04])
    : hasPrefix(prefix, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  if (!validMagic) throw new CoverLetterArtifactError(
    "cover_letter_invalid_file",
    `The supplied ${format.toUpperCase()} file does not match its declared format.`,
    400,
    false,
  );
  return {
    bytes,
    integrity: {
      format,
      sha256: await sha256Hex(bytes),
      byteSize: bytes.byteLength,
      mimeType,
      filename: file.name,
    } satisfies CoverLetterFileIntegrity,
  };
}

async function boundedMultipartRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !request.body) throw new CoverLetterArtifactError(
    "cover_letter_invalid_request",
    "A multipart private cover-letter import is required.",
    400,
    false,
  );
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_MULTIPART_BYTES)) throw new CoverLetterArtifactError(
    "cover_letter_request_too_large",
    "The private cover-letter import exceeds the 18 MB request limit.",
    413,
    false,
  );
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_MULTIPART_BYTES) {
      await reader.cancel();
      throw new CoverLetterArtifactError("cover_letter_request_too_large", "The private cover-letter import exceeds the 18 MB request limit.", 413, false);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request.url, { method: request.method, headers, body });
}

async function parseImport(request: Request): Promise<ParsedCoverLetterImport> {
  let form: FormData;
  try {
    form = await (await boundedMultipartRequest(request)).formData();
  } catch (error) {
    if (error instanceof CoverLetterArtifactError) throw error;
    throw new CoverLetterArtifactError("cover_letter_invalid_request", "A multipart private cover-letter import is required.", 400, false);
  }
  const allowed = new Set([
    "operationId", "artifactId", "lineageId", "parentRevisionId", "company", "role", "sourceUrl",
    "jobDescriptionSha256", "resumeId", "resumeRevisionId", "evidenceFingerprint", "qualityAttestation",
    "docx", "pdf",
  ]);
  for (const key of form.keys()) if (!allowed.has(key)) throw new CoverLetterArtifactError(
    "cover_letter_invalid_request",
    "The cover-letter import contains an unsupported field.",
    400,
    false,
  );

  const operationId = requiredText(form, "operationId");
  const artifactId = requiredText(form, "artifactId");
  const lineageId = requiredText(form, "lineageId");
  const parentRevisionId = optionalText(form, "parentRevisionId", 200);
  const resumeId = requiredText(form, "resumeId");
  const resumeRevisionId = requiredText(form, "resumeRevisionId");
  for (const [value, name] of [[operationId, "operationId"], [artifactId, "artifactId"], [lineageId, "lineageId"], [resumeId, "resumeId"], [resumeRevisionId, "resumeRevisionId"]] as const) requireStableId(value, name);
  if (parentRevisionId) requireStableId(parentRevisionId, "parentRevisionId");
  const company = requiredText(form, "company", 180);
  const role = requiredText(form, "role", 180);
  if (!isDisplaySafeResumeSourceLabel(company) || !isDisplaySafeResumeSourceLabel(role)) throw new CoverLetterArtifactError(
    "cover_letter_invalid_request",
    "Company and role must be display-safe labels without private locators or credentials.",
    400,
    false,
  );
  const sourceUrl = publicSourceUrl(optionalText(form, "sourceUrl"));
  const jobDescriptionSha256 = requiredText(form, "jobDescriptionSha256", 64);
  const evidenceFingerprint = requiredText(form, "evidenceFingerprint", 64);
  requireSha256(jobDescriptionSha256, "jobDescriptionSha256");
  requireSha256(evidenceFingerprint, "evidenceFingerprint");
  const qualityValue = requiredText(form, "qualityAttestation", 2_000);
  let quality: Record<string, unknown>;
  try {
    quality = JSON.parse(qualityValue) as Record<string, unknown>;
  } catch {
    throw new CoverLetterArtifactError("cover_letter_quality_gate_failed", "The document quality attestation is invalid.", 400, false);
  }
  const qualityKeys = Object.keys(quality).sort();
  const expectedQualityKeys = [
    "contentScore",
    "factualityFullCredit",
    "inspectedAt",
    "pageCount",
    "specificityFullCredit",
    "visuallyInspected",
  ];
  if ((quality.contentScore !== 10 && quality.contentScore !== 11 && quality.contentScore !== 12)
      || quality.factualityFullCredit !== true
      || quality.specificityFullCredit !== true
      || quality.pageCount !== 1
      || quality.visuallyInspected !== true
      || !Number.isInteger(quality.inspectedAt)
      || Number(quality.inspectedAt) <= 0
      || JSON.stringify(qualityKeys) !== JSON.stringify(expectedQualityKeys)) {
    throw new CoverLetterArtifactError("cover_letter_quality_gate_failed", "The cover letter has not passed the required content and one-page visual quality gates.", 400, false);
  }

  const docx = await parsePrivateFile(form, "docx", DOCX_MIME);
  const pdf = await parsePrivateFile(form, "pdf", PDF_MIME);
  const requestFingerprint = await sha256Hex(JSON.stringify({
    operationId,
    artifactId,
    lineageId,
    parentRevisionId,
    company,
    role,
    sourceUrl,
    jobDescriptionSha256,
    resumeId,
    resumeRevisionId,
    evidenceFingerprint,
    quality,
    docx: docx.integrity,
    pdf: pdf.integrity,
  }));
  return {
    input: {
      operationId,
      artifactId,
      lineageId,
      parentRevisionId,
      requestFingerprint,
      company,
      role,
      sourceUrl,
      jobDescriptionSha256,
      resumeId,
      resumeRevisionId,
      evidenceFingerprint,
    },
    docx,
    pdf,
  };
}

export async function ingestCoverLetterArtifact(ownerId: string, request: Request, bucket: CoverLetterBucket) {
  const parsed = await parseImport(request);
  const reservation = await reserveCoverLetterArtifact(ownerId, parsed.input);
  if (reservation.row.state !== "pending") return { status: 200, body: reservation.receipt };
  const storageGeneration = reservation.row.storageGeneration;
  const keys = {
    docx: await privateCoverLetterObjectKey({ ownerId, artifactId: parsed.input.artifactId, storageGeneration, format: "docx" }),
    pdf: await privateCoverLetterObjectKey({ ownerId, artifactId: parsed.input.artifactId, storageGeneration, format: "pdf" }),
  };
  const staged = await stagePrivateCoverLetterPair(bucket, [
    { key: keys.docx, storageGeneration, ...parsed.docx },
    { key: keys.pdf, storageGeneration, ...parsed.pdf },
  ]);
  if (!staged.complete) throw new CoverLetterArtifactError(
    "cover_letter_storage_unavailable",
    "The private DOCX/PDF pair was not fully staged. Retry the exact operation.",
    503,
    true,
  );
  try {
    const receipt = await completeCoverLetterArtifact(
      ownerId,
      parsed.input,
      storageGeneration,
      [parsed.docx.integrity, parsed.pdf.integrity],
    );
    return { status: reservation.duplicate ? 200 : 201, body: receipt };
  } catch (error) {
    if (error instanceof CoverLetterArtifactError && !error.retryable) {
      await Promise.allSettled([bucket.delete(keys.docx), bucket.delete(keys.pdf)]);
    }
    throw error;
  }
}
