import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertRemoteSafe,
  buildBehavioralEvidenceSite,
  validateBehavioralEvidenceBundle,
} from "../scripts/build-behavioral-evidence-site.mjs";
import {
  authorizeBehavioralFilesystemSources,
  pinBehavioralEvidenceProvenance,
  prepareBehavioralEvidenceSyncPlan,
  refreshBehavioralEvidenceSources,
  summarizeBehavioralEvidenceBundle,
} from "../scripts/behavioral-evidence-controller.mjs";

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function projectFixture() {
  return {
    schemaVersion: 1,
    project: {
      id: "example-project",
      title: "Example project",
      organization: "Example organization",
      relationship: "company_project",
      summary: "A deliberately generic fixture for the local evidence contract.",
      reviewState: "pending_owner_review",
      visibility: "local_only",
      dossierPath: "dossier.md",
      sourceRevision: "example-revision",
      evidenceBoundary: "The fixture proves contract behavior only; it proves no personal ownership or result.",
      inspectedAt: "2026-08-09T10:00:00.000Z",
      tags: ["fixture"],
    },
    sources: [{
      id: "EX-SRC-001",
      kind: "repository",
      label: "Authorized local fixture",
      locator: "remote:authorized-local-project",
      refreshMode: "remote",
      safeHint: "Authorized local project",
      authorization: "user_authorized",
      sensitivity: "private",
      availability: "available",
      visibility: "local_only",
      revision: "example-revision",
      inspectedAt: "2026-08-09T10:00:00.000Z",
      canSupport: ["Scoped project behavior"],
      cannotSupport: ["Personal ownership or production impact"],
    }],
    evidence: [{
      id: "EX-EV-001",
      origin: "code_observation",
      statement: "The fixture contains a traceable component relationship.",
      sourceIds: ["EX-SRC-001"],
      safeLocators: ["src/example"],
      evidenceGrade: "E3",
      attributionGrade: "A0",
      claimStrength: "project_fact",
      candidateState: "pending",
      visibility: "local_only",
      supports: ["A project-fact candidate"],
      limitations: ["No personal attribution"],
      contraryEvidenceIds: [],
      tags: ["architecture"],
    }],
    claims: [{
      id: "EX-CL-001",
      text: "The project implements the example relationship.",
      scope: "project",
      status: "partial",
      claimStrength: "project_fact",
      evidenceGrade: "E3",
      attributionGrade: "A0",
      evidenceIds: ["EX-EV-001"],
      contraryEvidenceIds: [],
      gaps: ["Owner review is pending"],
      visibility: "local_only",
      saferWording: "The inspected project implements the example relationship.",
      tags: ["architecture"],
    }],
    contradictions: [{
      id: "EX-GAP-001",
      priority: "P1",
      summary: "Personal ownership is not established.",
      evidenceIds: ["EX-EV-001"],
      resolutionQuestion: "What exact part did the owner personally design or implement?",
      status: "open",
    }],
    storySeeds: [{
      id: "EX-STORY-001",
      title: "Example story seed",
      situationFacts: ["A project relationship existed."],
      taskFacts: [],
      actionFacts: [],
      resultFacts: [],
      learningFacts: [],
      missingFields: ["Personal task, action, result, and learning"],
      evidenceIds: ["EX-EV-001"],
      evidenceGrade: "E1",
      attributionGrade: "A0",
      status: "needs_confirmation",
      tags: ["fixture"],
    }],
    curriculum: [{
      id: "EX-CUR-001",
      title: "Confirm ownership",
      objective: "Separate project behavior from personal contribution.",
      priority: 1,
      status: "not_started",
      evidenceIds: ["EX-EV-001"],
      questions: ["What did you personally change?"],
    }],
    diagrams: [{
      id: "EX-DIA-001",
      title: "Example evidence relationship",
      kind: "provenance",
      sourceFormat: "mermaid",
      sourcePath: "diagrams/example.mmd",
      evidenceIds: ["EX-EV-001"],
      relationshipBasis: "evidence_provenance_only",
      limitations: ["Fixture only"],
      visibility: "local_only",
    }],
    sanitization: [{
      id: "EX-SAN-001",
      sensitivity: "path",
      privatePattern: "absolute source path",
      transformation: "Replace with a generic local-source label.",
      publicDisposition: "omit",
      reviewStatus: "pending",
    }],
    d1Candidates: [],
    d1Exclusions: [{
      id: "EX-D1-EXCLUSION-001",
      sourceEvidenceId: "EX-EV-001",
      disposition: "local_only",
      reason: "The base fixture exercises an explicit local-only disposition.",
    }],
    publicationCandidates: [],
  };
}

async function createFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "behavioral-evidence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, "projects", "example-project");
  await mkdir(path.join(projectRoot, "diagrams"), { recursive: true });
  await writeJson(path.join(root, "manifest.json"), {
    schemaVersion: 1,
    bundleId: "behavioral-foundation-fixture",
    title: "Behavioral evidence fixture",
    visibility: "local_only",
    createdAt: "2026-08-09T10:00:00.000Z",
    updatedAt: "2026-08-09T10:00:00.000Z",
    projects: [{ id: "example-project", recordPath: "projects/example-project/project.json" }],
  });
  await writeJson(path.join(projectRoot, "project.json"), projectFixture());
  await writeFile(path.join(projectRoot, "dossier.md"), "# Example dossier\n\nComplete fixture narrative.\n", "utf8");
  await writeFile(path.join(projectRoot, "diagrams", "example.mmd"), "flowchart LR\n  Source --> Evidence\n", "utf8");
  return { root, projectRoot };
}

test("validates a schema-first bundle and resolves every cross-record link", async (t) => {
  const fixture = await createFixture(t);
  const result = await validateBehavioralEvidenceBundle({ bundleRoot: fixture.root });
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].record.project.id, "example-project");
});

test("rejects dangling evidence references", async (t) => {
  const fixture = await createFixture(t);
  const recordPath = path.join(fixture.projectRoot, "project.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.claims[0].evidenceIds = ["EX-EV-MISSING"];
  await writeJson(recordPath, record);
  await assert.rejects(
    validateBehavioralEvidenceBundle({ bundleRoot: fixture.root }),
    /unknown reference EX-EV-MISSING/,
  );
});

test("rejects verified personal claims without accepted A3 evidence", async (t) => {
  const fixture = await createFixture(t);
  const recordPath = path.join(fixture.projectRoot, "project.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.claims[0].scope = "personal_contribution";
  record.claims[0].status = "verified";
  record.evidence[0].candidateState = "accepted";
  record.d1Exclusions = [];
  await writeJson(recordPath, record);
  await assert.rejects(
    validateBehavioralEvidenceBundle({ bundleRoot: fixture.root }),
    /verified personal contributions require A3 attribution/,
  );
});

test("rejects verified project claims without accepted E3 evidence", async (t) => {
  const fixture = await createFixture(t);
  const recordPath = path.join(fixture.projectRoot, "project.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.claims[0].status = "verified";
  record.evidence[0].candidateState = "accepted";
  record.evidence[0].evidenceGrade = "E2";
  await writeJson(recordPath, record);
  await assert.rejects(
    validateBehavioralEvidenceBundle({ bundleRoot: fixture.root }),
    /verified project facts require accepted E3 evidence/,
  );
});

test("accepts verified project claims backed by accepted E3 evidence", async (t) => {
  const fixture = await createFixture(t);
  const recordPath = path.join(fixture.projectRoot, "project.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.claims[0].status = "verified";
  record.evidence[0].candidateState = "accepted";
  record.d1Exclusions = [];
  await writeJson(recordPath, record);

  await validateBehavioralEvidenceBundle({ bundleRoot: fixture.root });
});

test("rejects a declared diagram asset that is no longer readable", async (t) => {
  const fixture = await createFixture(t);
  await rm(path.join(fixture.projectRoot, "diagrams", "example.mmd"));

  await assert.rejects(
    validateBehavioralEvidenceBundle({ bundleRoot: fixture.root }),
    /cannot access the declared asset/,
  );
});

test("rejects a logical description classified as a filesystem locator", async (t) => {
  const fixture = await createFixture(t);
  const recordPath = path.join(fixture.projectRoot, "project.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.sources[0].refreshMode = "filesystem";
  record.sources[0].locator = "search and filtering implementation";
  await writeJson(recordPath, record);

  await assert.rejects(
    validateBehavioralEvidenceBundle({ bundleRoot: fixture.root }),
    /absolute canonical source root or exact file/,
  );
});

test("rejects file URI remote locators case-insensitively in schema and runtime contracts", async (t) => {
  const fixture = await createFixture(t);
  const recordPath = path.join(fixture.projectRoot, "project.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.sources[0].locator = "FILE:/private/example";
  await writeJson(recordPath, record);

  await assert.rejects(
    validateBehavioralEvidenceBundle({ bundleRoot: fixture.root }),
    /cannot use a file URI/,
  );

  const schema = JSON.parse(await readFile(new URL(
    "../docs/contracts/behavioral-evidence-project.schema.json",
    import.meta.url,
  ), "utf8"));
  const remotePattern = schema.$defs.source.allOf[1].then.properties.locator.pattern;
  assert.equal(new RegExp(remotePattern).test("FILE:/private/example"), false);
  assert.equal(new RegExp(remotePattern).test("https://example.invalid/source"), true);
});

test("rejects private locators and identities in remote-safe candidates", () => {
  const privateLocator = ["", "Users", "example", "private", "repository"].join("/");
  assert.throws(
    () => assertRemoteSafe({ content: { locator: privateLocator, contact: "person@example.test" } }),
    /absolute filesystem path/,
  );
});

test("generates byte-identical local HTML from unchanged inputs", async (t) => {
  const fixture = await createFixture(t);
  const first = await buildBehavioralEvidenceSite({ bundleRoot: fixture.root });
  const firstHtml = await readFile(first.indexPath, "utf8");
  const second = await buildBehavioralEvidenceSite({ bundleRoot: fixture.root });
  const secondHtml = await readFile(second.indexPath, "utf8");
  assert.equal(secondHtml, firstHtml);
  assert.match(firstHtml, /LOCAL PRIVATE PROJECTION/);
  assert.match(firstHtml, /Not synced to D1\. Not published\./);
});

test("removes stale private assets when regenerating the disposable site", async (t) => {
  const fixture = await createFixture(t);
  const first = await buildBehavioralEvidenceSite({ bundleRoot: fixture.root });
  const staleAsset = path.join(first.siteRoot, "assets", "removed-private-diagram.mmd");
  await writeFile(staleAsset, "private stale projection", "utf8");

  await buildBehavioralEvidenceSite({ bundleRoot: fixture.root });

  await assert.rejects(access(staleAsset), { code: "ENOENT" });
});

test("copies more than one bounded asset batch before writing the review", async (t) => {
  const fixture = await createFixture(t);
  const recordPath = path.join(fixture.projectRoot, "project.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.diagrams = [];
  for (let index = 0; index < 9; index += 1) {
    const id = `EX-DIA-${index}`;
    const sourcePath = `diagrams/example-${index}.mmd`;
    await writeFile(path.join(fixture.projectRoot, sourcePath), `flowchart LR\n  A${index} --> B${index}\n`, "utf8");
    record.diagrams.push({
      id,
      title: `Example evidence relationship ${index}`,
      kind: "provenance",
      sourceFormat: "mermaid",
      sourcePath,
      evidenceIds: ["EX-EV-001"],
      relationshipBasis: "evidence_provenance_only",
      limitations: ["Fixture only"],
      visibility: "local_only",
    });
  }
  await writeJson(recordPath, record);

  const result = await buildBehavioralEvidenceSite({ bundleRoot: fixture.root });

  await Promise.all(record.diagrams.map((diagram) => access(path.join(
    result.siteRoot,
    "assets",
    `example-project-${diagram.id}.mmd`,
  ))));
});

test("candidate variants share one closed canonical schema core", async () => {
  const schema = JSON.parse(await readFile(new URL(
    "../docs/contracts/behavioral-evidence-project.schema.json",
    import.meta.url,
  ), "utf8"));

  assert.ok(schema.$defs.candidateCore);
  for (const variant of ["remoteCandidate", "publicationCandidate"]) {
    assert.equal(schema.$defs[variant].unevaluatedProperties, false);
    assert.equal(schema.$defs[variant].allOf[0].$ref, "#/$defs/candidateCore");
  }
  assert.equal(schema.$defs.remoteCandidate.allOf[1].properties.kind.const, "evidence");
  assert.equal(schema.$defs.remoteCandidate.allOf[1].properties.content.$ref, "#/$defs/remoteEvidenceContent");
  assert.equal(schema.$defs.remoteExclusion.properties.disposition.const, "local_only");
});

test("local refresh prepares only typed remote-safe source and evidence operations", async (t) => {
  const fixture = await createFixture(t);
  const recordPath = path.join(fixture.projectRoot, "project.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.sources[0].locator = fixture.projectRoot;
  record.sources[0].refreshMode = "filesystem";
  record.d1Candidates = [{
    id: "EX-D1-001",
    kind: "evidence",
    visibility: "owner_private",
    content: {
      questionLinks: [{ questionId: "QUESTION-EXAMPLE-1", relevance: "supporting" }],
    },
    sourceEvidenceIds: ["EX-EV-001"],
    transformations: ["Omitted the private locator and implementation detail."],
    limitations: ["The observation does not establish personal ownership."],
  }];
  record.d1Exclusions = [];
  await writeJson(recordPath, record);
  await authorizeBehavioralFilesystemSources({ bundleRoot: fixture.root });

  const refreshed = await refreshBehavioralEvidenceSources({
    bundleRoot: fixture.root,
    now: new Date("2026-08-11T18:00:00.000Z"),
  });
  assert.equal(refreshed.inspected, 1);
  assert.deepEqual(
    await pinBehavioralEvidenceProvenance({
      bundleRoot: fixture.root,
      now: new Date("2026-08-11T18:00:30.000Z"),
    }),
    { pinned: 1, remotePinned: 0, currentPinned: 1, unchanged: 0 },
  );
  const { plan, planPath } = await prepareBehavioralEvidenceSyncPlan({
    bundleRoot: fixture.root,
    now: new Date("2026-08-11T18:01:00.000Z"),
  });
  assert.deepEqual(plan.summary, {
    sources: 1,
    evidenceWrites: 1,
    evidenceCandidates: 1,
    excludedEvidence: 0,
  });
  assert.equal(plan.sources[0].source.sourceId, "example-project.ex-src-001");
  assert.equal(plan.sources[0].expectedRevision, "read_current_registry_before_write");
  assert.equal(plan.evidence[0].input.evidence.candidateState, "pending");
  assert.equal(plan.evidence[0].input.questionLink.questionId, "question-example-1");
  assert.equal(plan.evidence[0].input.evidence.safeProvenance[0].reference, "example-project.ex-src-001");
  assert.doesNotMatch(JSON.stringify(plan), new RegExp(fixture.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(JSON.stringify(plan), /"safeLocators"|"locator"/);
  assert.equal(JSON.parse(await readFile(planPath, "utf8")).summary.evidenceWrites, 1);

  const bundle = await validateBehavioralEvidenceBundle({ bundleRoot: fixture.root });
  assert.deepEqual(summarizeBehavioralEvidenceBundle(bundle), {
    projects: 1,
    sources: 1,
    availableSources: 1,
    blockedSources: 0,
    evidence: 1,
    pendingEvidence: 1,
    remoteCandidates: 1,
    candidateCoveredEvidence: 1,
    excludedEvidence: 0,
    uncoveredPendingEvidence: 0,
    publicationCandidates: 0,
  });
});

test("source refresh preserves a pinned evidence payload and operation identity", async (t) => {
  const fixture = await createFixture(t);
  const sourceRoot = path.join(fixture.root, "authorized-source");
  await mkdir(sourceRoot);
  const sourceFile = path.join(sourceRoot, "public-safe-fixture.txt");
  await writeFile(sourceFile, "revision one\n", "utf8");
  const recordPath = path.join(fixture.projectRoot, "project.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.sources[0].locator = sourceRoot;
  record.sources[0].refreshMode = "filesystem";
  record.d1Candidates = [{
    id: "EX-D1-001",
    kind: "evidence",
    visibility: "owner_private",
    content: {
      questionLinks: [{ questionId: "QUESTION-EXAMPLE-1", relevance: "supporting" }],
    },
    sourceEvidenceIds: ["EX-EV-001"],
    transformations: ["Generalized the observation for owner-private review."],
    limitations: ["The observation does not establish personal ownership."],
  }];
  record.d1Exclusions = [];
  await writeJson(recordPath, record);
  await authorizeBehavioralFilesystemSources({ bundleRoot: fixture.root });
  await refreshBehavioralEvidenceSources({
    bundleRoot: fixture.root,
    now: new Date("2026-08-11T18:00:00.000Z"),
  });
  await pinBehavioralEvidenceProvenance({
    bundleRoot: fixture.root,
    now: new Date("2026-08-11T18:00:30.000Z"),
  });
  const first = await prepareBehavioralEvidenceSyncPlan({
    bundleRoot: fixture.root,
    now: new Date("2026-08-11T18:01:00.000Z"),
  });

  await writeFile(sourceFile, "revision two with a material source change\n", "utf8");
  const refreshed = await refreshBehavioralEvidenceSources({
    bundleRoot: fixture.root,
    now: new Date("2026-08-11T19:00:00.000Z"),
  });
  assert.equal(refreshed.changed, 1);
  const second = await prepareBehavioralEvidenceSyncPlan({
    bundleRoot: fixture.root,
    now: new Date("2026-08-11T19:01:00.000Z"),
  });

  assert.equal(
    second.plan.evidence[0].input.evidence.sourceRevision,
    first.plan.evidence[0].input.evidence.sourceRevision,
  );
  assert.equal(second.plan.evidence[0].input.operationId, first.plan.evidence[0].input.operationId);
  assert.deepEqual(second.plan.evidence[0].input, first.plan.evidence[0].input);
});

test("material evidence edits require a replacement identity after provenance is pinned", async (t) => {
  const fixture = await createFixture(t);
  const recordPath = path.join(fixture.projectRoot, "project.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.d1Candidates = [{
    id: "EX-D1-001",
    kind: "evidence",
    visibility: "owner_private",
    content: {
      questionLinks: [{ questionId: "QUESTION-EXAMPLE-1", relevance: "supporting" }],
    },
    sourceEvidenceIds: ["EX-EV-001"],
    transformations: ["Generalized the observation for owner-private review."],
    limitations: ["The observation does not establish personal ownership."],
  }];
  record.d1Exclusions = [];
  await writeJson(recordPath, record);
  await pinBehavioralEvidenceProvenance({
    bundleRoot: fixture.root,
    now: new Date("2026-08-11T18:00:00.000Z"),
  });

  const pinned = JSON.parse(await readFile(recordPath, "utf8"));
  pinned.evidence[0].statement = "A materially revised observation under the old identity.";
  await writeJson(recordPath, pinned);

  await assert.rejects(
    prepareBehavioralEvidenceSyncPlan({ bundleRoot: fixture.root }),
    /replacement evidence ID and explicit supersession/,
  );
});

test("migration reuses an authoritative remote source revision for existing evidence", async (t) => {
  const fixture = await createFixture(t);
  const recordPath = path.join(fixture.projectRoot, "project.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.sources[0].revision = "newer-local-source-revision";
  record.d1Candidates = [{
    id: "EX-D1-001",
    kind: "evidence",
    visibility: "owner_private",
    content: {
      questionLinks: [{ questionId: "QUESTION-EXAMPLE-1", relevance: "supporting" }],
    },
    sourceEvidenceIds: ["EX-EV-001"],
    transformations: ["Generalized the observation for owner-private review."],
    limitations: ["The observation does not establish personal ownership."],
  }];
  record.d1Exclusions = [];
  await writeJson(recordPath, record);
  const remoteSourceRevision = `source-set-${"a".repeat(64)}`;
  const snapshotPath = path.join(fixture.root, "remote-evidence-snapshot.json");
  await writeJson(snapshotPath, {
    schemaVersion: 1,
    visibility: "owner_private",
    evidence: [{ evidenceId: "ex-ev-001", sourceRevision: remoteSourceRevision }],
  });

  assert.deepEqual(
    await pinBehavioralEvidenceProvenance({
      bundleRoot: fixture.root,
      remoteSnapshotPath: snapshotPath,
      now: new Date("2026-08-11T18:00:00.000Z"),
    }),
    { pinned: 1, remotePinned: 1, currentPinned: 0, unchanged: 0 },
  );
  const pinnedBytes = await readFile(recordPath, "utf8");
  const pinnedManifestBytes = await readFile(path.join(fixture.root, "manifest.json"), "utf8");
  assert.deepEqual(
    await pinBehavioralEvidenceProvenance({
      bundleRoot: fixture.root,
      remoteSnapshotPath: snapshotPath,
      now: new Date("2026-08-11T19:00:00.000Z"),
    }),
    { pinned: 0, remotePinned: 0, currentPinned: 0, unchanged: 1 },
  );
  assert.equal(await readFile(recordPath, "utf8"), pinnedBytes);
  assert.equal(await readFile(path.join(fixture.root, "manifest.json"), "utf8"), pinnedManifestBytes);
  const { plan } = await prepareBehavioralEvidenceSyncPlan({ bundleRoot: fixture.root });
  assert.equal(plan.evidence[0].input.evidence.sourceRevision, remoteSourceRevision);
});

test("refresh inspects only typed filesystem sources and never guesses from locator text", async (t) => {
  const fixture = await createFixture(t);
  const recordPath = path.join(fixture.projectRoot, "project.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.sources[0].locator = fixture.projectRoot;
  record.sources[0].refreshMode = "filesystem";
  record.sources.push(
    {
      ...record.sources[0],
      id: "EX-SRC-REMOTE",
      locator: "https://example.invalid/private-source",
      refreshMode: "remote",
      availability: "missing",
    },
    {
      ...record.sources[0],
      id: "EX-SRC-CONVERSATION",
      kind: "user_statement",
      locator: "conversation:example-project:owner-confirmation",
      refreshMode: "conversation",
      availability: "missing",
    },
    {
      ...record.sources[0],
      id: "EX-SRC-BLOCKED",
      locator: "blocked:authorization-required",
      refreshMode: "blocked",
      authorization: "authorization_required",
      availability: "not_checked",
    },
    {
      ...record.sources[0],
      id: "EX-SRC-STALE",
      locator: path.join(fixture.root, "missing-source"),
      refreshMode: "filesystem",
      availability: "available",
    },
  );
  await writeJson(recordPath, record);
  await authorizeBehavioralFilesystemSources({ bundleRoot: fixture.root });

  const refreshed = await refreshBehavioralEvidenceSources({
    bundleRoot: fixture.root,
    now: new Date("2026-08-11T18:00:00.000Z"),
  });
  assert.deepEqual(refreshed, {
    inspected: 1,
    changed: 0,
    missing: 1,
    blocked: 1,
    notChecked: 2,
  });
  const updated = JSON.parse(await readFile(recordPath, "utf8"));
  assert.equal(updated.sources.find((source) => source.id === "EX-SRC-REMOTE").refreshStatus, undefined);
  assert.equal(updated.sources.find((source) => source.id === "EX-SRC-REMOTE").availability, "missing");
  assert.equal(updated.sources.find((source) => source.id === "EX-SRC-CONVERSATION").refreshStatus, undefined);
  assert.equal(updated.sources.find((source) => source.id === "EX-SRC-CONVERSATION").availability, "missing");
  assert.equal(updated.sources.find((source) => source.id === "EX-SRC-STALE").availability, "missing");
});

test("filesystem refresh requires an exact owner-authorized source identity and locator", async (t) => {
  const fixture = await createFixture(t);
  const recordPath = path.join(fixture.projectRoot, "project.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.sources[0].locator = fixture.projectRoot;
  record.sources[0].refreshMode = "filesystem";
  await writeJson(recordPath, record);

  await assert.rejects(
    refreshBehavioralEvidenceSources({ bundleRoot: fixture.root }),
    /outside the explicit owner authorization policy/,
  );

  await authorizeBehavioralFilesystemSources({ bundleRoot: fixture.root });
  record.sources[0].locator = path.join(fixture.root, "different-source");
  await mkdir(record.sources[0].locator);
  await writeJson(recordPath, record);

  await assert.rejects(
    refreshBehavioralEvidenceSources({ bundleRoot: fixture.root }),
    /outside the explicit owner authorization policy/,
  );
});

test("filesystem refresh rejects a symlink target changed after owner authorization", async (t) => {
  const fixture = await createFixture(t);
  const firstTarget = path.join(fixture.root, "first-target");
  const secondTarget = path.join(fixture.root, "second-target");
  const sourceLink = path.join(fixture.root, "authorized-source");
  await mkdir(firstTarget);
  await mkdir(secondTarget);
  await symlink(firstTarget, sourceLink, "dir");
  const recordPath = path.join(fixture.projectRoot, "project.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.sources[0].locator = sourceLink;
  record.sources[0].refreshMode = "filesystem";
  await writeJson(recordPath, record);
  await authorizeBehavioralFilesystemSources({ bundleRoot: fixture.root });

  await rm(sourceLink);
  await symlink(secondTarget, sourceLink, "dir");

  await assert.rejects(
    refreshBehavioralEvidenceSources({ bundleRoot: fixture.root }),
    /canonical path changed after owner authorization/,
  );
});

test("filesystem refresh leaves non-filesystem connector state byte-identical", async (t) => {
  const fixture = await createFixture(t);
  const recordPath = path.join(fixture.projectRoot, "project.json");
  const manifestPath = path.join(fixture.root, "manifest.json");
  const initialProjectBytes = await readFile(recordPath, "utf8");
  const initialManifestBytes = await readFile(manifestPath, "utf8");

  const first = await refreshBehavioralEvidenceSources({
    bundleRoot: fixture.root,
    now: new Date("2026-08-11T18:00:00.000Z"),
  });
  assert.equal(first.notChecked, 1);
  const firstProjectBytes = await readFile(recordPath, "utf8");
  const firstManifestBytes = await readFile(manifestPath, "utf8");
  assert.equal(firstProjectBytes, initialProjectBytes);
  assert.equal(firstManifestBytes, initialManifestBytes);

  const second = await refreshBehavioralEvidenceSources({
    bundleRoot: fixture.root,
    now: new Date("2026-08-11T19:00:00.000Z"),
  });
  assert.equal(second.notChecked, 1);
  assert.equal(await readFile(recordPath, "utf8"), firstProjectBytes);
  assert.equal(await readFile(manifestPath, "utf8"), firstManifestBytes);
});

test("repeated refresh leaves an unchanged blocked source byte-identical", async (t) => {
  const fixture = await createFixture(t);
  const recordPath = path.join(fixture.projectRoot, "project.json");
  const manifestPath = path.join(fixture.root, "manifest.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.sources[0].refreshMode = "blocked";
  record.sources[0].locator = "blocked:authorization-required";
  record.sources[0].authorization = "authorization_required";
  record.sources[0].availability = "blocked";
  record.sources[0].refreshStatus = "blocked";
  delete record.sources[0].revision;
  delete record.sources[0].inspectedAt;
  await writeJson(recordPath, record);
  const initialProjectBytes = await readFile(recordPath, "utf8");
  const initialManifestBytes = await readFile(manifestPath, "utf8");

  const refreshed = await refreshBehavioralEvidenceSources({
    bundleRoot: fixture.root,
    now: new Date("2026-08-11T18:00:00.000Z"),
  });

  assert.equal(refreshed.blocked, 1);
  assert.equal(await readFile(recordPath, "utf8"), initialProjectBytes);
  assert.equal(await readFile(manifestPath, "utf8"), initialManifestBytes);
});

test("sync preparation rejects stale non-filesystem revisions before writing a plan", async (t) => {
  const fixture = await createFixture(t);
  const recordPath = path.join(fixture.projectRoot, "project.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.sources[0].refreshStatus = "not_checked";
  await writeJson(recordPath, record);

  await assert.rejects(
    prepareBehavioralEvidenceSyncPlan({ bundleRoot: fixture.root }),
    /must have a current or changed refresh status/,
  );
  await assert.rejects(access(path.join(fixture.root, "sync", "plan.json")), { code: "ENOENT" });
});

test("sync preparation accepts an explicit local-only exclusion and reports it", async (t) => {
  const fixture = await createFixture(t);
  const { plan } = await prepareBehavioralEvidenceSyncPlan({ bundleRoot: fixture.root });
  assert.deepEqual(plan.summary, {
    sources: 1,
    evidenceWrites: 0,
    evidenceCandidates: 0,
    excludedEvidence: 1,
  });
});

test("sync preparation rejects a 168-pending zero-disposition bundle", async (t) => {
  const fixture = await createFixture(t);
  const recordPath = path.join(fixture.projectRoot, "project.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.evidence = Array.from({ length: 168 }, (_, index) => ({
    ...record.evidence[0],
    id: `EX-EV-${String(index + 1).padStart(3, "0")}`,
  }));
  record.d1Candidates = [];
  record.d1Exclusions = [];
  await writeJson(recordPath, record);

  await assert.rejects(
    prepareBehavioralEvidenceSyncPlan({ bundleRoot: fixture.root }),
    /168 pending evidence records without a D1 candidate or explicit local-only exclusion/,
  );
  await assert.rejects(access(path.join(fixture.root, "sync", "plan.json")), { code: "ENOENT" });
});

test("one canonical source can support many independently reviewable D1 candidates", async (t) => {
  const fixture = await createFixture(t);
  const recordPath = path.join(fixture.projectRoot, "project.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.evidence = Array.from({ length: 3 }, (_, index) => ({
    ...record.evidence[0],
    id: `EX-EV-00${index + 1}`,
  }));
  record.d1Candidates = record.evidence.map((evidence, index) => ({
    id: `EX-D1-00${index + 1}`,
    kind: "evidence",
    visibility: "owner_private",
    content: {
      questionLinks: [{ questionId: `QUESTION-EXAMPLE-${index + 1}`, relevance: "supporting" }],
    },
    sourceEvidenceIds: [evidence.id],
    transformations: ["Generalized the observation for owner-private review."],
    limitations: ["The observation does not establish personal ownership."],
  }));
  record.d1Exclusions = [];
  await writeJson(recordPath, record);
  await pinBehavioralEvidenceProvenance({
    bundleRoot: fixture.root,
    now: new Date("2026-08-11T18:00:00.000Z"),
  });

  const { plan } = await prepareBehavioralEvidenceSyncPlan({ bundleRoot: fixture.root });
  assert.equal(plan.summary.evidenceCandidates, 3);
  assert.equal(plan.summary.evidenceWrites, 3);
  assert.equal(new Set(plan.evidence.map((write) => write.input.evidence.evidenceId)).size, 3);
});

test("sync preparation rejects untyped or unsafe remote candidates before writing a plan", async (t) => {
  const fixture = await createFixture(t);
  const recordPath = path.join(fixture.projectRoot, "project.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.d1Candidates = [{
    id: "EX-D1-UNSAFE",
    kind: "evidence",
    visibility: "owner_private",
    content: {
      questionLinks: [{ questionId: "QUESTION-EXAMPLE-1", relevance: "supporting" }],
    },
    sourceEvidenceIds: ["EX-EV-001"],
    transformations: ["Retained src/private/implementation.ts"],
    limitations: ["Fixture only"],
  }];
  record.d1Exclusions = [];
  await writeJson(recordPath, record);

  await assert.rejects(
    prepareBehavioralEvidenceSyncPlan({ bundleRoot: fixture.root }),
    /private locator/,
  );
  await assert.rejects(access(path.join(fixture.root, "sync", "plan.json")), { code: "ENOENT" });
});

test("sync preparation rejects a remote candidate whose generated evidence is graded above E1", async (t) => {
  const fixture = await createFixture(t);
  const recordPath = path.join(fixture.projectRoot, "project.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.evidence[0].origin = "generated_secondary";
  record.evidence[0].evidenceGrade = "E2";
  record.d1Candidates = [{
    id: "EX-D1-OVERGRADED",
    kind: "evidence",
    visibility: "owner_private",
    content: {
      questionLinks: [{ questionId: "QUESTION-EXAMPLE-1", relevance: "supporting" }],
    },
    sourceEvidenceIds: ["EX-EV-001"],
    transformations: ["Generalized the observation for owner-private review."],
    limitations: ["Generated material remains pending review."],
  }];
  record.d1Exclusions = [];
  await writeJson(recordPath, record);

  await assert.rejects(
    prepareBehavioralEvidenceSyncPlan({ bundleRoot: fixture.root }),
    /cannot be prepared above E1 for D1 sync/,
  );
  await assert.rejects(access(path.join(fixture.root, "sync", "plan.json")), { code: "ENOENT" });
});

test("the archaeology coordinator defines explicit coverage and output budgets", async () => {
  const prompt = await readFile(new URL(
    "../practice/behavioral/prompts/project-evidence-archaeology.md",
    import.meta.url,
  ), "utf8");

  assert.match(prompt, /enumerated paths: 5,000/);
  assert.match(prompt, /deep-read files: 60/);
  assert.match(prompt, /detailed critical-module cards: 12/);
  assert.match(prompt, /final handoff: 12,000 words/);
  assert.match(prompt, /sole record definitions/);
  assert.match(prompt, /Every source must declare its exact `refreshMode`/);
  assert.match(prompt, /explicit `d1Exclusions` record/);
});
