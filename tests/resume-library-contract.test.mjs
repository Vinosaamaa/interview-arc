import assert from "node:assert/strict";
import test from "node:test";

import { resumeLibrarySchema } from "../app/resume-library-contract.ts";
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
