import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { careerMaterialsCoverLetterResponseSchema } from "../app/cover-letter-contract.ts";
import {
  CoverLetterPublishError,
  coverLetterPublishManifestSchema,
  resolveArtifactIdentity,
  saveCoverLetterManifest,
  validateArcReceipt,
  validateEvidencePreflight,
} from "../scripts/save-cover-letter-to-interview-arc.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const DOCX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]);
const PDF = new TextEncoder().encode("%PDF-1.7\npublic-safe cover-letter fixture\n%%EOF");
const JOB_DESCRIPTION = "Build and operate secure platform services, collaborate across engineering, automate delivery, and improve reliability. ".repeat(2);

function artifact(overrides = {}) {
  return {
    id: "cover-letter-artifact-0001",
    lineageId: "cover-letter-artifact-0001",
    parentRevisionId: null,
    company: "Example Company",
    role: "Platform Engineer",
    sourceUrl: "https://example.com/jobs/platform-engineer",
    state: "ready",
    jobDescriptionSha256: sha256(JOB_DESCRIPTION.trim()),
    resumeId: "primary-resume",
    resumeRevisionId: "primary-resume-r3",
    evidenceFingerprint: "e".repeat(64),
    resumeLabel: "Primary resume",
    resumeRevisionKnown: true,
    createdAt: "2026-08-12T11:00:00.000Z",
    readyAt: "2026-08-12T11:00:01.000Z",
    supersededAt: null,
    files: [
      {
        format: "docx",
        sha256: sha256(DOCX),
        byteSize: DOCX.byteLength,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename: "Example-Cover-Letter.docx",
        downloadPath: "/api/career-materials/cover-letters/cover-letter-artifact-0001/docx",
      },
      {
        format: "pdf",
        sha256: sha256(PDF),
        byteSize: PDF.byteLength,
        mimeType: "application/pdf",
        filename: "Example-Cover-Letter.pdf",
        downloadPath: "/api/career-materials/cover-letters/cover-letter-artifact-0001/pdf",
      },
    ],
    ...overrides,
  };
}

test("Career Materials accepts only a complete display-safe Interview Arc DOCX/PDF pair", () => {
  const value = careerMaterialsCoverLetterResponseSchema.parse({
    schemaVersion: 1,
    status: "available",
    stale: false,
    generatedAt: "2026-08-12T11:00:02.000Z",
    artifacts: [artifact()],
    page: { hasMore: false, nextCursor: null },
  });
  assert.equal(value.artifacts[0].files.length, 2);
  assert.throws(() => careerMaterialsCoverLetterResponseSchema.parse({
    ...value,
    artifacts: [{ ...artifact(), privateObjectKey: "must-not-cross" }],
  }));
  assert.throws(() => careerMaterialsCoverLetterResponseSchema.parse({
    ...value,
    artifacts: [{ ...artifact(), files: [artifact().files[1]] }],
  }));
  assert.throws(() => careerMaterialsCoverLetterResponseSchema.parse({
    ...value,
    artifacts: [{ ...artifact(), sourceUrl: "http://localhost/private" }],
  }));
});

test("manifest requires both final formats and completed quality gates", () => {
  const base = {
    schemaVersion: 1,
    company: "Example Company",
    role: "Platform Engineer",
    jobDescription: JOB_DESCRIPTION,
    resumeId: "primary-resume",
    resumeRevisionId: "primary-resume-r3",
    docxPath: "/private/letter.docx",
    pdfPath: "/private/letter.pdf",
    qualityGate: {
      contentScore: 10,
      factualityFullCredit: true,
      specificityFullCredit: true,
      pageCount: 1,
      visuallyInspected: true,
      inspectedAt: 1_786_530_000_000,
    },
  };
  assert.equal(coverLetterPublishManifestSchema.parse(base).disposeFilesAfterSuccess, false);
  assert.throws(() => coverLetterPublishManifestSchema.parse({ ...base, docxPath: undefined }));
  assert.throws(() => coverLetterPublishManifestSchema.parse({
    ...base,
    qualityGate: { ...base.qualityGate, visuallyInspected: false },
  }));
});

test("artifact identity changes when either immutable document changes", () => {
  const manifest = coverLetterPublishManifestSchema.parse({
    schemaVersion: 1,
    company: "Example Company",
    role: "Platform Engineer",
    jobDescription: JOB_DESCRIPTION,
    resumeId: "primary-resume",
    resumeRevisionId: "primary-resume-r3",
    docxPath: "/private/letter.docx",
    pdfPath: "/private/letter.pdf",
    qualityGate: {
      contentScore: 10,
      factualityFullCredit: true,
      specificityFullCredit: true,
      pageCount: 1,
      visuallyInspected: true,
      inspectedAt: 1_786_530_000_000,
    },
  });
  const first = resolveArtifactIdentity(manifest, "a".repeat(64), "b".repeat(64), "c".repeat(64));
  const docxChanged = resolveArtifactIdentity(manifest, "d".repeat(64), "b".repeat(64), "c".repeat(64));
  const pdfChanged = resolveArtifactIdentity(manifest, "a".repeat(64), "e".repeat(64), "c".repeat(64));
  assert.notEqual(first.artifactId, docxChanged.artifactId);
  assert.notEqual(first.artifactId, pdfChanged.artifactId);
});

test("evidence preflight fails closed on unresolved or contrary claims", () => {
  const check = {
    questionId: "behavioral-platform",
    claimIds: ["claim-platform"],
    evidenceIds: ["evidence-platform"],
    excludedGapClaimIds: ["claim-platform"],
  };
  const preflight = {
    claims: [{ claimId: "claim-platform", status: "verified", evidenceIds: ["evidence-platform"], contraryEvidenceIds: [] }],
    supportingEvidence: [{ evidenceId: "evidence-platform" }],
    contraryEvidence: [],
    gaps: [{ claimId: "claim-platform", text: "An outcome metric remains unresolved." }],
  };
  assert.doesNotThrow(() => validateEvidencePreflight(check, preflight));
  assert.throws(
    () => validateEvidencePreflight({ ...check, excludedGapClaimIds: [] }, preflight),
    (error) => error instanceof CoverLetterPublishError && error.code === "cover_letter_gap_not_excluded",
  );
  assert.throws(
    () => validateEvidencePreflight(check, {
      ...preflight,
      contraryEvidence: [{ evidenceId: "contrary", claimId: "claim-platform" }],
    }),
    (error) => error instanceof CoverLetterPublishError && error.code === "cover_letter_claim_has_contrary_evidence",
  );
});

test("controller uploads directly to Interview Arc and records no Job Journey dependency", async () => {
  const directory = await mkdtemp(join(tmpdir(), "interview-arc-cover-letter-"));
  const docxPath = join(directory, "Example-Cover-Letter.docx");
  const pdfPath = join(directory, "Example-Cover-Letter.pdf");
  const manifestPath = join(directory, "manifest.private.json");
  const artifactId = "cover-letter-controller-fixture";
  const operationId = "cover-letter-save-controller-fixture";
  const receiptDirectory = join(
    process.cwd(),
    "private-sources",
    "career-materials",
    "cover-letters",
    artifactId,
  );
  await writeFile(docxPath, DOCX);
  await writeFile(pdfPath, PDF);
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: 1,
    artifactId,
    lineageId: artifactId,
    operationId,
    company: "Example Company",
    role: "Platform Engineer",
    sourceUrl: "https://example.com/jobs/platform-engineer",
    jobDescription: JOB_DESCRIPTION,
    resumeId: "primary-resume",
    resumeRevisionId: "primary-resume-r3",
    docxPath,
    docxFilename: "Example-Cover-Letter.docx",
    pdfPath,
    pdfFilename: "Example-Cover-Letter.pdf",
    evidenceChecks: [],
    qualityGate: {
      contentScore: 10,
      factualityFullCredit: true,
      specificityFullCredit: true,
      pageCount: 1,
      visuallyInspected: true,
      inspectedAt: 1_786_530_000_000,
    },
  }));
  const calls = [];
  const fakeClient = {
    async callTool(request) {
      assert.equal(request.name, "get_resume_revision");
      return {
        isError: false,
        structuredContent: {
          found: true,
          source: { resumeId: "primary-resume", sourceLabel: "Primary resume" },
          revision: { revisionId: "primary-resume-r3", current: true },
        },
      };
    },
    async close() {},
  };
  try {
    const receipt = await saveCoverLetterManifest(manifestPath, {
      environment: {
        INTERVIEW_ARC_MCP_TOKEN: "synthetic-owner-token",
        INTERVIEW_ARC_MCP_ENDPOINT: "https://arc.example/mcp",
        INTERVIEW_ARC_COVER_LETTER_URL: "https://arc.example/cover-letter/imports",
        JOB_JOURNEY_BASE_URL: "https://must-not-be-contacted.example",
      },
      connectArcImpl: async () => fakeClient,
      fetchImpl: async (url, init) => {
        calls.push(String(url));
        assert.equal(String(url), "https://arc.example/cover-letter/imports");
        const form = init.body;
        assert.equal(form.get("jobDescription"), null);
        assert.equal(form.get("docx") instanceof File, true);
        assert.equal(form.get("pdf") instanceof File, true);
        const evidenceFingerprint = form.get("evidenceFingerprint");
        const savedArtifact = artifact({
          id: artifactId,
          lineageId: artifactId,
          evidenceFingerprint,
          files: artifact().files.map((file) => ({
            ...file,
            downloadPath: `/api/career-materials/cover-letters/${artifactId}/${file.format}`,
          })),
        });
        Reflect.deleteProperty(savedArtifact, "resumeLabel");
        Reflect.deleteProperty(savedArtifact, "resumeRevisionKnown");
        return Response.json({
          schemaVersion: 1,
          operationId,
          status: "saved",
          artifact: savedArtifact,
        });
      },
    });
    assert.equal(receipt.state, "ready");
    assert.deepEqual(calls, ["https://arc.example/cover-letter/imports"]);
    assert.equal(JSON.stringify(receipt).includes("must-not-be-contacted"), false);
    const stored = await readFile(join(receiptDirectory, "receipts", `${operationId}.private.json`), "utf8");
    assert.equal(stored.includes(JOB_DESCRIPTION), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(receiptDirectory, { recursive: true, force: true });
  }
});

test("controller rejects partial Interview Arc receipts", () => {
  const identity = {
    artifactId: "cover-letter-artifact-0001",
    lineageId: "cover-letter-artifact-0001",
    operationId: "cover-letter-save-artifact-0001",
  };
  assert.throws(() => validateArcReceipt({
    schemaVersion: 1,
    operationId: identity.operationId,
    status: "saved",
    artifact: { ...artifact(), files: [artifact().files[1]] },
  }, identity, {
    company: "Example Company",
    role: "Platform Engineer",
    sourceUrl: "https://example.com/jobs/platform-engineer",
    resumeId: "primary-resume",
    resumeRevisionId: "primary-resume-r3",
  }, {
    docx: { sha256: sha256(DOCX), byteSize: DOCX.byteLength, filename: "Example-Cover-Letter.docx" },
    pdf: { sha256: sha256(PDF), byteSize: PDF.byteLength, filename: "Example-Cover-Letter.pdf" },
  }, sha256(JOB_DESCRIPTION.trim()), "e".repeat(64)), (error) => (
    error instanceof CoverLetterPublishError
    && error.code === "cover_letter_arc_receipt_invalid"
  ));
});
