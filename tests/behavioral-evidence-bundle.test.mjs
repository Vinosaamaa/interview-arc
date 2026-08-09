import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertRemoteSafe,
  buildBehavioralEvidenceSite,
  validateBehavioralEvidenceBundle,
} from "../scripts/build-behavioral-evidence-site.mjs";

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
      locator: "<authorized-local-project>",
      safeHint: "Authorized local project",
      authorization: "user_authorized",
      sensitivity: "private",
      availability: "available",
      visibility: "local_only",
      revision: "example-revision",
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
    publicationCandidates: [],
  };
}

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "behavioral-evidence-"));
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

test("validates a schema-first bundle and resolves every cross-record link", async () => {
  const fixture = await createFixture();
  const result = await validateBehavioralEvidenceBundle({ bundleRoot: fixture.root });
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].record.project.id, "example-project");
});

test("rejects dangling evidence references", async () => {
  const fixture = await createFixture();
  const recordPath = path.join(fixture.projectRoot, "project.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.claims[0].evidenceIds = ["EX-EV-MISSING"];
  await writeJson(recordPath, record);
  await assert.rejects(
    validateBehavioralEvidenceBundle({ bundleRoot: fixture.root }),
    /unknown reference EX-EV-MISSING/,
  );
});

test("rejects verified personal claims without accepted A3 evidence", async () => {
  const fixture = await createFixture();
  const recordPath = path.join(fixture.projectRoot, "project.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.claims[0].scope = "personal_contribution";
  record.claims[0].status = "verified";
  record.evidence[0].candidateState = "accepted";
  await writeJson(recordPath, record);
  await assert.rejects(
    validateBehavioralEvidenceBundle({ bundleRoot: fixture.root }),
    /verified personal contributions require A3 attribution/,
  );
});

test("rejects private locators and identities in remote-safe candidates", () => {
  const privateLocator = ["", "Users", "example", "private", "repository"].join("/");
  assert.throws(
    () => assertRemoteSafe({ content: { locator: privateLocator, contact: "person@example.test" } }),
    /absolute macOS path/,
  );
});

test("generates byte-identical local HTML from unchanged inputs", async () => {
  const fixture = await createFixture();
  const first = await buildBehavioralEvidenceSite({ bundleRoot: fixture.root });
  const firstHtml = await readFile(first.indexPath, "utf8");
  const second = await buildBehavioralEvidenceSite({ bundleRoot: fixture.root });
  const secondHtml = await readFile(second.indexPath, "utf8");
  assert.equal(secondHtml, firstHtml);
  assert.match(firstHtml, /LOCAL PRIVATE PROJECTION/);
  assert.match(firstHtml, /Not synced to D1\. Not published\./);
});
