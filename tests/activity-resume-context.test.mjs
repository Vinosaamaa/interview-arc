import assert from "node:assert/strict";
import test from "node:test";

import {
  backfillActivityResumeContextSchema,
  renderActivityResumeContextHtml,
  renderActivityResumeContextMarkdown,
  storedActivityResumeContextSchema,
} from "../db/activity-resume-context.ts";

const fingerprint = "a".repeat(64);

const context = {
  schemaVersion: 1,
  state: "contemporaneous",
  snapshotRevision: 2,
  resumeId: "resume-primary",
  resumeRevisionId: "resume-revision-2",
  sourceLabel: "Primary resume",
  resumeImportedAt: 1_786_363_000_000,
  claimIds: ["claim-one"],
  evidenceIds: ["evidence-one"],
  capturedAt: 1_786_363_200_000,
};

test("resume context is closed, bounded, and rejects private storage metadata", () => {
  assert.deepEqual(storedActivityResumeContextSchema.parse(context), context);
  assert.throws(() => storedActivityResumeContextSchema.parse({ ...context, objectKey: "private/object" }));
  assert.throws(() => storedActivityResumeContextSchema.parse({ ...context, claimIds: ["claim-one", "claim-one"] }));
});

test("Markdown and HTML render the same immutable identity without resume contents", () => {
  const markdown = renderActivityResumeContextMarkdown(context);
  const html = renderActivityResumeContextHtml(context);
  for (const value of [context.sourceLabel, context.resumeRevisionId, context.claimIds[0], context.evidenceIds[0]]) {
    assert.match(markdown, new RegExp(value));
    assert.match(html, new RegExp(value));
  }
  assert.match(html, /data-activity-resume-context="true"/);
  assert.doesNotMatch(`${markdown}${html}`, /objectKey|storageGeneration|providerLocator/);
});

test("historical context requires exact loaded fingerprints and owner confirmation", () => {
  const input = {
    operationId: "resume-context-backfill-one",
    activityId: "behavioral-attempt-one",
    snapshotRevision: 1,
    resumeId: "resume-primary",
    resumeRevisionId: "resume-revision-1",
    provenance: {
      sourceFingerprint: fingerprint,
      docxSha256: fingerprint,
      pdfSha256: fingerprint,
      resumeImportedAt: 1_786_363_000_000,
      snapshotLoadedAt: 1_786_363_100_000,
    },
    authorization: "explicit_user_instruction",
    ownerConfirmedAt: 1_786_363_200_000,
    reason: "The owner confirmed the exact snapshot used for this attempt.",
  };
  assert.deepEqual(backfillActivityResumeContextSchema.parse(input), input);
  assert.throws(() => backfillActivityResumeContextSchema.parse({
    ...input,
    authorization: "inferred_from_date",
  }));
  assert.throws(() => backfillActivityResumeContextSchema.parse({
    ...input,
    ownerConfirmedAt: input.provenance.snapshotLoadedAt - 1,
  }));
  assert.throws(() => backfillActivityResumeContextSchema.parse({
    ...input,
    provenance: { ...input.provenance, pdfSha256: "private/file.pdf" },
  }));
});
