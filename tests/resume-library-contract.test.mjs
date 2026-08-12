import assert from "node:assert/strict";
import test from "node:test";

import { resumeLibrarySchema } from "../app/resume-library-contract.ts";
import { recentResumeImportsSchema } from "../app/resume-import-status-contract.ts";
import {
  resumeRevisionComparisonSchema,
  resumeRevisionResponseSchema,
} from "../app/resume-revision-contract.ts";
import { isDisplaySafeResumeSourceLabel } from "../db/resume-revision-policy.ts";

const library = {
  schemaVersion: 1,
  sources: [{
    resumeId: "primary-resume",
    sourceLabel: "Primary resume",
    currentRevisionId: "resume-revision-2",
    updatedAt: 20,
    revisions: [{
      revisionId: "resume-revision-2",
      parentRevisionId: "resume-revision-1",
      importedAt: 20,
      current: true,
      files: [{
        format: "docx",
        sha256: "a".repeat(64),
        byteSize: 2048,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        downloadPath: "/api/resume-library/primary-resume/resume-revision-2/docx",
      }, {
        format: "pdf",
        sha256: "b".repeat(64),
        byteSize: 4096,
        mimeType: "application/pdf",
        downloadPath: "/api/resume-library/primary-resume/resume-revision-2/pdf",
      }],
    }],
  }],
  limits: { sources: 20, revisionsPerSource: 20 },
  truncated: { sources: false, revisions: false },
};

test("the Resume Library accepts only bounded owner-private display metadata", () => {
  assert.deepEqual(resumeLibrarySchema.parse(library), library);
  assert.throws(() => resumeLibrarySchema.parse({
    ...library,
    sources: [{ ...library.sources[0], objectKey: "private/key" }],
  }));
});

test("recent import receipts expose retry state without request hashes or locators", () => {
  const receipts = {
    schemaVersion: 1,
    imports: [{
      operationId: "resume-import-operation-1",
      resumeId: "primary-resume",
      revisionId: "resume-revision-2",
      status: "retryable_failure",
      errorCode: "resume_import_storage_failure",
      retryable: true,
      createdAt: 10,
      updatedAt: 20,
      completedAt: null,
    }],
    limit: 10,
    truncated: false,
  };
  assert.deepEqual(recentResumeImportsSchema.parse(receipts), receipts);
  assert.throws(() => recentResumeImportsSchema.parse({
    ...receipts,
    imports: [{ ...receipts.imports[0], requestHash: "a".repeat(64) }],
  }));
  assert.throws(() => recentResumeImportsSchema.parse({
    ...receipts,
    imports: [{ ...receipts.imports[0], errorCode: "/private/resume.docx" }],
  }));
});

test("the Resume Library rejects unsafe download paths and malformed integrity", () => {
  assert.throws(() => resumeLibrarySchema.parse({
    ...library,
    sources: [{
      ...library.sources[0],
      revisions: [{
        ...library.sources[0].revisions[0],
        files: [{ ...library.sources[0].revisions[0].files[0], downloadPath: "https://private.example/file" }],
      }],
    }],
  }));
  assert.throws(() => resumeLibrarySchema.parse({
    ...library,
    sources: [{
      ...library.sources[0],
      revisions: [{
        ...library.sources[0].revisions[0],
        files: [{ ...library.sources[0].revisions[0].files[0], sha256: "not-a-digest" }],
      }],
    }],
  }));
});

test("resume source labels cannot carry private locators, identities, or credentials", () => {
  assert.equal(isDisplaySafeResumeSourceLabel("Primary resume"), true);
  for (const value of [
    "/Users/example/private/resume.pdf",
    "private@example.com",
    "https://docs.example/private",
    "C:\\Users\\example\\resume.docx",
    "github_pat_examplecredential",
  ]) assert.equal(isDisplaySafeResumeSourceLabel(value), false);
});

test("exact revision details expose bounded semantic provenance without private storage identity", () => {
  const revision = {
    found: true,
    schemaVersion: 1,
    source: {
      resumeId: "primary-resume",
      sourceLabel: "Primary resume",
      currentRevisionId: "resume-revision-2",
      updatedAt: 20,
    },
    revision: {
      revisionId: "resume-revision-2",
      parentRevisionId: "resume-revision-1",
      current: true,
      sourceFingerprint: "a".repeat(64),
      sourceProvider: "google_drive",
      sourceRevisionFingerprint: "b".repeat(64),
      manifestFingerprint: "c".repeat(64),
      extractionVersion: "resume-extract-v1",
      importedAt: 20,
      files: library.sources[0].revisions[0].files,
      bullets: [{
        occurrenceId: "experience-platform-0",
        sectionLabel: "Experience",
        ordinal: 0,
        text: "Designed and operated a reliable service.",
        contentFingerprint: "d".repeat(64),
        claimIds: ["claim-platform"],
        evidenceIds: ["evidence-platform"],
      }],
      reviewImpacts: [{
        questionId: "behavioral-platform",
        solutionProfileRevision: 3,
        changedClaimIds: ["claim-platform"],
        status: "needs_review",
        createdAt: 20,
        acknowledgedAt: null,
      }],
      truncated: { bullets: false, links: false, reviewImpacts: false },
    },
  };
  assert.deepEqual(resumeRevisionResponseSchema.parse(revision), revision);
  assert.throws(() => resumeRevisionResponseSchema.parse({
    ...revision,
    revision: { ...revision.revision, objectKey: "private/object" },
  }));
});

test("revision comparison keeps textual and evidence-link deltas structurally separate", () => {
  const bullet = {
    occurrenceId: "experience-platform-0",
    sectionLabel: "Experience",
    ordinal: 0,
    text: "Designed and operated a reliable service.",
    contentFingerprint: "d".repeat(64),
    claimIds: ["claim-platform"],
    evidenceIds: ["evidence-platform"],
  };
  const comparison = {
    found: true,
    schemaVersion: 1,
    resumeId: "primary-resume",
    fromRevisionId: "resume-revision-1",
    toRevisionId: "resume-revision-2",
    summary: { added: 0, removed: 0, changed: 1, unchanged: 0 },
    added: [],
    removed: [],
    changed: [{
      occurrenceId: bullet.occurrenceId,
      before: bullet,
      after: { ...bullet, text: "Operated a reliable service.", contentFingerprint: "e".repeat(64) },
      changes: {
        contentChanged: true,
        positionChanged: false,
        claimDelta: { added: [], removed: [] },
        evidenceDelta: { added: [], removed: [] },
      },
    }],
    unchangedOccurrenceIds: [],
    references: {
      claims: { added: [], removed: [] },
      evidence: { added: [], removed: [] },
    },
  };
  assert.deepEqual(resumeRevisionComparisonSchema.parse(comparison), comparison);
});
