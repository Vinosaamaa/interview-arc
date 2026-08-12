#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

const DEFAULT_MCP_ENDPOINT = "https://limitless-mcp.vinosama.workers.dev/mcp";
const DEFAULT_IMPORT_ENDPOINT = "https://limitless-mcp.vinosama.workers.dev/cover-letter/imports";
const MAX_MANIFEST_BYTES = 512_000;
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const MAX_JOB_DESCRIPTION_BYTES = 200_000;
const MAX_RECEIPT_BYTES = 256 * 1024;
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const artifactId = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,199}$/);
const resumeId = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,199}$/);
const safeDisplay = z.string().trim().min(1).max(180)
  .transform((value) => value.normalize("NFKC"))
  .pipe(z.string().min(1).max(180));
const stableReference = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,199}$/);
const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);
const privateDownloadPath = z.string().regex(/^\/api\/career-materials\/cover-letters\/[a-z0-9._-]+\/(docx|pdf)$/);

function isPublicPostingUrl(value) {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const hasSensitiveParameter = [...url.searchParams.keys()]
    .some((key) => /(?:^|[_-])(token|secret|password|signature|auth|api[_-]?key)(?:$|[_-])/i.test(key));
  return ["http:", "https:"].includes(url.protocol)
    && !url.username
    && !url.password
    && hostname !== "localhost"
    && !hostname.endsWith(".localhost")
    && !hostname.endsWith(".local")
    && !hostname.startsWith("[")
    && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
    && !hasSensitiveParameter;
}

const publicPostingUrl = z.string().url().max(2_048).refine(isPublicPostingUrl)
  .transform((value) => new URL(value).toString());
const artifactFileReceiptSchema = z.object({
  format: z.enum(["docx", "pdf"]),
  sha256: sha256Hex,
  byteSize: z.number().int().positive().max(MAX_DOCUMENT_BYTES),
  mimeType: z.enum([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/pdf",
  ]),
  filename: z.string().trim().min(1).max(180),
  downloadPath: privateDownloadPath,
}).strict();
const arcArtifactReceiptSchema = z.object({
  id: artifactId,
  lineageId: artifactId,
  parentRevisionId: artifactId.nullable(),
  company: safeDisplay,
  role: safeDisplay,
  sourceUrl: publicPostingUrl.nullable(),
  state: z.enum(["pending", "ready", "superseded"]),
  jobDescriptionSha256: sha256Hex,
  resumeId,
  resumeRevisionId: resumeId,
  evidenceFingerprint: sha256Hex,
  createdAt: z.string().datetime({ offset: true }),
  readyAt: z.string().datetime({ offset: true }).nullable(),
  supersededAt: z.string().datetime({ offset: true }).nullable(),
  files: z.array(artifactFileReceiptSchema).max(2),
}).strict().superRefine((artifact, context) => {
  if (artifact.state !== "pending") {
    const formats = new Set(artifact.files.map((file) => file.format));
    if (formats.size !== 2 || !formats.has("docx") || !formats.has("pdf")) {
      context.addIssue({ code: "custom", path: ["files"], message: "Saved artifacts require a complete DOCX/PDF pair." });
    }
  }
  if (artifact.state === "ready" && artifact.readyAt === null) {
    context.addIssue({ code: "custom", path: ["readyAt"], message: "A ready artifact requires readyAt." });
  }
});
const arcCreateReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  operationId: artifactId,
  status: z.enum(["staging", "saved"]),
  artifact: arcArtifactReceiptSchema,
}).strict();

export const coverLetterPublishManifestSchema = z.object({
  schemaVersion: z.literal(1),
  artifactId: artifactId.optional(),
  lineageId: artifactId.optional(),
  parentRevisionId: artifactId.optional(),
  operationId: artifactId.optional(),
  company: safeDisplay,
  role: safeDisplay,
  sourceUrl: publicPostingUrl.optional(),
  jobDescription: z.string().min(120).max(MAX_JOB_DESCRIPTION_BYTES),
  resumeId,
  resumeRevisionId: resumeId,
  docxPath: z.string().min(1).max(4_096),
  docxFilename: z.string().trim().min(1).max(180).default("cover-letter.docx"),
  pdfPath: z.string().min(1).max(4_096),
  pdfFilename: z.string().trim().min(1).max(180).default("cover-letter.pdf"),
  evidenceChecks: z.array(z.object({
    questionId: stableReference,
    claimIds: z.array(stableReference).min(1).max(40),
    evidenceIds: z.array(stableReference).min(1).max(80),
    excludedGapClaimIds: z.array(stableReference).max(40).default([]),
  }).strict()).max(20).default([]),
  qualityGate: z.object({
    contentScore: z.number().int().min(10).max(12),
    factualityFullCredit: z.literal(true),
    specificityFullCredit: z.literal(true),
    pageCount: z.literal(1),
    visuallyInspected: z.literal(true),
    inspectedAt: z.number().int().positive(),
  }).strict(),
  disposeFilesAfterSuccess: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (value.parentRevisionId && !value.lineageId) {
    context.addIssue({
      code: "custom",
      path: ["lineageId"],
      message: "A child revision requires its existing lineageId.",
    });
  }
  if (new TextEncoder().encode(value.jobDescription.trim()).byteLength > MAX_JOB_DESCRIPTION_BYTES) {
    context.addIssue({
      code: "custom",
      path: ["jobDescription"],
      message: "The complete job description exceeds the private import bound.",
    });
  }
  for (const [index, check] of value.evidenceChecks.entries()) {
    for (const field of ["claimIds", "evidenceIds", "excludedGapClaimIds"]) {
      if (new Set(check[field]).size !== check[field].length) {
        context.addIssue({ code: "custom", path: ["evidenceChecks", index, field], message: `${field} must be unique.` });
      }
    }
    if (check.excludedGapClaimIds.some((claimId) => !check.claimIds.includes(claimId))) {
      context.addIssue({ code: "custom", path: ["evidenceChecks", index, "excludedGapClaimIds"], message: "Excluded gaps must belong to declared claims." });
    }
  }
  const questionIds = value.evidenceChecks.map((check) => check.questionId);
  if (new Set(questionIds).size !== questionIds.length) {
    context.addIssue({ code: "custom", path: ["evidenceChecks"], message: "Each questionId may appear only once." });
  }
});

export class CoverLetterPublishError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.name = "CoverLetterPublishError";
    this.code = code;
    this.retryable = retryable;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validateHttpsEndpoint(value, label) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new CoverLetterPublishError("cover_letter_endpoint_invalid", `${label} is invalid.`);
  }
  const local = endpoint.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !local) {
    throw new CoverLetterPublishError("cover_letter_endpoint_invalid", `${label} must use HTTPS or loopback HTTP.`);
  }
  return endpoint;
}

function normalizedIdentity(manifest, docxSha256, pdfSha256, jobDescriptionSha256) {
  return JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    company: manifest.company,
    role: manifest.role,
    sourceUrl: manifest.sourceUrl ?? null,
    jobDescriptionSha256,
    resumeId: manifest.resumeId,
    resumeRevisionId: manifest.resumeRevisionId,
    parentRevisionId: manifest.parentRevisionId ?? null,
    docxSha256,
    pdfSha256,
  });
}

export function resolveArtifactIdentity(manifest, docxSha256, pdfSha256, jobDescriptionSha256) {
  const digest = sha256(normalizedIdentity(manifest, docxSha256, pdfSha256, jobDescriptionSha256));
  const resolvedArtifactId = manifest.artifactId ?? `cover-letter-${digest.slice(0, 32)}`;
  return {
    artifactId: resolvedArtifactId,
    lineageId: manifest.lineageId ?? resolvedArtifactId,
    operationId: manifest.operationId ?? `cover-letter-save-${digest.slice(0, 32)}`,
  };
}

async function readBoundedRegularFile(filePath, maximumBytes, description) {
  let metadata;
  try {
    metadata = await lstat(filePath);
  } catch {
    throw new CoverLetterPublishError("cover_letter_file_unavailable", `${description} is unavailable.`);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > maximumBytes) {
    throw new CoverLetterPublishError("cover_letter_file_invalid", `${description} must be a bounded regular file.`);
  }
  return readFile(filePath);
}

async function readManifest(manifestPath) {
  const bytes = await readBoundedRegularFile(manifestPath, MAX_MANIFEST_BYTES, "The private publish manifest");
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new CoverLetterPublishError("cover_letter_manifest_invalid", "The private publish manifest is not valid JSON.");
  }
  const parsed = coverLetterPublishManifestSchema.safeParse(value);
  if (!parsed.success) {
    throw new CoverLetterPublishError(
      "cover_letter_manifest_invalid",
      "The private publish manifest does not satisfy the bounded publication contract.",
    );
  }
  return parsed.data;
}

function structuredResult(result, toolName) {
  if (result.isError) {
    const code = typeof result.structuredContent?.code === "string"
      ? result.structuredContent.code
      : "cover_letter_arc_read_failed";
    throw new CoverLetterPublishError(code, `${toolName} could not verify owner-private state.`, true);
  }
  if (!result.structuredContent || typeof result.structuredContent !== "object") {
    throw new CoverLetterPublishError("cover_letter_arc_receipt_invalid", `${toolName} returned an invalid receipt.`, true);
  }
  return result.structuredContent;
}

export function validateEvidencePreflight(check, preflight) {
  const claims = Array.isArray(preflight?.claims) ? preflight.claims : [];
  const supportingItems = Array.isArray(preflight?.supportingEvidence) ? preflight.supportingEvidence : [];
  const contraryItems = Array.isArray(preflight?.contraryEvidence) ? preflight.contraryEvidence : [];
  const supportingEvidence = new Set(
    supportingItems
      .map((item) => item?.evidenceId)
      .filter((value) => typeof value === "string"),
  );
  const contraryEvidence = new Set(
    contraryItems
      .map((item) => item?.evidenceId)
      .filter((value) => typeof value === "string"),
  );
  const gaps = Array.isArray(preflight?.gaps) ? preflight.gaps : [];
  const linkedEvidence = new Set();
  for (const claimId of check.claimIds) {
    const claim = claims.find((item) => item?.claimId === claimId);
    if (!claim || claim.status !== "verified") {
      throw new CoverLetterPublishError(
        "cover_letter_claim_not_verified",
        "A declared cover-letter claim is not verified for this owner and question.",
      );
    }
    const claimEvidenceIds = Array.isArray(claim.evidenceIds) ? claim.evidenceIds : [];
    if (claimEvidenceIds.length === 0) {
      throw new CoverLetterPublishError(
        "cover_letter_evidence_not_accepted",
        "A declared cover-letter claim has no accepted supporting evidence.",
      );
    }
    for (const evidenceId of claimEvidenceIds) {
      if (!supportingEvidence.has(evidenceId) || !check.evidenceIds.includes(evidenceId)) {
        throw new CoverLetterPublishError(
          "cover_letter_evidence_not_accepted",
          "A declared cover-letter claim lacks its accepted supporting evidence.",
        );
      }
      linkedEvidence.add(evidenceId);
    }
    const hasContrary = (Array.isArray(claim.contraryEvidenceIds) ? claim.contraryEvidenceIds : [])
      .some((evidenceId) => contraryEvidence.has(evidenceId))
      || contraryItems.some((item) => item?.claimId === claimId);
    if (hasContrary) {
      throw new CoverLetterPublishError(
        "cover_letter_claim_has_contrary_evidence",
        "A declared cover-letter claim has accepted contrary evidence.",
      );
    }
    const hasGap = gaps.some((gap) => gap?.claimId === claimId);
    if (hasGap && !check.excludedGapClaimIds.includes(claimId)) {
      throw new CoverLetterPublishError(
        "cover_letter_gap_not_excluded",
        "A declared claim has an unresolved gap that was not explicitly excluded from the letter.",
      );
    }
  }
  for (const evidenceId of check.evidenceIds) {
    if (!supportingEvidence.has(evidenceId) || !linkedEvidence.has(evidenceId)) {
      throw new CoverLetterPublishError(
        "cover_letter_evidence_not_accepted",
        "A declared evidence item is not accepted supporting evidence for this question.",
      );
    }
  }
}

async function connectArc(endpoint, token) {
  if (!token || token.startsWith("Bearer ")) {
    throw new CoverLetterPublishError("cover_letter_arc_auth_required", "INTERVIEW_ARC_MCP_TOKEN is required as a raw token.");
  }
  const client = new Client({ name: "interview-arc-cover-letter-controller", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  }));
  return client;
}

async function verifyArcState(client, manifest) {
  const resume = structuredResult(await client.callTool({
    name: "get_resume_revision",
    arguments: { resumeId: manifest.resumeId, revisionId: manifest.resumeRevisionId },
  }), "get_resume_revision");
  if (
    resume.found !== true
    || resume.source?.resumeId !== manifest.resumeId
    || resume.revision?.revisionId !== manifest.resumeRevisionId
  ) {
    throw new CoverLetterPublishError(
      "cover_letter_resume_revision_not_found",
      "The exact owner-private resume revision is not authoritatively readable.",
    );
  }

  const evidenceReads = await Promise.all(manifest.evidenceChecks.map(async (check) => {
    const preflight = structuredResult(await client.callTool({
      name: "query_behavioral_evidence",
      arguments: { questionId: check.questionId },
    }), "query_behavioral_evidence");
    return { check, preflight };
  }));
  const evidenceSummary = [];
  for (const { check, preflight } of evidenceReads) {
    validateEvidencePreflight(check, preflight);
    evidenceSummary.push({
      questionId: check.questionId,
      claimIds: [...check.claimIds],
      evidenceIds: [...check.evidenceIds],
      excludedGapClaimIds: [...check.excludedGapClaimIds],
      gapFingerprints: (Array.isArray(preflight.gaps) ? preflight.gaps : [])
        .filter((gap) => check.claimIds.includes(gap?.claimId) && typeof gap?.text === "string")
        .map((gap) => sha256(gap.text)),
    });
  }
  return {
    generation: sha256(JSON.stringify({
      resume,
      evidenceReads: evidenceReads.map(({ check, preflight }) => ({
        questionId: check.questionId,
        preflight,
      })),
    })),
    resume: {
      resumeId: manifest.resumeId,
      revisionId: manifest.resumeRevisionId,
      current: resume.revision.current === true,
      sourceLabel: typeof resume.source.sourceLabel === "string" ? resume.source.sourceLabel : "Private resume",
    },
    evidenceSummary,
  };
}

function arcImportHeaders(token) {
  if (!token || token.startsWith("Bearer ")) {
    throw new CoverLetterPublishError("cover_letter_arc_auth_required", "INTERVIEW_ARC_MCP_TOKEN is required as a raw token.");
  }
  return { authorization: `Bearer ${token}`, accept: "application/json" };
}

async function readArcJson(response) {
  try {
    const contentLength = response.headers.get("content-length");
    const declaredLength = contentLength === null ? null : Number(contentLength);
    if (declaredLength !== null && Number.isFinite(declaredLength) && declaredLength > MAX_RECEIPT_BYTES) {
      throw new Error("oversized");
    }
    if (!response.body) throw new Error("missing");
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_RECEIPT_BYTES) {
          await reader.cancel();
          throw new Error("oversized");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new CoverLetterPublishError(
      "cover_letter_arc_receipt_invalid",
      "Interview Arc returned an invalid operation receipt.",
      true,
    );
  }
}

export function validateArcReceipt(value, identity, manifest, integrity, jobDescriptionSha256, evidenceFingerprint) {
  const parsed = arcCreateReceiptSchema.safeParse(value);
  if (!parsed.success) {
    throw new CoverLetterPublishError(
      "cover_letter_arc_receipt_invalid",
      "Interview Arc returned a malformed or partial operation receipt.",
      true,
    );
  }
  const receipt = parsed.data;
  const artifact = receipt.artifact;
  if (
    artifact.id !== identity.artifactId
    || artifact.lineageId !== identity.lineageId
    || artifact.parentRevisionId !== (manifest.parentRevisionId ?? null)
    || artifact.company !== manifest.company
    || artifact.role !== manifest.role
    || artifact.sourceUrl !== (manifest.sourceUrl ?? null)
    || artifact.resumeId !== manifest.resumeId
    || artifact.resumeRevisionId !== manifest.resumeRevisionId
    || artifact.jobDescriptionSha256 !== jobDescriptionSha256
    || artifact.evidenceFingerprint !== evidenceFingerprint
    || receipt.operationId !== identity.operationId
  ) {
    throw new CoverLetterPublishError(
      "cover_letter_arc_receipt_mismatch",
      "Interview Arc returned a receipt for different immutable input.",
    );
  }
  if (receipt.status === "saved") {
    const expected = new Map(Object.entries(integrity));
    const matches = artifact.files.length === 2 && artifact.files.every((file) => {
      const wanted = expected.get(file.format);
      return wanted
        && wanted.sha256 === file.sha256
        && wanted.byteSize === file.byteSize
        && wanted.filename === file.filename;
    });
    if (!matches) throw new CoverLetterPublishError(
      "cover_letter_arc_receipt_mismatch",
      "Interview Arc returned different private file integrity metadata.",
    );
  }
  return receipt;
}

async function readArcOperation(endpoint, headers, operationId, fetchImpl) {
  const response = await fetchImpl(
    new URL(`operations/${encodeURIComponent(operationId)}`, new URL("./", endpoint)),
    { headers, redirect: "error" },
  );
  if (!response.ok) {
    throw new CoverLetterPublishError(
      "cover_letter_arc_readback_unavailable",
      `Interview Arc operation readback returned HTTP ${response.status}.`,
      response.status === 404 || response.status === 408 || response.status === 429 || response.status >= 500,
    );
  }
  return readArcJson(response);
}

async function uploadArcArtifact({ endpoint, headers, identity, manifest, docxBytes, pdfBytes, integrity, jobDescriptionSha256, evidenceFingerprint, fetchImpl }) {
  const form = new FormData();
  form.set("artifactId", identity.artifactId);
  form.set("lineageId", identity.lineageId);
  if (manifest.parentRevisionId) form.set("parentRevisionId", manifest.parentRevisionId);
  form.set("operationId", identity.operationId);
  form.set("company", manifest.company);
  form.set("role", manifest.role);
  if (manifest.sourceUrl) form.set("sourceUrl", manifest.sourceUrl);
  form.set("jobDescriptionSha256", jobDescriptionSha256);
  form.set("resumeId", manifest.resumeId);
  form.set("resumeRevisionId", manifest.resumeRevisionId);
  form.set("evidenceFingerprint", evidenceFingerprint);
  form.set("qualityAttestation", JSON.stringify(manifest.qualityGate));
  form.set("docx", new File([docxBytes], manifest.docxFilename, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }));
  form.set("pdf", new File([pdfBytes], manifest.pdfFilename, { type: "application/pdf" }));

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: form,
      redirect: "error",
    });
  } catch {
    const readback = await readArcOperation(endpoint, headers, identity.operationId, fetchImpl);
    return validateArcReceipt(readback, identity, manifest, integrity, jobDescriptionSha256, evidenceFingerprint);
  }
  if (response.ok) {
    return validateArcReceipt(
      await readArcJson(response),
      identity,
      manifest,
      integrity,
      jobDescriptionSha256,
      evidenceFingerprint,
    );
  }
  if (response.status >= 500) {
    const readback = await readArcOperation(endpoint, headers, identity.operationId, fetchImpl);
    return validateArcReceipt(readback, identity, manifest, integrity, jobDescriptionSha256, evidenceFingerprint);
  }
  throw new CoverLetterPublishError(
    response.status === 409 ? "cover_letter_arc_conflict" : "cover_letter_arc_rejected",
    `Interview Arc rejected the cover-letter operation with HTTP ${response.status}.`,
    response.status === 408 || response.status === 429,
  );
}

function boundedLocalReceipt({ identity, manifest, integrity, jobDescriptionSha256, evidenceFingerprint, arc, saved }) {
  return {
    schemaVersion: 1,
    operationId: identity.operationId,
    artifactId: identity.artifactId,
    lineageId: identity.lineageId,
    parentRevisionId: manifest.parentRevisionId ?? null,
    company: manifest.company,
    role: manifest.role,
    sourceUrl: manifest.sourceUrl ?? null,
    jobDescriptionSha256,
    resumeId: manifest.resumeId,
    resumeRevisionId: manifest.resumeRevisionId,
    resumeWasCurrentAtPublish: arc.resume.current,
    arcGeneration: arc.generation,
    evidenceSummary: arc.evidenceSummary,
    evidenceFingerprint,
    files: integrity,
    state: saved.artifact.state,
    createdAt: saved.artifact.createdAt,
    readyAt: saved.artifact.readyAt,
  };
}

async function persistReceipt(receipt) {
  const directory = path.join(
    projectRoot,
    "private-sources",
    "career-materials",
    "cover-letters",
    receipt.artifactId,
    "receipts",
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const receiptPath = path.join(directory, `${receipt.operationId}.private.json`);
  let value = receipt;
  try {
    const existing = JSON.parse(await readFile(receiptPath, "utf8"));
    const immutableIdentity = (candidate) => ({
      schemaVersion: candidate.schemaVersion,
      operationId: candidate.operationId,
      artifactId: candidate.artifactId,
      lineageId: candidate.lineageId,
      parentRevisionId: candidate.parentRevisionId,
      company: candidate.company,
      role: candidate.role,
      sourceUrl: candidate.sourceUrl,
      jobDescriptionSha256: candidate.jobDescriptionSha256,
      resumeId: candidate.resumeId,
      resumeRevisionId: candidate.resumeRevisionId,
      arcGeneration: candidate.arcGeneration,
      evidenceSummary: candidate.evidenceSummary,
      evidenceFingerprint: candidate.evidenceFingerprint,
      files: candidate.files,
    });
    if (JSON.stringify(immutableIdentity(existing)) !== JSON.stringify(immutableIdentity(receipt))) {
      throw new CoverLetterPublishError(
        "cover_letter_local_receipt_conflict",
        "The ignored local receipt identity belongs to different content.",
      );
    }
    value = {
      ...existing,
      state: receipt.state,
      createdAt: receipt.createdAt,
      readyAt: receipt.readyAt,
    };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temporaryPath = path.join(directory, `.${receipt.operationId}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporaryPath, receiptPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function saveCoverLetterManifest(manifestPath, {
  environment = process.env,
  fetchImpl = fetch,
  connectArcImpl = connectArc,
} = {}) {
  const manifest = await readManifest(manifestPath);
  const docxPath = path.resolve(manifest.docxPath);
  const pdfPath = path.resolve(manifest.pdfPath);
  const docxBytes = await readBoundedRegularFile(docxPath, MAX_DOCUMENT_BYTES, "The final cover-letter DOCX");
  const pdfBytes = await readBoundedRegularFile(pdfPath, MAX_DOCUMENT_BYTES, "The final cover-letter PDF");
  if (docxBytes[0] !== 0x50 || docxBytes[1] !== 0x4b || docxBytes[2] !== 0x03 || docxBytes[3] !== 0x04) {
    throw new CoverLetterPublishError("cover_letter_docx_invalid", "The final cover-letter DOCX is not an Office Open XML document.");
  }
  if (pdfBytes[0] !== 0x25 || pdfBytes[1] !== 0x50 || pdfBytes[2] !== 0x44 || pdfBytes[3] !== 0x46 || pdfBytes[4] !== 0x2d) {
    throw new CoverLetterPublishError("cover_letter_pdf_invalid", "The final cover-letter file is not a PDF.");
  }
  const docxSha256 = sha256(docxBytes);
  const pdfSha256 = sha256(pdfBytes);
  const jobDescriptionSha256 = sha256(manifest.jobDescription.trim());
  const identity = resolveArtifactIdentity(manifest, docxSha256, pdfSha256, jobDescriptionSha256);
  artifactId.parse(identity.artifactId);
  artifactId.parse(identity.lineageId);
  artifactId.parse(identity.operationId);

  const mcpEndpoint = validateHttpsEndpoint(environment.INTERVIEW_ARC_MCP_ENDPOINT ?? DEFAULT_MCP_ENDPOINT, "The Interview Arc MCP endpoint");
  const importEndpoint = validateHttpsEndpoint(environment.INTERVIEW_ARC_COVER_LETTER_URL ?? DEFAULT_IMPORT_ENDPOINT, "The Interview Arc cover-letter import endpoint");
  const client = await connectArcImpl(mcpEndpoint, environment.INTERVIEW_ARC_MCP_TOKEN);
  let arc;
  let saved;
  let evidenceFingerprint;
  const integrity = {
    docx: { sha256: docxSha256, byteSize: docxBytes.byteLength, filename: manifest.docxFilename },
    pdf: { sha256: pdfSha256, byteSize: pdfBytes.byteLength, filename: manifest.pdfFilename },
  };
  try {
    arc = await verifyArcState(client, manifest);
    evidenceFingerprint = sha256(JSON.stringify(arc.evidenceSummary));
    saved = await uploadArcArtifact({
      endpoint: importEndpoint,
      headers: arcImportHeaders(environment.INTERVIEW_ARC_MCP_TOKEN),
      identity,
      manifest,
      docxBytes,
      pdfBytes,
      integrity,
      jobDescriptionSha256,
      evidenceFingerprint,
      fetchImpl,
    });
    const confirmedArc = await verifyArcState(client, manifest);
    if (confirmedArc.generation !== arc.generation) {
      throw new CoverLetterPublishError(
        "cover_letter_arc_generation_conflict",
        "The resume or evidence changed during publication; no verified local receipt was recorded.",
      );
    }
    arc = confirmedArc;
  } finally {
    await client.close().catch(() => undefined);
  }
  const receipt = boundedLocalReceipt({
    identity,
    manifest,
    integrity,
    jobDescriptionSha256,
    evidenceFingerprint,
    arc,
    saved,
  });
  await persistReceipt(receipt);
  if (saved.status !== "saved" || saved.artifact.state !== "ready") {
    throw new CoverLetterPublishError(
      "cover_letter_arc_not_ready",
      `Interview Arc recorded ${saved.artifact.state}; retry this exact manifest after checking the operation receipt.`,
      saved.artifact.state === "pending",
    );
  }
  if (manifest.disposeFilesAfterSuccess) await Promise.all([unlink(docxPath), unlink(pdfPath)]);
  return receipt;
}

export const publishCoverLetterManifest = saveCoverLetterManifest;

async function main(argv) {
  const [manifestPath, ...extra] = argv;
  if (!manifestPath || extra.length) {
    throw new CoverLetterPublishError(
      "cover_letter_usage_invalid",
      "Usage: pnpm cover-letter:save -- <ignored-private-manifest.json>",
    );
  }
  const receipt = await saveCoverLetterManifest(path.resolve(manifestPath));
  process.stdout.write(`${JSON.stringify({
    status: receipt.state,
    artifactId: receipt.artifactId,
    operationId: receipt.operationId,
    resumeId: receipt.resumeId,
    resumeRevisionId: receipt.resumeRevisionId,
    files: receipt.files,
    createdAt: receipt.createdAt,
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    const code = error instanceof CoverLetterPublishError ? error.code : "cover_letter_publish_failed";
    const retryable = error instanceof CoverLetterPublishError && error.retryable;
    process.stderr.write(`${JSON.stringify({ code, retryable })}\n`);
    process.exitCode = 1;
  });
}
