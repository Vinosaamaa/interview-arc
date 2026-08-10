import assert from "node:assert/strict";
import test from "node:test";

import {
  renderActivityResumeContextHtml,
  renderActivityResumeContextMarkdown,
  storedActivityResumeContextSchema,
} from "../db/activity-resume-context.ts";

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
