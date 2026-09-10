import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { applyChatgptImport, prepareChatgptImport, readImportedPractice } from "../db/chatgpt-import-store.ts";
import { chatgptImportRequestSchema } from "../db/chatgpt-import-policy.ts";
import { readPracticeSolutionPublication, savePracticeSolutionPublication } from "../db/practice-solution-publication.ts";
import { validateSolutionProfile } from "../db/solution-profile-validation.ts";

import { profile, prose, nativePracticeRecord, completeLeetcodeProfile } from "./helpers/solution-publication-fixture.mjs";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync(new URL("../drizzle/", import.meta.url)).filter((n) => n.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
  }
  const prepare = (sql) => {
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...args), success: true }; },
      execute() { const statement = sqlite.prepare(sql); return statement.columns().length ? statement.all(...args) : statement.run(...args); },
    };
  };
  return { sqlite, db: { prepare, async batch(statements) {
    sqlite.exec("BEGIN IMMEDIATE");
    try { const result = statements.map((statement) => statement.execute()); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } } };
}
async function imported(db, specialty = "system_design") {
  const packet = JSON.parse(readFileSync(new URL("../docs/contracts/chatgpt-backfill-synthetic.example.json", import.meta.url), "utf8"));
  const attempt = packet.sessions[0].attempts.find((value) => value.question.specialty === specialty);
  if (specialty === "leetcode") {
    attempt.question.questionId = "chatgpt-synthetic-question-id";
    attempt.question.url = "https://leetcode.com/problems/two-sum/";
  }
  attempt.practiceDate = "2026-09-08"; attempt.dateBasis = "user_reported";
  packet.sessions[0].attempts = [attempt];
  const catalog = [{ specialty, questionId: attempt.question.questionId, title: attempt.question.title, active: true }];
  const input = chatgptImportRequestSchema.parse({ action: "preview", packet });
  const { preview } = await prepareChatgptImport(db, "alice", input, catalog);
  const saved = await applyChatgptImport(db, "alice", { ...input, action: "apply", previewToken: preview.previewToken }, catalog);
  const record = saved.records[0];
  assert.equal(record.status, "completed");
  return { operationId: "publish-first", activityId: record.activityId, specialty, questionId: record.questionId,
    expectedPracticeRevision: record.revision, expectedPracticeFingerprint: record.fingerprint, expectedSolutionRevision: 0,
    action: "create_or_revise", solutionProfile: profile() };
}
function native(sqlite, specialty = "system_design") {
  const original = nativePracticeRecord(specialty);
  const payload = JSON.stringify(original), fingerprint = createHash("sha256").update(payload).digest("hex");
  sqlite.prepare("INSERT INTO practice_record_revisions(owner_id,activity_id,revision,operation_id,request_fingerprint,record_fingerprint,payload,created_at) VALUES(?,?,?,?,?,?,?,?)")
    .run("alice", original.activityId, 1, "native-finalize", "request-hash", fingerprint, payload, 1);
  sqlite.prepare("INSERT INTO practice_records(owner_id,activity_id,current_revision,specialty,question_id,title,completed_at,practice_date,outcome,solution_revision,record_fingerprint,finalization_operation_id,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("alice", original.activityId, 1, specialty, original.questionId, original.prompt.title, Date.parse(original.completedAt), original.practiceDate, original.outcome, null, fingerprint, "native-finalize", 1);
  sqlite.prepare("INSERT INTO activity_finalizations(owner_id,activity_id,specialty,status,payload,finalization_operation_id,finalization_request_fingerprint,practice_record_revision,practice_record_fingerprint) VALUES(?,?,?,?,?,?,?,?,?)")
    .run("alice", original.activityId, specialty, "ready", "{}", "native-finalize", "request-hash", 1, fingerprint);
  return { operationId: "publish-native", activityId: original.activityId, specialty, questionId: original.questionId,
    expectedPracticeRevision: 1, expectedPracticeFingerprint: fingerprint, expectedSolutionRevision: 0,
    action: "create_or_revise", solutionProfile: profile() };
}
function originalRows(sqlite) {
  return ["chatgpt_import_records", "chatgpt_import_revisions", "practice_records", "practice_record_revisions", "activity_finalizations", "activity_solution_links", "behavioral_final_answer_snapshots", "timers"]
    .map((table) => sqlite.prepare(`SELECT * FROM ${table}`).all());
}

test("imported solution publication creates an exact late link and leaves every original practice row unchanged", async () => {
  const { db, sqlite } = database();
  try {
    const input = await imported(db), originals = originalRows(sqlite);
    assert.equal((await readImportedPractice(db, "alice", input.activityId)).solutionPublication, null);
    const saved = await savePracticeSolutionPublication(db, "alice", input, 1);
    assert.equal(saved.publication.action, "created");
    assert.equal(saved.publication.solutionRevision, 1);
    assert.equal(saved.publication.practiceFingerprint, input.expectedPracticeFingerprint);
    assert.deepEqual((await readPracticeSolutionPublication(db, "alice", input.activityId)), saved.publication);
    assert.deepEqual((await readImportedPractice(db, "alice", input.activityId)).solutionPublication, saved.publication);
    assert.deepEqual((await readImportedPractice(db, "alice", input.activityId, input.expectedPracticeRevision)).solutionPublication, saved.publication);
    assert.equal(await readImportedPractice(db, "bob", input.activityId), null);
    assert.equal(await readPracticeSolutionPublication(db, "bob", input.activityId), null);
    assert.deepEqual(originalRows(sqlite), originals);
    assert.deepEqual(JSON.parse(sqlite.prepare("SELECT tags FROM problem_solution_profiles").get().tags), ["event-streaming"]);
    assert.equal((await savePracticeSolutionPublication(db, "alice", input, 2)).duplicate, true);
    const reuse = { ...input }; delete reuse.solutionProfile;
    const reused = await savePracticeSolutionPublication(db, "alice", { ...reuse, operationId: "reuse", expectedSolutionRevision: 1, action: "reuse_current" }, 3);
    assert.equal(reused.publication.action, "reused");
    assert.equal(reused.publication.revision, 2);
    const semantic = await savePracticeSolutionPublication(db, "alice", { ...input, operationId: "semantic", expectedSolutionRevision: 1 }, 4);
    assert.equal(semantic.publication.action, "reused");
    assert.equal(sqlite.prepare("SELECT count(*) n FROM problem_solution_revisions").get().n, 1);
    assert.deepEqual(originalRows(sqlite), originals);
  } finally { sqlite.close(); }
});

test("native completion supports later revisions, exact retries after advancement, and lost-response recovery", async () => {
  const { db, sqlite } = database();
  try {
    const input = native(sqlite), originals = originalRows(sqlite);
    const saved = await savePracticeSolutionPublication(db, "alice", input, 1);
    const revised = { ...input, operationId: "revised", expectedSolutionRevision: 1,
      solutionProfile: { ...profile(), summary: prose("improvedsummary", 25) } };
    const lossy = { ...db, async batch(statements) { await db.batch(statements); throw new Error("connection lost after commit"); } };
    const recovered = await savePracticeSolutionPublication(lossy, "alice", revised, 2);
    assert.equal(recovered.duplicate, true);
    assert.equal(recovered.publication.action, "revised");
    assert.equal(recovered.publication.solutionRevision, 2);
    assert.deepEqual((await savePracticeSolutionPublication(db, "alice", input, 3)).publication, saved.publication);
    assert.equal((await readPracticeSolutionPublication(db, "alice", input.activityId)).solutionRevision, 2);
    assert.deepEqual((await readPracticeSolutionPublication(db, "alice", input.activityId, 1)), saved.publication);
    await assert.rejects(savePracticeSolutionPublication(db, "alice", { ...input, solutionProfile: revised.solutionProfile }), /different content/);
    assert.deepEqual(originalRows(sqlite), originals);
  } finally { sqlite.close(); }
});

test("imported readers show only solution publications bound to their exact practice revision and fingerprint", async () => {
  const { db, sqlite } = database();
  try {
    const input = await imported(db);
    const original = await readImportedPractice(db, "alice", input.activityId);
    const first = await savePracticeSolutionPublication(db, "alice", input, 1);
    const correction = chatgptImportRequestSchema.parse({ action: "preview", packet: {
      schemaVersion: 1, kind: "practice_export", packetId: "corrected-practice", exportedAt: null, timeZone: "America/Los_Angeles",
      snapshots: original.snapshot ? [original.snapshot] : [], sources: original.sources, gaps: [],
      sessions: [{ ...original.session, attempts: [{ ...original.attempt, summary: "Corrected synthetic practice summary with original evidence preserved." }] }],
    } });
    const catalog = [{ specialty: input.specialty, questionId: input.questionId, title: original.attempt.question.title, active: true }];
    const { preview } = await prepareChatgptImport(db, "alice", correction, catalog);
    const revised = (await applyChatgptImport(db, "alice", { ...correction, action: "apply", previewToken: preview.previewToken, confirmCorrections: true }, catalog)).records[0];
    assert.equal(revised.revision, 2);
    assert.notEqual(revised.fingerprint, original.fingerprint);
    assert.equal((await readImportedPractice(db, "alice", input.activityId)).solutionPublication, null);
    const second = await savePracticeSolutionPublication(db, "alice", {
      ...input, operationId: "corrected-solution", expectedPracticeRevision: revised.revision,
      expectedPracticeFingerprint: revised.fingerprint, expectedSolutionRevision: 1,
      solutionProfile: { ...profile(), summary: prose("revisedsummary", 25) },
    }, 2);
    assert.deepEqual((await readImportedPractice(db, "alice", input.activityId)).solutionPublication, second.publication);
    assert.deepEqual((await readImportedPractice(db, "alice", input.activityId, 2)).solutionPublication, second.publication);
    assert.deepEqual((await readImportedPractice(db, "alice", input.activityId, 1)).solutionPublication, first.publication);
    assert.deepEqual(await readPracticeSolutionPublication(db, "alice", input.activityId), second.publication);
    assert.equal(await readPracticeSolutionPublication(db, "alice", input.activityId, undefined, {
      practiceRevision: 1, practiceFingerprint: revised.fingerprint,
    }), null);
    const old = await readImportedPractice(db, "alice", input.activityId, 1);
    assert.equal(old.attempt.summary, original.attempt.summary);
    assert.equal(old.fingerprint, original.fingerprint);
  } finally { sqlite.close(); }
});

test("wrong owner, source revision, identity, missing current, and shallow profiles cannot mutate solutions", async () => {
  const { db, sqlite } = database();
  try {
    const input = native(sqlite), originals = originalRows(sqlite);
    await assert.rejects(savePracticeSolutionPublication(db, "bob", input), /belonging to this owner/);
    for (const change of [{ specialty: "leetcode" }, { questionId: "other" }, { activityId: "other" }]) {
      await assert.rejects(savePracticeSolutionPublication(db, "alice", { ...input, ...change }), /belonging to this owner/);
    }
    for (const change of [{ expectedPracticeRevision: 2 }, { expectedPracticeFingerprint: "a".repeat(64) }]) {
      await assert.rejects(savePracticeSolutionPublication(db, "alice", { ...input, ...change }), /Record changed/);
    }
    await assert.rejects(savePracticeSolutionPublication(db, "alice", { ...input, expectedSolutionRevision: 4 }), /Profile changed/);
    await assert.rejects(savePracticeSolutionPublication(db, "alice", { ...input, action: "reuse_current" }), /profile only/);
    const withoutProfile = { ...input }; delete withoutProfile.solutionProfile;
    await assert.rejects(savePracticeSolutionPublication(db, "alice", { ...withoutProfile, action: "reuse_current" }), /no owner-private/);
    await assert.rejects(savePracticeSolutionPublication(db, "alice", { ...input, solutionProfile: { ...profile(), sections: [] } }), /missing:/);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM problem_solution_profiles").get().n, 0);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM practice_solution_publications").get().n, 0);
    assert.deepEqual(originalRows(sqlite), originals);
    sqlite.exec("UPDATE activity_finalizations SET status='draft'");
    await assert.rejects(savePracticeSolutionPublication(db, "alice", input), /completed Practice Record/);
  } finally { sqlite.close(); }
});

test("concurrent publications require an exact current revision and roll back losing writes", async () => {
  const { db, sqlite } = database();
  try {
    const input = native(sqlite);
    const results = await Promise.allSettled([
      savePracticeSolutionPublication(db, "alice", input, 1),
      savePracticeSolutionPublication(db, "alice", { ...input, operationId: "concurrent", solutionProfile: { ...profile(), summary: prose("other", 25) } }, 1),
    ]);
    assert.equal(results.filter((value) => value.status === "fulfilled").length, 1);
    assert.equal(results.filter((value) => value.status === "rejected").length, 1);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM problem_solution_revisions").get().n, 1);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM practice_solution_publications").get().n, 1);
    assert.equal(sqlite.prepare("SELECT current_revision n FROM problem_solution_profiles").get().n, 1);
  } finally { sqlite.close(); }
});

test("a record change between preparation and transaction aborts every publication write", async () => {
  const { db, sqlite } = database();
  try {
    const input = await imported(db);
    const racing = { ...db, async batch(statements) {
      sqlite.exec("UPDATE chatgpt_import_records SET status='pending'");
      return db.batch(statements);
    } };
    await assert.rejects(savePracticeSolutionPublication(racing, "alice", input), /changed during publication/);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM problem_solution_profiles").get().n, 0);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM problem_solution_revisions").get().n, 0);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM practice_solution_publications").get().n, 0);
    await assert.rejects(savePracticeSolutionPublication(db, "alice", input), /completed Practice Record/);
  } finally { sqlite.close(); }
});

test("unexpected storage interruption is retryable and a corrupt referenced revision never reports saved", async () => {
  const { db, sqlite } = database();
  try {
    const input = native(sqlite);
    await assert.rejects(savePracticeSolutionPublication({ ...db, async batch() { throw new Error("service interruption"); } }, "alice", input), (error) => error.retryable === true);
    await savePracticeSolutionPublication(db, "alice", input);
    sqlite.exec("UPDATE problem_solution_revisions SET payload='{}'");
    await assert.rejects(savePracticeSolutionPublication(db, "alice", input), /exact immutable revision/);
    await assert.rejects(readPracticeSolutionPublication(db, "alice", input.activityId), /exact immutable revision/);
  } finally { sqlite.close(); }
});

test("shared specialty gates reject missing behavioral evidence and unbound project metadata", () => {
  assert.throws(() => validateSolutionProfile("behavioral", profile()), /preferred personal answer/);
  assert.throws(() => validateSolutionProfile("system_design", { ...profile(), projectDeepDive: { projectId: "unknown" } }), /only for behavioral/);
  assert.throws(() => validateSolutionProfile("leetcode", { ...profile(), editorialResearch: { source: "leetcode_mcp", status: "available", url: "https://leetcode.com/problems/other/editorial/", accessedAt: "2026-09-10T00:00:00Z", approaches: [] } }, null, "intended"), /canonical URL/);
});

test("personal LeetCode identity binds honest MCP editorial provenance to the original problem URL", async () => {
  const { db, sqlite } = database();
  try {
    const input = await imported(db, "leetcode");
    const coding = completeLeetcodeProfile("two-sum");
    coding.editorialResearch.source = "leetcode_mcp";
    const wrong = structuredClone(coding);
    wrong.editorialResearch.url = "https://leetcode.com/problems/other/editorial/";
    await assert.rejects(savePracticeSolutionPublication(db, "alice", { ...input, solutionProfile: wrong }), /canonical URL/);
    const saved = await savePracticeSolutionPublication(db, "alice", { ...input, solutionProfile: coding });
    assert.equal(saved.publication.solutionRevision, 1);
    assert.equal(JSON.parse(sqlite.prepare("SELECT payload FROM problem_solution_profiles").get().payload).editorialResearch.source, "leetcode_mcp");
  } finally { sqlite.close(); }
});

test("behavioral publication preserves its historical final answer and rejects a concurrently added project binding", async () => {
  const { db, sqlite } = database();
  try {
    const behavioral = {
      schemaVersion: 1, summary: prose("summary", 20), tags: ["ownership"], references: [],
      sections: [["Interview signal", "signal", 35], ["Truthful Situation", "situation", 40], ["Truthful Task", "task", 35],
        ["Truthful Actions and ownership", "action", 65], ["Verified Result and evidence gaps", "result", 40],
        ["Learning", "learning", 35], ["Likely follow-ups and evidence gaps", "followup", 35], ["Reference answer patterns", "pattern", 35]]
        .map(([title, topic, count]) => ({ title, body: prose(topic, count) })),
      behavioralAnswer: { preferred: { label: "Synthetic test answer", answer: prose("answer", 90), evidence: ["Synthetic owner-confirmed test evidence"], evidenceGaps: [] }, alternatives: [] },
      questionsAndAnswers: { status: "not_applicable", reason: "No substantial reusable question and answer exchange occurred in this synthetic activity.", items: [] },
    };
    const input = { ...native(sqlite, "behavioral"), solutionProfile: behavioral };
    sqlite.prepare("INSERT INTO behavioral_final_answer_snapshots(owner_id,activity_id,snapshot_revision,operation_id,request_fingerprint,snapshot,finalized_at) VALUES(?,?,?,?,?,?,?)")
      .run("alice", input.activityId, 1, "historical-answer", "immutable-answer-hash", JSON.stringify({ answer: "Original exact historical answer" }), 1);
    const originals = originalRows(sqlite);
    const saved = await savePracticeSolutionPublication(db, "alice", input, 1);
    assert.equal(saved.publication.action, "created");
    assert.deepEqual(originalRows(sqlite), originals);
    const racing = { ...db, async batch(statements) {
      sqlite.prepare("INSERT INTO behavioral_project_question_bindings(owner_id,question_id,current_revision,project_id,focus,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
        .run("alice", input.questionId, 1, "synthetic-project", "project_overview", "active", 2, 2);
      return db.batch(statements);
    } };
    const revised = { ...input, operationId: "behavioral-revised", expectedSolutionRevision: 1,
      solutionProfile: { ...behavioral, summary: prose("improved", 25) } };
    await assert.rejects(savePracticeSolutionPublication(racing, "alice", revised, 2), /changed during publication/);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM problem_solution_revisions").get().n, 1);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM practice_solution_publications").get().n, 1);
    assert.deepEqual(originalRows(sqlite), originals);
    await assert.rejects(savePracticeSolutionPublication(db, "alice", revised, 3), /Project Deep Dive binding metadata/);
  } finally { sqlite.close(); }
});
