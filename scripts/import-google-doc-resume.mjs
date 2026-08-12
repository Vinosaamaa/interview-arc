#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const PDF_MIME = "application/pdf";
const MAX_CAPTURE_BYTES = 750_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const DEFAULT_ENDPOINT = "https://limitless-mcp.vinosama.workers.dev/resume/imports";
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const stableId = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,199}$/);
const displaySafeLabel = z.string().trim().min(1).max(120).regex(/^[\p{L}\p{N}][\p{L}\p{N} .,'()&+_-]{0,119}$/u)
  .refine((value) => !/\b(?:gh[pousr]_|github_pat_|sk-(?:proj-)?|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/i.test(value));

const sourceObservationSchema = z.object({
  fileId: z.string().min(1).max(512),
  mimeType: z.literal(GOOGLE_DOC_MIME),
  modifiedTime: z.string().datetime({ offset: true }),
  revisionId: z.string().min(1).max(512).optional(),
  version: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative().transform(String)]).optional(),
}).strict().superRefine((value, context) => {
  if (!value.revisionId && !value.version) {
    context.addIssue({ code: "custom", path: ["revisionId"], message: "A Drive revisionId or version is required." });
  }
});

const captureBulletSchema = z.object({
  occurrenceId: stableId,
  sectionLabel: z.string().trim().min(1).max(160),
  ordinal: z.number().int().nonnegative().max(999),
  text: z.string().min(1).max(2_000),
  claimIds: z.array(stableId).max(20).default([]),
  evidenceIds: z.array(stableId).max(20).default([]),
}).strict();

const captureSchema = z.object({
  schemaVersion: z.literal(1),
  operationId: stableId,
  resumeId: stableId,
  revisionId: stableId,
  sourceLabel: displaySafeLabel,
  capturedAt: z.number().int().positive(),
  source: z.object({
    provider: z.literal("google_drive"),
    beforeExports: sourceObservationSchema,
    afterExports: sourceObservationSchema,
  }).strict(),
  exports: z.object({
    docxPath: z.string().min(1).max(4_096),
    pdfPath: z.string().min(1).max(4_096),
  }).strict(),
  extraction: z.object({
    version: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/),
    bullets: z.array(captureBulletSchema).max(240),
  }).strict(),
}).strict();

export class GoogleDocResumeImportError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.name = "GoogleDocResumeImportError";
    this.code = code;
    this.retryable = retryable;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeBulletText(value) {
  return value.normalize("NFKC").replaceAll("\r\n", "\n").trim();
}

function sameSourceObservation(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function readBoundedRegularFile(filePath, maximumBytes, code, description) {
  let metadata;
  try {
    metadata = await lstat(filePath);
  } catch {
    throw new GoogleDocResumeImportError(code, `${description} is unavailable.`);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > maximumBytes) {
    throw new GoogleDocResumeImportError(code, `${description} must be a bounded regular file.`);
  }
  return readFile(filePath);
}

function assertFileSignature(bytes, expected, code, description) {
  if (!expected.every((value, index) => bytes[index] === value)) {
    throw new GoogleDocResumeImportError(code, `${description} does not match its required format.`);
  }
}

function resolveExportPath(capturePath, value) {
  return path.isAbsolute(value) ? value : path.resolve(path.dirname(capturePath), value);
}

function relativeMirrorPath(resumeId, revisionId) {
  return path.join("private-sources", "resume-library", "imports", resumeId, revisionId);
}

function immutableManifestFingerprint(manifest) {
  const immutableManifest = {
    schemaVersion: manifest.schemaVersion,
    sourceProvider: manifest.sourceProvider,
    sourceRevisionFingerprint: manifest.sourceRevisionFingerprint,
    extractionVersion: manifest.extractionVersion,
    bullets: manifest.bullets,
  };
  return sha256(JSON.stringify(immutableManifest));
}

function compatibleMirrorIdentity(manifest) {
  return JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    resumeId: manifest.resumeId,
    revisionId: manifest.revisionId,
    source: manifest.source,
    sourceFingerprint: manifest.sourceFingerprint,
    extractionVersion: manifest.extractionVersion,
    manifestFingerprint: manifest.manifestFingerprint,
    files: manifest.files,
  });
}

async function verifyExistingMirror(targetDirectory, expectedManifest) {
  let existingManifest;
  try {
    existingManifest = JSON.parse(await readFile(path.join(targetDirectory, "manifest.private.json"), "utf8"));
  } catch {
    throw new GoogleDocResumeImportError(
      "resume_local_mirror_incomplete",
      "The immutable local resume mirror exists but its private manifest is unavailable.",
    );
  }
  if (JSON.stringify(existingManifest) !== JSON.stringify(expectedManifest)) {
    throw new GoogleDocResumeImportError(
      "resume_local_mirror_conflict",
      "That immutable local resume revision identity already belongs to different content.",
    );
  }
  for (const [filename, expected] of [
    ["source.docx", expectedManifest.files.docx],
    ["snapshot.pdf", expectedManifest.files.pdf],
  ]) {
    const bytes = await readBoundedRegularFile(
      path.join(targetDirectory, filename),
      MAX_FILE_BYTES,
      "resume_local_mirror_incomplete",
      "An immutable local resume mirror file",
    );
    if (bytes.byteLength !== expected.byteSize || sha256(bytes) !== expected.sha256) {
      throw new GoogleDocResumeImportError(
        "resume_local_mirror_conflict",
        "An immutable local resume mirror file no longer matches its recorded integrity.",
      );
    }
  }
  return targetDirectory;
}

async function verifyCompatibleCanonicalMirror(targetDirectory, expectedManifest) {
  let existingManifest;
  try {
    existingManifest = JSON.parse(await readFile(path.join(targetDirectory, "manifest.private.json"), "utf8"));
  } catch {
    throw new GoogleDocResumeImportError(
      "resume_local_mirror_incomplete",
      "The canonical immutable resume mirror exists but its private manifest is unavailable.",
    );
  }
  if (compatibleMirrorIdentity(existingManifest) !== compatibleMirrorIdentity(expectedManifest)) {
    throw new GoogleDocResumeImportError(
      "resume_local_mirror_conflict",
      "The authoritative immutable resume revision already belongs to different local content.",
    );
  }
  for (const [filename, expected] of [
    ["source.docx", expectedManifest.files.docx],
    ["snapshot.pdf", expectedManifest.files.pdf],
  ]) {
    const bytes = await readBoundedRegularFile(
      path.join(targetDirectory, filename),
      MAX_FILE_BYTES,
      "resume_local_mirror_incomplete",
      "An authoritative immutable resume mirror file",
    );
    if (bytes.byteLength !== expected.byteSize || sha256(bytes) !== expected.sha256) {
      throw new GoogleDocResumeImportError(
        "resume_local_mirror_conflict",
        "An authoritative immutable resume mirror file no longer matches its recorded integrity.",
      );
    }
  }
  return targetDirectory;
}

async function persistMirror({ root, capture, privateManifest, docxBytes, pdfBytes }) {
  const relative = relativeMirrorPath(capture.resumeId, capture.revisionId);
  const targetDirectory = path.join(root, relative);
  try {
    const existing = await lstat(targetDirectory);
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new GoogleDocResumeImportError(
        "resume_local_mirror_conflict",
        "The immutable local resume revision target is not a private directory.",
      );
    }
    return { directory: await verifyExistingMirror(targetDirectory, privateManifest), relative, unchanged: true };
  } catch (error) {
    if (error instanceof GoogleDocResumeImportError) throw error;
    if (error?.code !== "ENOENT") {
      throw new GoogleDocResumeImportError("resume_local_mirror_unavailable", "The private resume mirror cannot be inspected.", true);
    }
  }

  const parent = path.dirname(targetDirectory);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const stagingDirectory = await mkdtemp(path.join(parent, `.${capture.revisionId}.staging-`));
  try {
    await writeFile(path.join(stagingDirectory, "source.docx"), docxBytes, { mode: 0o600, flag: "wx" });
    await writeFile(path.join(stagingDirectory, "snapshot.pdf"), pdfBytes, { mode: 0o600, flag: "wx" });
    await writeFile(
      path.join(stagingDirectory, "manifest.private.json"),
      `${JSON.stringify(privateManifest, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    try {
      await rename(stagingDirectory, targetDirectory);
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes(error?.code)) throw error;
      await verifyExistingMirror(targetDirectory, privateManifest);
      return { directory: targetDirectory, relative, unchanged: true };
    }
    return { directory: targetDirectory, relative, unchanged: false };
  } catch (error) {
    if (error instanceof GoogleDocResumeImportError) throw error;
    throw new GoogleDocResumeImportError("resume_local_mirror_unavailable", "The private resume mirror could not be written.", true);
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

function validateEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new GoogleDocResumeImportError("resume_import_endpoint_invalid", "The resume import endpoint is invalid.");
  }
  const localHttp = endpoint.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !localHttp) {
    throw new GoogleDocResumeImportError("resume_import_endpoint_invalid", "The resume import endpoint must use HTTPS or local loopback HTTP.");
  }
  return endpoint;
}

function boundedReceipt(value) {
  if (!value || typeof value !== "object") return null;
  const receipt = {};
  for (const key of [
    "operationId",
    "status",
    "unchanged",
    "resumeId",
    "revisionId",
    "parentRevisionId",
    "sourceFingerprint",
    "sourceProvider",
    "sourceRevisionFingerprint",
    "manifestFingerprint",
    "extractionVersion",
    "bulletCount",
    "importedAt",
    "currentRevisionId",
    "files",
  ]) {
    if (Object.hasOwn(value, key)) receipt[key] = value[key];
  }
  return receipt;
}

async function uploadMirror({ capture, mirror, ingestManifest, sourceFingerprint, endpoint, token, fetchImpl }) {
  if (!token) {
    throw new GoogleDocResumeImportError("resume_import_auth_required", "INTERVIEW_ARC_MCP_TOKEN is required.");
  }
  const form = new FormData();
  form.set("operationId", capture.operationId);
  form.set("resumeId", capture.resumeId);
  form.set("revisionId", capture.revisionId);
  form.set("sourceLabel", capture.sourceLabel);
  form.set("sourceFingerprint", sourceFingerprint);
  form.set("manifest", JSON.stringify(ingestManifest));
  const [docxBytes, pdfBytes] = await Promise.all([
    readFile(path.join(mirror.directory, "source.docx")),
    readFile(path.join(mirror.directory, "snapshot.pdf")),
  ]);
  form.set("docx", new File([docxBytes], "source.docx", { type: DOCX_MIME }));
  form.set("pdf", new File([pdfBytes], "snapshot.pdf", { type: PDF_MIME }));

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
  } catch {
    throw new GoogleDocResumeImportError("resume_import_unavailable", "The authenticated resume import request failed.", true);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const code = typeof body?.code === "string" ? body.code : "resume_import_unavailable";
    const message = typeof body?.error === "string" ? body.error : "The private resume import was not saved.";
    throw new GoogleDocResumeImportError(code, message, Boolean(body?.retryable));
  }
  const receipt = boundedReceipt(body);
  if (
    !receipt
    || receipt.status !== "saved"
    || receipt.resumeId !== capture.resumeId
    || (receipt.revisionId !== capture.revisionId && receipt.unchanged !== true)
  ) {
    throw new GoogleDocResumeImportError(
      "resume_import_receipt_invalid",
      "The private resume import returned an invalid authoritative receipt.",
      true,
    );
  }
  return receipt;
}

async function persistImportReceipt(mirrorDirectory, receipt) {
  const receiptsDirectory = path.join(mirrorDirectory, "import-receipts");
  await mkdir(receiptsDirectory, { recursive: true, mode: 0o700 });
  const receiptPath = path.join(receiptsDirectory, `${receipt.operationId}.private.json`);
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  }).catch(async (error) => {
    if (error?.code !== "EEXIST") throw error;
    const existing = JSON.parse(await readFile(receiptPath, "utf8"));
    if (JSON.stringify(existing) !== JSON.stringify(receipt)) {
      throw new GoogleDocResumeImportError(
        "resume_import_receipt_conflict",
        "The local authoritative receipt differs from the exact retry response.",
      );
    }
  });
}

async function reconcileAuthoritativeMirror({
  root,
  capture,
  privateManifest,
  requestedMirror,
  receipt,
  docxBytes,
  pdfBytes,
}) {
  if (receipt.revisionId === capture.revisionId) return requestedMirror;
  const canonicalCapture = { ...capture, revisionId: receipt.revisionId };
  const canonicalManifest = { ...privateManifest, revisionId: receipt.revisionId };
  const relative = relativeMirrorPath(capture.resumeId, receipt.revisionId);
  const targetDirectory = path.join(root, relative);
  let canonicalMirror;
  try {
    const existing = await lstat(targetDirectory);
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new GoogleDocResumeImportError(
        "resume_local_mirror_conflict",
        "The authoritative immutable resume revision target is not a private directory.",
      );
    }
    await verifyCompatibleCanonicalMirror(targetDirectory, canonicalManifest);
    canonicalMirror = { directory: targetDirectory, relative, unchanged: true };
  } catch (error) {
    if (error instanceof GoogleDocResumeImportError) throw error;
    if (error?.code !== "ENOENT") {
      throw new GoogleDocResumeImportError(
        "resume_local_mirror_unavailable",
        "The authoritative private resume mirror cannot be inspected.",
        true,
      );
    }
    canonicalMirror = await persistMirror({
      root,
      capture: canonicalCapture,
      privateManifest: canonicalManifest,
      docxBytes,
      pdfBytes,
    });
  }
  // The requested revision was only a proposal. Once D1 returns an unchanged
  // canonical revision, remove the exact duplicate mirror created by this
  // operation after the authoritative mirror has been verified.
  await verifyExistingMirror(requestedMirror.directory, privateManifest);
  await rm(requestedMirror.directory, { recursive: true, force: true });
  return canonicalMirror;
}

export async function importGoogleDocResume({
  capturePath,
  root = projectRoot,
  endpoint = process.env.INTERVIEW_ARC_RESUME_IMPORT_URL ?? DEFAULT_ENDPOINT,
  token = process.env.INTERVIEW_ARC_MCP_TOKEN,
  fetchImpl = fetch,
  mirrorOnly = false,
}) {
  const captureBytes = await readBoundedRegularFile(
    capturePath,
    MAX_CAPTURE_BYTES,
    "resume_capture_invalid",
    "The private Google Doc capture manifest",
  );
  let capture;
  try {
    capture = captureSchema.parse(JSON.parse(captureBytes.toString("utf8")));
  } catch {
    throw new GoogleDocResumeImportError("resume_capture_invalid", "The private Google Doc capture manifest is invalid.");
  }
  if (!sameSourceObservation(capture.source.beforeExports, capture.source.afterExports)) {
    throw new GoogleDocResumeImportError(
      "resume_source_changed_during_export",
      "The Google Doc changed while its DOCX/PDF snapshots were exported. Export both formats again from one stable revision.",
      true,
    );
  }

  const [docxBytes, pdfBytes] = await Promise.all([
    readBoundedRegularFile(
      resolveExportPath(capturePath, capture.exports.docxPath),
      MAX_FILE_BYTES,
      "resume_export_invalid",
      "The authenticated DOCX export",
    ),
    readBoundedRegularFile(
      resolveExportPath(capturePath, capture.exports.pdfPath),
      MAX_FILE_BYTES,
      "resume_export_invalid",
      "The authenticated PDF export",
    ),
  ]);
  assertFileSignature(docxBytes, [0x50, 0x4b, 0x03, 0x04], "resume_export_invalid", "The authenticated DOCX export");
  assertFileSignature(pdfBytes, [0x25, 0x50, 0x44, 0x46, 0x2d], "resume_export_invalid", "The authenticated PDF export");

  const sourceRevision = capture.source.beforeExports;
  const sourceFingerprint = sha256(JSON.stringify(sourceRevision));
  const occurrenceIds = new Set();
  const ordinals = new Set();
  let referenceCount = 0;
  const bullets = capture.extraction.bullets.map((bullet) => {
    if (occurrenceIds.has(bullet.occurrenceId) || ordinals.has(bullet.ordinal)) {
      throw new GoogleDocResumeImportError("resume_capture_invalid", "Resume bullet identities and document positions must be unique.");
    }
    occurrenceIds.add(bullet.occurrenceId);
    ordinals.add(bullet.ordinal);
    if (new Set(bullet.claimIds).size !== bullet.claimIds.length || new Set(bullet.evidenceIds).size !== bullet.evidenceIds.length) {
      throw new GoogleDocResumeImportError("resume_capture_invalid", "Resume bullet claim and evidence links must be unique.");
    }
    referenceCount += bullet.claimIds.length + bullet.evidenceIds.length;
    const text = normalizeBulletText(bullet.text);
    return { ...bullet, text, contentFingerprint: sha256(text) };
  });
  if (referenceCount > 400) {
    throw new GoogleDocResumeImportError("resume_capture_invalid", "A resume import may contain at most 400 semantic references.");
  }
  const ingestManifest = {
    schemaVersion: 1,
    sourceProvider: "google_drive",
    sourceRevisionFingerprint: sourceFingerprint,
    extractionVersion: capture.extraction.version,
    capturedAt: capture.capturedAt,
    bullets,
  };
  const privateManifest = {
    schemaVersion: 1,
    operationId: capture.operationId,
    resumeId: capture.resumeId,
    revisionId: capture.revisionId,
    sourceLabel: capture.sourceLabel,
    source: { provider: "google_drive", revision: sourceRevision },
    sourceFingerprint,
    capturedAt: capture.capturedAt,
    extractionVersion: capture.extraction.version,
    manifestFingerprint: immutableManifestFingerprint(ingestManifest),
    files: {
      docx: { sha256: sha256(docxBytes), byteSize: docxBytes.byteLength, mimeType: DOCX_MIME },
      pdf: { sha256: sha256(pdfBytes), byteSize: pdfBytes.byteLength, mimeType: PDF_MIME },
    },
    ingestManifest,
  };
  const mirror = await persistMirror({ root, capture, privateManifest, docxBytes, pdfBytes });
  if (mirrorOnly) {
    return {
      status: "mirrored",
      operationId: capture.operationId,
      resumeId: capture.resumeId,
      revisionId: capture.revisionId,
      localMirror: mirror.relative.split(path.sep).join("/"),
      unchanged: mirror.unchanged,
    };
  }
  const receipt = await uploadMirror({
    capture,
    mirror,
    ingestManifest,
    sourceFingerprint,
    endpoint: validateEndpoint(endpoint),
    token,
    fetchImpl,
  });
  const authoritativeMirror = await reconcileAuthoritativeMirror({
    root,
    capture,
    privateManifest,
    requestedMirror: mirror,
    receipt,
    docxBytes,
    pdfBytes,
  });
  await persistImportReceipt(authoritativeMirror.directory, receipt);
  return {
    status: "saved",
    operationId: capture.operationId,
    resumeId: capture.resumeId,
    revisionId: receipt.revisionId,
    requestedRevisionId: capture.revisionId,
    localMirror: authoritativeMirror.relative.split(path.sep).join("/"),
    localMirrorUnchanged: authoritativeMirror.unchanged,
    receipt,
  };
}

function parseCli(argv) {
  const args = [...argv];
  const capturePath = args.shift();
  let mirrorOnly = false;
  while (args.length) {
    const option = args.shift();
    if (option === "--mirror-only") mirrorOnly = true;
    else throw new GoogleDocResumeImportError("resume_import_usage", "Usage: node scripts/import-google-doc-resume.mjs <private-capture.json> [--mirror-only]");
  }
  if (!capturePath) {
    throw new GoogleDocResumeImportError("resume_import_usage", "Usage: node scripts/import-google-doc-resume.mjs <private-capture.json> [--mirror-only]");
  }
  return { capturePath: path.resolve(capturePath), mirrorOnly };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await importGoogleDocResume(parseCli(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const code = error instanceof GoogleDocResumeImportError ? error.code : "resume_import_failed";
    const message = error instanceof GoogleDocResumeImportError ? error.message : "The private resume import failed.";
    process.stderr.write(`${JSON.stringify({ code, error: message, retryable: Boolean(error?.retryable) })}\n`);
    process.exitCode = 1;
  }
}
