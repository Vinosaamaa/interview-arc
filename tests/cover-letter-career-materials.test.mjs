import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { normalizeJobJourneyCoverLetterPage } from "../app/cover-letter-contract.ts";
import { fetchCoverLetters, resolveJobJourneyDownloadUrl } from "../db/job-journey-client.ts";
import {
  CoverLetterPublishError,
  coverLetterPublishManifestSchema,
  publishCoverLetterManifest,
  resolveArtifactIdentity,
  validateEvidencePreflight,
  validateProviderReceipt,
} from "../scripts/publish-cover-letter-to-job-journey.mjs";

const providerArtifact = {
  id: "artifact_0001",
  lineageId: "artifact_0001",
  parentRevisionId: null,
  company: "Example Company",
  role: "Platform Engineer",
  sourceUrl: "https://example.com/jobs/platform-engineer",
  state: "ready",
  jobDescriptionSha256: "b".repeat(64),
  resumeId: "primary-resume",
  resumeRevisionId: "primary-resume-r3",
  pdfSha256: "a".repeat(64),
  pdfSize: 128,
  pdfFilename: "Example-Company-Cover-Letter.pdf",
  jobId: null,
  linkRevision: 0,
  createdAt: "2026-08-12T11:00:00.000Z",
  readyAt: "2026-08-12T11:00:01.000Z",
  supersededAt: null,
  deletedAt: null,
  updatedAt: "2026-08-12T11:00:01.000Z",
  downloadPath: "/api/assets/cover-letters/artifact_0001",
};

test("Job Journey cover-letter projection is a strict privacy allowlist", () => {
  const page = normalizeJobJourneyCoverLetterPage({
    schemaVersion: 1,
    generatedAt: "2026-08-12T11:00:02.000Z",
    artifacts: [providerArtifact],
    page: { hasMore: false, nextCursor: null },
  });
  assert.equal(page.artifacts[0].company, "Example Company");
  assert.throws(() => normalizeJobJourneyCoverLetterPage({
    schemaVersion: 1,
    generatedAt: "2026-08-12T11:00:02.000Z",
    artifacts: [{ ...providerArtifact, privateObjectKey: "must-not-cross" }],
    page: { hasMore: false, nextCursor: null },
  }));
  assert.throws(() => normalizeJobJourneyCoverLetterPage({
    schemaVersion: 1,
    generatedAt: "2026-08-12T11:00:02.000Z",
    artifacts: [{ ...providerArtifact, state: "uploaded" }],
    page: { hasMore: false, nextCursor: null },
  }));
  assert.throws(() => normalizeJobJourneyCoverLetterPage({
    schemaVersion: 1,
    generatedAt: "2026-08-12T11:00:02.000Z",
    artifacts: [{ ...providerArtifact, downloadPath: null }],
    page: { hasMore: false, nextCursor: null },
  }));
  assert.throws(() => normalizeJobJourneyCoverLetterPage({
    schemaVersion: 1,
    generatedAt: "2026-08-12T11:00:02.000Z",
    artifacts: [{ ...providerArtifact, sourceUrl: "https://owner:secret@example.com/job" }],
    page: { hasMore: false, nextCursor: null },
  }));
  assert.throws(() => normalizeJobJourneyCoverLetterPage({
    schemaVersion: 1,
    generatedAt: "2026-08-12T11:00:02.000Z",
    artifacts: [{ ...providerArtifact, sourceUrl: "http://localhost/private" }],
    page: { hasMore: false, nextCursor: null },
  }));
});

test("cover-letter projection bounds provider bytes before JSON materialization", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("x".repeat(1024 * 1024 + 1), {
    headers: { "content-type": "application/json" },
  });
  try {
    await assert.rejects(
      fetchCoverLetters({
        JOB_JOURNEY_BASE_URL: "https://job-journey.example",
        JOB_JOURNEY_SITE_TOKEN: "synthetic-job-token",
      }, "owner-cover-letter-bounds"),
      /oversized response/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("controller rejects malformed or partial provider receipts before ready", () => {
  const operationId = "create_receipt_contract";
  assert.throws(
    () => validateProviderReceipt({
      schemaVersion: 1,
      operationId,
      operationKind: "create",
      replayed: false,
      artifact: { ...providerArtifact, downloadPath: null },
    }, {
      operationId,
      artifactId: providerArtifact.id,
      lineageId: providerArtifact.lineageId,
    }, {
      resumeId: providerArtifact.resumeId,
      resumeRevisionId: providerArtifact.resumeRevisionId,
      pdfFilename: providerArtifact.pdfFilename,
    }, providerArtifact.pdfSha256, providerArtifact.jobDescriptionSha256, providerArtifact.pdfSize),
    (error) => error instanceof CoverLetterPublishError
      && error.code === "cover_letter_provider_receipt_invalid"
      && error.retryable === true,
  );
});

test("Job Journey links are credential-free HTTPS URLs under the exact private asset route", () => {
  assert.equal(
    resolveJobJourneyDownloadUrl(
      { JOB_JOURNEY_BASE_URL: "https://job-journey.example" },
      "/api/assets/cover-letters/artifact_0001",
    ),
    "https://job-journey.example/api/assets/cover-letters/artifact_0001",
  );
  assert.throws(() => resolveJobJourneyDownloadUrl(
    { JOB_JOURNEY_BASE_URL: "https://job-journey.example" },
    "https://attacker.example/file.pdf",
  ));
  assert.throws(() => resolveJobJourneyDownloadUrl(
    { JOB_JOURNEY_BASE_URL: "http://job-journey.example" },
    "/api/assets/cover-letters/artifact_0001",
  ));
  assert.throws(() => resolveJobJourneyDownloadUrl(
    { JOB_JOURNEY_BASE_URL: "https://owner:secret@job-journey.example" },
    "/api/assets/cover-letters/artifact_0001",
  ));
});

test("evidence preflight accepts verified support and fails closed on gaps or contrary evidence", () => {
  const check = {
    questionId: "behavioral-platform",
    claimIds: ["claim-platform"],
    evidenceIds: ["evidence-platform"],
    excludedGapClaimIds: ["claim-platform"],
  };
  const preflight = {
    claims: [{
      claimId: "claim-platform",
      status: "verified",
      evidenceIds: ["evidence-platform"],
      contraryEvidenceIds: [],
    }],
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
      claims: [{ ...preflight.claims[0], contraryEvidenceIds: ["evidence-contrary"] }],
      contraryEvidence: [{ evidenceId: "evidence-contrary" }],
    }),
    (error) => error instanceof CoverLetterPublishError && error.code === "cover_letter_claim_has_contrary_evidence",
  );
  assert.throws(
    () => validateEvidencePreflight(check, {
      ...preflight,
      claims: [{ ...preflight.claims[0], evidenceIds: [] }],
    }),
    (error) => error instanceof CoverLetterPublishError && error.code === "cover_letter_evidence_not_accepted",
  );
  assert.throws(
    () => validateEvidencePreflight({ ...check, evidenceIds: ["evidence-platform", "evidence-unlinked"] }, {
      ...preflight,
      supportingEvidence: [...preflight.supportingEvidence, { evidenceId: "evidence-unlinked" }],
    }),
    (error) => error instanceof CoverLetterPublishError && error.code === "cover_letter_evidence_not_accepted",
  );
});

test("controller verifies Arc state and advances one bounded receipt from pending to ready", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cover-letter-controller-"));
  const pdfPath = join(directory, "final.pdf");
  const manifestPath = join(directory, "manifest.private.json");
  const pdfBytes = Buffer.from("%PDF-1.4\nSynthetic final letter\n%%EOF\n");
  await writeFile(pdfPath, pdfBytes);
  const manifest = {
    schemaVersion: 1,
    company: "Example Company",
    role: "Platform Engineer",
    sourceUrl: "https://example.com/jobs/platform-engineer",
    jobDescription: "Example Company seeks a Platform Engineer to build secure reliable services, improve developer workflows, and collaborate across engineering teams. This text is a synthetic test fixture only.",
    resumeId: "primary-resume",
    resumeRevisionId: "primary-resume-r3",
    pdfPath,
    pdfFilename: "Example-Company-Cover-Letter.pdf",
    evidenceChecks: [{
      questionId: "behavioral-platform",
      claimIds: ["claim-platform"],
      evidenceIds: ["evidence-platform"],
      excludedGapClaimIds: ["claim-platform"],
    }],
    qualityGate: {
      contentScore: 10,
      factualityFullCredit: true,
      specificityFullCredit: true,
      pageCount: 1,
      visuallyInspected: true,
      inspectedAt: 1_786_537_800_000,
    },
  };
  assert.equal(coverLetterPublishManifestSchema.safeParse({
    ...manifest,
    sourceUrl: "http://owner:secret@example.com/job",
  }).success, false);
  assert.equal(coverLetterPublishManifestSchema.safeParse({
    ...manifest,
    evidenceChecks: [{
      ...manifest.evidenceChecks[0],
      excludedGapClaimIds: ["claim-not-declared"],
    }],
  }).success, false);
  await writeFile(manifestPath, JSON.stringify(manifest));
  const requests = [];
  const client = {
    async callTool({ name }) {
      if (name === "get_resume_revision") return {
        isError: false,
        structuredContent: {
          found: true,
          source: { resumeId: "primary-resume", sourceLabel: "Primary resume" },
          revision: { revisionId: "primary-resume-r3", current: true },
        },
      };
      return {
        isError: false,
        structuredContent: {
          claims: [{ claimId: "claim-platform", status: "verified", evidenceIds: ["evidence-platform"], contraryEvidenceIds: [] }],
          supportingEvidence: [{ evidenceId: "evidence-platform" }],
          contraryEvidence: [],
          gaps: [{ claimId: "claim-platform", text: "An outcome metric remains unresolved." }],
        },
      };
    },
    async close() {},
  };
  let receipt;
  try {
    const options = {
      environment: {
        INTERVIEW_ARC_MCP_ENDPOINT: "https://arc.example/mcp",
        INTERVIEW_ARC_MCP_TOKEN: "synthetic-arc-token",
        JOB_JOURNEY_BASE_URL: "https://job-journey.example",
        JOB_JOURNEY_SITE_TOKEN: "synthetic-job-token",
      },
      connectArcImpl: async () => client,
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        const form = init.body;
        const uploadedPdf = Buffer.from(await form.get("pdf").arrayBuffer());
        const pdfSha256 = createHash("sha256").update(uploadedPdf).digest("hex");
        const jobDescriptionSha256 = createHash("sha256").update(form.get("jobDescription")).digest("hex");
        const pending = requests.length === 1;
        return Response.json({
          schemaVersion: 1,
          operationId: form.get("operationId"),
          operationKind: "create",
          replayed: false,
          artifact: {
            ...providerArtifact,
            id: form.get("artifactId"),
            lineageId: form.get("lineageId"),
            jobDescriptionSha256,
            resumeId: form.get("resumeId"),
            resumeRevisionId: form.get("resumeRevisionId"),
            pdfSha256,
            pdfSize: uploadedPdf.byteLength,
            state: pending ? "pending" : "ready",
            readyAt: pending ? null : providerArtifact.readyAt,
            downloadPath: pending ? null : providerArtifact.downloadPath,
          },
        }, { status: 201 });
      },
    };
    await assert.rejects(
      publishCoverLetterManifest(manifestPath, options),
      (error) => error instanceof CoverLetterPublishError
        && error.code === "cover_letter_provider_not_ready"
        && error.retryable === true,
    );
    receipt = await publishCoverLetterManifest(manifestPath, options);
    assert.equal(receipt.state, "ready");
    assert.equal(requests.length, 2);
    assert.equal(requests[0].init.headers["OAI-Sites-Authorization"], "Bearer synthetic-job-token");
    assert.equal("authorization" in requests[0].init.headers, false);
    assert.equal(requests[0].init.redirect, "error");
    const receiptPath = join(
      process.cwd(),
      "private-sources",
      "career-materials",
      "cover-letters",
      receipt.artifactId,
      "receipts",
      `${receipt.operationId}.private.json`,
    );
    const persisted = JSON.parse(await readFile(receiptPath, "utf8"));
    assert.equal(persisted.state, "ready");
    assert.equal("jobDescription" in persisted, false);
    assert.equal("pdfPath" in persisted, false);
    assert.equal(JSON.stringify(persisted).includes("An outcome metric remains unresolved"), false);
    assert.equal(resolveArtifactIdentity(manifest, receipt.pdfSha256, receipt.jobDescriptionSha256).artifactId, receipt.artifactId);
  } finally {
    await rm(directory, { recursive: true, force: true });
    if (receipt) {
      await rm(join(process.cwd(), "private-sources", "career-materials", "cover-letters", receipt.artifactId), { recursive: true, force: true });
    }
  }
});

test("controller requires the complete content and visual quality gate", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cover-letter-quality-"));
  const pdfPath = join(directory, "final.pdf");
  const manifestPath = join(directory, "manifest.private.json");
  await writeFile(pdfPath, "%PDF-1.4\nSynthetic final letter\n%%EOF\n");
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: 1,
    company: "Example Company",
    role: "Platform Engineer",
    jobDescription: "Example Company seeks a Platform Engineer to build secure reliable services, improve developer workflows, and collaborate across engineering teams. This text is a synthetic test fixture only.",
    resumeId: "primary-resume",
    resumeRevisionId: "primary-resume-r3",
    pdfPath,
    evidenceChecks: [],
    qualityGate: {
      contentScore: 9,
      factualityFullCredit: true,
      specificityFullCredit: true,
      pageCount: 1,
      visuallyInspected: true,
      inspectedAt: 1_786_537_800_000,
    },
  }));
  try {
    await assert.rejects(
      publishCoverLetterManifest(manifestPath),
      (error) => error instanceof CoverLetterPublishError && error.code === "cover_letter_manifest_invalid",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("specialist and Career Materials source stay read-only and controller-driven", async () => {
  const [guide, component, route, controller, contract, packageJson] = await Promise.all([
    readFile(new URL("../career-materials/resume-cover-letter/AGENTS.md", import.meta.url), "utf8"),
    readFile(new URL("../app/career-materials-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/career-materials/cover-letters/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/publish-cover-letter-to-job-journey.mjs", import.meta.url), "utf8"),
    readFile(new URL("../docs/contracts/cover-letter-publication.md", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(guide, /pnpm cover-letter:publish/);
  assert.match(guide, /Only `ready` is a published cover letter/);
  assert.match(route, /private, no-store/);
  assert.match(route, /The Resume Library remains authoritative and usable/);
  assert.doesNotMatch(controller, /save_practice_exchange|append_practice_transcript|create_loop/);
  assert.match(contract, /never an empty\s+history/);
  assert.equal(JSON.parse(packageJson).scripts["cover-letter:publish"], "node scripts/publish-cover-letter-to-job-journey.mjs");
  assert.match(component, /Job Journey artifacts/);
  assert.match(component, /Open private PDF in Job Journey/);
  assert.doesNotMatch(component, /cover-letter editor/i);
  assert.doesNotMatch(component, /textarea|contentEditable/);
});
