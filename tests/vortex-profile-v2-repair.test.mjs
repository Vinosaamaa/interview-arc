import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import test from "node:test";

import {
  TARGET,
  buildMutationSql,
  renderArtifact,
  resultSetsFromWrangler,
  sha256,
  validateProfile,
} from "../scripts/repairs/vortex-profile-v2.mjs";

const root = process.cwd();
const profile = JSON.parse(await readFile(path.join(root, "scripts/repairs/vortex-profile-v2.json"), "utf8"));

function baseSnapshot() {
  return {
    profile: [{
      owner_id: "owner-fixture",
      specialty: "behavioral",
      question_id: TARGET.questionId,
      title: "Experience Map: VortexNetTech",
      current_revision: 1,
      tags: '["existing"]',
      payload: '{"immutable":"current-revision-1"}',
      updated_at: 100,
    }],
    revisions: [{
      owner_id: "owner-fixture",
      specialty: "behavioral",
      question_id: TARGET.questionId,
      revision: 1,
      activity_id: TARGET.activityId,
      payload: '{"immutable":"revision-1"}',
      created_at: 100,
    }],
    binding: [{ current_revision: 1, project_id: "chanter", focus: "project_overview", state: "active" }],
    finalization: [{ revision: 1, payload: "immutable-finalization" }],
    snapshots: [{ snapshot_revision: 1, snapshot: "immutable-final-answer" }],
    solutionLink: [{ owner_id: "owner-fixture", activity_id: TARGET.activityId, specialty: "behavioral", question_id: TARGET.questionId, solution_revision: 1 }],
    projectLink: [{ owner_id: "owner-fixture", activity_id: TARGET.activityId, question_id: TARGET.questionId, binding_revision: 1, project_id: "chanter", focus: "project_overview", solution_revision: 1 }],
    activity: [{ id: TARGET.activityId, payload: "immutable-activity" }],
    timers: [{ subject_id: TARGET.activityId, accumulated_seconds: 5130 }],
    outcomes: [{ activity_id: TARGET.activityId, outcome: "solved_after_reviewing_approach" }],
    publication: [{ activity_id: TARGET.activityId, status: "published" }],
    activityNotes: [{ activity_id: TARGET.activityId, note: "immutable-note" }],
    practiceNotes: [{ activity_id: TARGET.activityId, body: "immutable-pinned-note" }],
    transcript: Array.from({ length: 98 }, (_, sequence) => ({ activity_id: TARGET.activityId, sequence, body: `turn-${sequence}` })),
  };
}

function databaseFor(snapshot) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE problem_solution_profiles (
      owner_id TEXT NOT NULL, specialty TEXT NOT NULL, question_id TEXT NOT NULL, title TEXT NOT NULL,
      current_revision INTEGER NOT NULL, tags TEXT NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, specialty, question_id)
    );
    CREATE TABLE problem_solution_revisions (
      owner_id TEXT NOT NULL, specialty TEXT NOT NULL, question_id TEXT NOT NULL, revision INTEGER NOT NULL,
      activity_id TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, specialty, question_id, revision)
    );
    CREATE TABLE activity_solution_links (
      owner_id TEXT NOT NULL, activity_id TEXT NOT NULL, specialty TEXT NOT NULL, question_id TEXT NOT NULL,
      solution_revision INTEGER NOT NULL
    );
    CREATE TABLE behavioral_project_activity_links (
      owner_id TEXT NOT NULL, activity_id TEXT NOT NULL, question_id TEXT NOT NULL, binding_revision INTEGER NOT NULL,
      project_id TEXT NOT NULL, focus TEXT NOT NULL, solution_revision INTEGER
    );
  `);
  const current = snapshot.profile[0];
  db.prepare("INSERT INTO problem_solution_profiles VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    current.owner_id, current.specialty, current.question_id, current.title, current.current_revision,
    current.tags, current.payload, current.updated_at,
  );
  const revision = snapshot.revisions[0];
  db.prepare("INSERT INTO problem_solution_revisions VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    revision.owner_id, revision.specialty, revision.question_id, revision.revision,
    revision.activity_id, revision.payload, revision.created_at,
  );
  const solution = snapshot.solutionLink[0];
  db.prepare("INSERT INTO activity_solution_links VALUES (?, ?, ?, ?, ?)").run(
    solution.owner_id, solution.activity_id, solution.specialty, solution.question_id, solution.solution_revision,
  );
  const project = snapshot.projectLink[0];
  db.prepare("INSERT INTO behavioral_project_activity_links VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    project.owner_id, project.activity_id, project.question_id, project.binding_revision,
    project.project_id, project.focus, project.solution_revision,
  );
  return db;
}

test("revision-2 profile, artifact, and guarded CAS repair preserve revision-1 history", async () => {
  validateProfile(profile);
  const sectionKeys = profile.sections.map((section) => section.sectionKey);
  assert.deepEqual(sectionKeys, [
    "orientation", "architecture", "end_to_end_flows", "ownership_and_evidence",
    "decisions_and_tradeoffs", "operations_reliability_security", "results_and_gaps",
    "interview_walkthrough", "likely_follow_ups",
  ]);
  assert.ok(profile.practiceScenarios.every((scenario) => scenario.mode === "fictional"));
  const artifact = await readFile(path.join(root, TARGET.artifactPath), "utf8");
  assert.equal(artifact, renderArtifact(profile));
  assert.match(artifact, /Fictional practice scenario — not the owner's experience/);
  assert.match(artifact, /Personal ownership, deployment, scale, and results remain evidence gaps/);

  const snapshot = baseSnapshot();
  const protectedBefore = sha256({
    finalization: snapshot.finalization,
    snapshots: snapshot.snapshots,
    solutionLink: snapshot.solutionLink,
    projectLink: snapshot.projectLink,
    activity: snapshot.activity,
    transcript: snapshot.transcript,
    timers: snapshot.timers,
    outcomes: snapshot.outcomes,
    activityNotes: snapshot.activityNotes,
    practiceNotes: snapshot.practiceNotes,
  });
  const revision1Before = snapshot.revisions[0].payload;
  const db = databaseFor(snapshot);
  db.exec(`BEGIN;\n${buildMutationSql(snapshot, profile, 200)}\nCOMMIT;`);

  const current = db.prepare("SELECT * FROM problem_solution_profiles").get();
  const revisions = db.prepare("SELECT * FROM problem_solution_revisions ORDER BY revision").all();
  const solutionLink = db.prepare("SELECT * FROM activity_solution_links").get();
  const projectLink = db.prepare("SELECT * FROM behavioral_project_activity_links").get();
  assert.equal(current.current_revision, 2);
  assert.equal(current.payload, JSON.stringify(profile));
  assert.equal(revisions.length, 2);
  assert.equal(revisions[0].payload, revision1Before);
  assert.equal(revisions[1].payload, JSON.stringify(profile));
  assert.equal(solutionLink.solution_revision, 1);
  assert.equal(projectLink.solution_revision, 1);
  assert.equal(sha256({
    finalization: snapshot.finalization,
    snapshots: snapshot.snapshots,
    solutionLink: snapshot.solutionLink,
    projectLink: snapshot.projectLink,
    activity: snapshot.activity,
    transcript: snapshot.transcript,
    timers: snapshot.timers,
    outcomes: snapshot.outcomes,
    activityNotes: snapshot.activityNotes,
    practiceNotes: snapshot.practiceNotes,
  }), protectedBefore);

  const replay = { ...snapshot, profile: [current], revisions };
  assert.throws(() => buildMutationSql(replay, profile, 300), /current revision must be exactly 1/);
  db.close();
});

test("remote file-import progress is not parsed as a JSON query result", () => {
  assert.deepEqual(resultSetsFromWrangler("├ Checking if file needs uploading\n", { file: true }), []);
  assert.throws(
    () => resultSetsFromWrangler("├ Checking if file needs uploading\n"),
    /Unexpected token/,
  );
});
