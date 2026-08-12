import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  GoogleDocResumeImportError,
  importGoogleDocResume,
} from "../scripts/import-google-doc-resume.mjs";

const DOCX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\n% synthetic private fixture\n%%EOF");

async function createFixture(overrides = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "interview-arc-google-resume-"));
  const exportDirectory = path.join(root, "connector-exports");
  const capturePath = path.join(root, "capture.private.json");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(exportDirectory, { recursive: true }));
  await writeFile(path.join(exportDirectory, "source.docx"), DOCX_BYTES);
  await writeFile(path.join(exportDirectory, "snapshot.pdf"), PDF_BYTES);
  const observation = {
    fileId: "synthetic-private-drive-id",
    mimeType: "application/vnd.google-apps.document",
    modifiedTime: "2026-08-11T20:00:00.000Z",
    version: "42",
  };
  const capture = {
    schemaVersion: 1,
    operationId: "google-resume-import-1",
    resumeId: "primary-resume",
    revisionId: "primary-resume-r1",
    sourceLabel: "Primary resume",
    capturedAt: 1_786_505_200_000,
    source: {
      provider: "google_drive",
      beforeExports: observation,
      afterExports: overrides.afterExports ?? observation,
    },
    exports: {
      docxPath: "connector-exports/source.docx",
      pdfPath: "connector-exports/snapshot.pdf",
    },
    extraction: {
      version: "resume-extract-v1",
      bullets: [{
        occurrenceId: "experience-platform-0",
        sectionLabel: "Experience",
        ordinal: 0,
        text: overrides.bulletText ?? "Designed and operated a reliable service.",
        claimIds: [],
        evidenceIds: [],
      }],
    },
  };
  await writeFile(capturePath, `${JSON.stringify(capture, null, 2)}\n`);
  return { root, capturePath, capture };
}

function savedResponse(capture) {
  return new Response(JSON.stringify({
    operationId: capture.operationId,
    status: "saved",
    unchanged: false,
    resumeId: capture.resumeId,
    revisionId: capture.revisionId,
    parentRevisionId: null,
    currentRevisionId: capture.revisionId,
    importedAt: 1_786_505_300_000,
    files: {
      docx: { sha256: "a".repeat(64), byteSize: DOCX_BYTES.byteLength },
      pdf: { sha256: "b".repeat(64), byteSize: PDF_BYTES.byteLength },
    },
  }), { status: 201, headers: { "content-type": "application/json" } });
}

test("an authenticated stable Google Doc export becomes one private mirror and bounded remote import", async (context) => {
  const fixture = await createFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const requests = [];
  const fetchImpl = async (endpoint, request) => {
    requests.push({ endpoint, request });
    return savedResponse(fixture.capture);
  };

  const imported = await importGoogleDocResume({
    capturePath: fixture.capturePath,
    root: fixture.root,
    endpoint: "https://resume-import.example.test/resume/imports",
    token: "synthetic-integration-token",
    fetchImpl,
  });

  assert.equal(imported.status, "saved");
  assert.equal(imported.localMirror, "private-sources/resume-library/imports/primary-resume/primary-resume-r1");
  assert.equal(imported.localMirrorUnchanged, false);
  const mirror = path.join(fixture.root, imported.localMirror);
  assert.deepEqual(new Uint8Array(await readFile(path.join(mirror, "source.docx"))), DOCX_BYTES);
  assert.deepEqual(new Uint8Array(await readFile(path.join(mirror, "snapshot.pdf"))), PDF_BYTES);
  const privateManifest = JSON.parse(await readFile(path.join(mirror, "manifest.private.json"), "utf8"));
  assert.equal(privateManifest.source.revision.fileId, "synthetic-private-drive-id");
  assert.equal(privateManifest.ingestManifest.sourceProvider, "google_drive");
  assert.equal(privateManifest.ingestManifest.bullets[0].text, "Designed and operated a reliable service.");

  assert.equal(requests.length, 1);
  assert.equal(requests[0].endpoint.toString(), "https://resume-import.example.test/resume/imports");
  assert.equal(requests[0].request.headers.authorization, "Bearer synthetic-integration-token");
  const form = requests[0].request.body;
  const remoteManifest = JSON.parse(form.get("manifest"));
  assert.equal(remoteManifest.sourceProvider, "google_drive");
  assert.equal(remoteManifest.sourceRevisionFingerprint.length, 64);
  assert.equal(remoteManifest.bullets[0].contentFingerprint.length, 64);
  assert.equal(JSON.stringify(remoteManifest).includes("synthetic-private-drive-id"), false);
  assert.equal(JSON.stringify(remoteManifest).includes(fixture.root), false);
  assert.equal(form.get("sourceFingerprint"), remoteManifest.sourceRevisionFingerprint);
  assert.equal(form.get("docx").type, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(form.get("pdf").type, "application/pdf");

  const exactRetry = await importGoogleDocResume({
    capturePath: fixture.capturePath,
    root: fixture.root,
    endpoint: "https://resume-import.example.test/resume/imports",
    token: "synthetic-integration-token",
    fetchImpl,
  });
  assert.equal(exactRetry.localMirrorUnchanged, true);
  assert.equal(requests.length, 2);
  assert.deepEqual(
    await readdir(path.dirname(mirror)),
    ["primary-resume-r1"],
  );
});

test("a Drive revision change during export fails before local or remote persistence", async (context) => {
  const fixture = await createFixture({
    afterExports: {
      fileId: "synthetic-private-drive-id",
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: "2026-08-11T20:01:00.000Z",
      version: "43",
    },
  });
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  let called = false;

  await assert.rejects(
    importGoogleDocResume({
      capturePath: fixture.capturePath,
      root: fixture.root,
      endpoint: "https://resume-import.example.test/resume/imports",
      token: "synthetic-integration-token",
      fetchImpl: async () => { called = true; return savedResponse(fixture.capture); },
    }),
    (error) => error instanceof GoogleDocResumeImportError && error.code === "resume_source_changed_during_export",
  );
  assert.equal(called, false);
  await assert.rejects(
    readFile(path.join(fixture.root, "private-sources/resume-library/imports/primary-resume/primary-resume-r1/manifest.private.json")),
    { code: "ENOENT" },
  );
});

test("an immutable local revision conflicts instead of accepting changed content", async (context) => {
  const fixture = await createFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  await importGoogleDocResume({ capturePath: fixture.capturePath, root: fixture.root, mirrorOnly: true });
  fixture.capture.extraction.bullets[0].text = "Changed wording under the same immutable revision.";
  await writeFile(fixture.capturePath, `${JSON.stringify(fixture.capture, null, 2)}\n`);

  await assert.rejects(
    importGoogleDocResume({ capturePath: fixture.capturePath, root: fixture.root, mirrorOnly: true }),
    (error) => error instanceof GoogleDocResumeImportError && error.code === "resume_local_mirror_conflict",
  );
});

test("a remote failure preserves the exact private mirror for a successful retry", async (context) => {
  const fixture = await createFixture();
  context.after(() => rm(fixture.root, { recursive: true, force: true }));
  const endpoint = "https://resume-import.example.test/resume/imports";
  const failedFetch = async () => new Response(JSON.stringify({
    code: "resume_import_unavailable",
    error: "The private resume import is temporarily unavailable.",
    retryable: true,
  }), { status: 503, headers: { "content-type": "application/json" } });

  await assert.rejects(
    importGoogleDocResume({
      capturePath: fixture.capturePath,
      root: fixture.root,
      endpoint,
      token: "synthetic-integration-token",
      fetchImpl: failedFetch,
    }),
    (error) => error instanceof GoogleDocResumeImportError && error.code === "resume_import_unavailable" && error.retryable,
  );
  const mirror = path.join(fixture.root, "private-sources/resume-library/imports/primary-resume/primary-resume-r1");
  assert.equal(JSON.parse(await readFile(path.join(mirror, "manifest.private.json"), "utf8")).operationId, fixture.capture.operationId);
  await assert.rejects(readFile(path.join(mirror, "import-receipt.private.json")), { code: "ENOENT" });

  const retried = await importGoogleDocResume({
    capturePath: fixture.capturePath,
    root: fixture.root,
    endpoint,
    token: "synthetic-integration-token",
    fetchImpl: async () => savedResponse(fixture.capture),
  });
  assert.equal(retried.status, "saved");
  assert.equal(retried.localMirrorUnchanged, true);
  assert.equal(JSON.parse(await readFile(path.join(mirror, "import-receipt.private.json"), "utf8")).status, "saved");
});
