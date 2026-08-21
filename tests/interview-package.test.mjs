import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  addInterviewPackageEntrySchema,
  createInterviewPackageSchema,
  declareInterviewPackageSourceSchema,
  finalizeInterviewPackageSchema,
  prepareInterviewPackageMaterialProposalSchema,
} from "../db/interview-package-policy.ts";
import {
  createSuppliedInterviewTranscriptParser,
  interviewPackageObjectLocator,
  interviewPackageSignatureMatches,
  parseSuppliedInterviewTranscript,
} from "../db/interview-package-content-policy.ts";
import {
  createLoopInterviewMaterialSchema,
  websiteCreateLoopInterviewMaterialSchema,
} from "../db/loop-policy.ts";

const packageId = "pkg_1234567890abcdef1234567890abcdef12345678";

test("Interview Package policy keeps assignment explicit and requires recording consent", () => {
  const input = {
    schemaVersion: 1,
    operationId: "package-create-1",
    interviewAt: Date.parse("2026-08-21T16:00:00Z"),
    timeZone: "America/Los_Angeles",
    assignment: {
      loopId: "loop-example",
      stageId: "round-system-design",
      expectedLoopRevision: 2,
      expectedRoleBriefRevision: 3,
    },
    consentAffirmed: true,
  };
  assert.equal(createInterviewPackageSchema.safeParse(input).success, true);
  assert.equal(createInterviewPackageSchema.safeParse({ ...input, consentAffirmed: false }).success, false);
  assert.equal(createInterviewPackageSchema.safeParse({ ...input, timeZone: undefined }).success, false);
  assert.equal(createInterviewPackageSchema.safeParse({ ...input, assignment: undefined }).success, true);
});

test("source allowlists reject active content, oversized files, and kind confusion", () => {
  const base = {
    schemaVersion: 1,
    operationId: "source-declare-1",
    packageId,
    expectedRevision: 1,
    label: "Interview source",
    sizeBytes: 100,
  };
  assert.equal(declareInterviewPackageSourceSchema.safeParse({ ...base, kind: "audio", mediaType: "audio/mp4" }).success, true);
  assert.equal(declareInterviewPackageSourceSchema.safeParse({ ...base, kind: "transcript", mediaType: "text/vtt" }).success, true);
  assert.equal(declareInterviewPackageSourceSchema.safeParse({ ...base, kind: "document", mediaType: "text/html" }).success, false);
  assert.equal(declareInterviewPackageSourceSchema.safeParse({ ...base, kind: "image", mediaType: "image/svg+xml" }).success, false);
  assert.equal(declareInterviewPackageSourceSchema.safeParse({ ...base, kind: "image", mediaType: "image/png", sizeBytes: 26 * 1024 * 1024 }).success, false);
});

test("external links are HTTPS-only, credential-free, and never fetched by policy", () => {
  const base = { schemaVersion: 1, operationId: "entry-add-1", packageId, expectedRevision: 1 };
  assert.equal(addInterviewPackageEntrySchema.safeParse({ ...base, entry: { kind: "link", label: "Take-home", url: "https://example.com/prompt" } }).success, true);
  assert.equal(addInterviewPackageEntrySchema.safeParse({ ...base, entry: { kind: "link", label: "Unsafe", url: "http://example.com" } }).success, false);
  assert.equal(addInterviewPackageEntrySchema.safeParse({ ...base, entry: { kind: "link", label: "Credentials", url: "https://name:secret@example.com" } }).success, false);
});

test("signature checks distinguish allowlisted bytes from mislabeled or active content", () => {
  assert.equal(interviewPackageSignatureMatches("image", "image/png", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true);
  assert.equal(interviewPackageSignatureMatches("audio", "audio/mp4", new TextEncoder().encode("....ftypM4A ")), true);
  assert.equal(interviewPackageSignatureMatches("document", "application/pdf", new TextEncoder().encode("%PDF-1.7")), true);
  assert.equal(interviewPackageSignatureMatches("document", "text/markdown", new Uint8Array(), "# Interview prompt"), true);
  assert.equal(interviewPackageSignatureMatches("document", "text/markdown", new Uint8Array(), "<script>alert(1)</script>"), false);
  assert.equal(interviewPackageSignatureMatches("image", "image/png", new TextEncoder().encode("not png")), false);
});

test("supplied VTT is parsed deterministically with immutable timing provenance", () => {
  const parsed = parseSuppliedInterviewTranscript("text/vtt", "\uFEFFWEBVTT\r\n\r\n00:00:01.000 --> 00:00:03.000\r\nHello\r\nworld\r\n");
  assert.deepEqual(parsed, {
    schemaVersion: 1,
    format: "vtt",
    cueCount: 1,
    cues: [{ sequence: 1, timing: "00:00:01.000 --> 00:00:03.000", text: "Hello\nworld" }],
  });
  assert.throws(() => parseSuppliedInterviewTranscript("text/vtt", "not a vtt"), (error) => error.code === "interview_package_signature_mismatch");
});

test("supplied transcript parsing preserves cues across arbitrary stream boundaries", () => {
  const parser = createSuppliedInterviewTranscriptParser("text/vtt");
  for (const chunk of ["\uFEFFWEB", "VTT\r\n\r", "\n00:00:01.000 --> ", "00:00:03.000\r\nHel", "lo\r\nworld\r", "\n"]) {
    parser.push(chunk);
  }
  assert.deepEqual(parser.finish(), {
    schemaVersion: 1,
    format: "vtt",
    cueCount: 1,
    cues: [{ sequence: 1, timing: "00:00:01.000 --> 00:00:03.000", text: "Hello\nworld" }],
  });
});

test("private object locators are opaque and owner-partitioned", async () => {
  const first = await interviewPackageObjectLocator("owner-a", packageId, "source-private");
  const exact = await interviewPackageObjectLocator("owner-a", packageId, "source-private");
  const otherOwner = await interviewPackageObjectLocator("owner-b", packageId, "source-private");
  assert.equal(first, exact);
  assert.notEqual(first, otherOwner);
  assert.match(first, /^interview-packages\/[a-f0-9]{64}\/asset$/);
  assert.doesNotMatch(first, /owner-a|pkg_|source-private/);
});

test("package finalization requires an explicit nonempty exact set", () => {
  const base = { schemaVersion: 1, operationId: "finalize-1", packageId, expectedRevision: 3, finalizeSubset: false };
  assert.equal(finalizeInterviewPackageSchema.safeParse({ ...base, includedSourceIds: ["source-1"], includedEntryIds: [] }).success, true);
  assert.equal(finalizeInterviewPackageSchema.safeParse({ ...base, includedSourceIds: [], includedEntryIds: [] }).success, false);
  assert.equal(finalizeInterviewPackageSchema.safeParse({ ...base, includedSourceIds: ["source-1", "source-1"], includedEntryIds: [] }).success, false);
});

test("website material confirmation is a narrow authority adapter", () => {
  const material = {
    materialId: "material-package-1",
    loopId: "loop-example",
    stageId: "round-system-design",
    kind: "interview_prep",
    state: "active",
    label: "System design follow-up",
    sections: [{ sectionId: "section-1", title: "Review", body: "Owner-authored follow-up material", bullets: [] }],
    provenance: { kind: "owner_authorized_synthesis", roleBriefRevision: 3, activityIds: [], sourceLabel: "Selected Interview Package sources", preparedAt: 1 },
  };
  const command = { operationId: "material-command-1", expectedLoopRevision: 2, expectedRoleBriefRevision: 3, material };
  assert.equal(websiteCreateLoopInterviewMaterialSchema.safeParse({ ...command, authorization: "website_owner" }).success, true);
  assert.equal(createLoopInterviewMaterialSchema.safeParse({ ...command, authorization: "website_owner" }).success, false);
  assert.equal(prepareInterviewPackageMaterialProposalSchema.safeParse({
    schemaVersion: 1,
    operationId: "proposal-1",
    packageId,
    expectedRevision: 4,
    baseMaterialRevision: null,
    baseLoopRevision: 2,
    baseRoleBriefRevision: 3,
    selectedSourceIds: ["source-1"],
    proposedMaterial: material,
  }).success, true);
});

test("website routes keep private authority server-side and expose bounded recovery UI", async () => {
  const [route, uploadRoute, readerRoute, dialog, storage, packages, migration] = await Promise.all([
    readFile(new URL("../app/api/interview-packages/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/interview-packages/[packageId]/sources/[sourceId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/interview-packages/sources/[sourceId]/content/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/interview-package-dialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/interview-package-storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/interview-packages.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0049_interview_packages.sql", import.meta.url), "utf8"),
  ]);
  for (const source of [route, uploadRoute, readerRoute]) assert.match(source, /resolveOwnerId\(request\)/);
  assert.match(route, /idempotency-key/);
  assert.match(uploadRoute, /boundedPart/);
  assert.match(readerRoute, /serveInterviewPackageSource/);
  assert.doesNotMatch(dialog, /ownerId|privateLocator|r2UploadId/);
  assert.match(dialog, /Unassigned inbox/);
  assert.match(dialog, /Finalize \{selected\.sources\.some/);
  assert.match(dialog, /Resume upload/);
  assert.match(dialog, /Revise /);
  assert.match(dialog, /packageId=/);
  assert.match(dialog, /Show 100 more blocks/);
  assert.match(dialog, /No material relationship/);
  assert.match(dialog, /does not synthesize it with AI/);
  assert.match(migration, /interview_package_upload_parts/);
  assert.match(migration, /interview_package_material_proposals/);
  assert.match(migration, /interview_package_operations/);
  assert.match(storage, /returning\(\{ sessionId:/);
  assert.match(storage, /delete\(interviewPackageUploadParts\)/);
  assert.match(packages, /inArray\(interviewPackageSources\.packageId, packageIds\)/);
  assert.match(packages, /materialPrepared\.statements/);
});
