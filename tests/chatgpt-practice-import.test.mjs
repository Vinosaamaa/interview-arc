import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { chatgptExportSchema, chatgptImportRequestSchema, chatgptTimingSchema } from "../db/chatgpt-import-policy.ts";
import { applyChatgptImport, prepareChatgptImport, readImportedPractice, listImportedPractice } from "../db/chatgpt-import-store.ts";
import { readChatgptBank } from "../db/chatgpt-bank.ts";
import { savePracticeEditorial, readPracticeEditorial } from "../db/practice-editorial.ts";

const sample = JSON.parse(readFileSync(new URL("../docs/contracts/chatgpt-backfill-synthetic.example.json", import.meta.url), "utf8"));
function fixture() {
  const value = structuredClone(sample);
  for (const a of value.sessions[0].attempts) { a.practiceDate = "2026-09-08"; a.dateBasis = "user_reported"; }
  return value;
}
const catalog = sample.sessions[0].attempts.map((a) => ({ specialty: a.question.specialty, questionId: a.question.questionId, title: a.question.title, active: true }));
const request = (packet, extra = {}) => chatgptImportRequestSchema.parse({ action: "preview", packet, ...extra });
function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync(new URL("../drizzle/", import.meta.url)).filter((n) => n.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
  function prepare(sql) {
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...args), success: true }; },
      execute() { const stmt = sqlite.prepare(sql); return stmt.columns().length ? stmt.all(...args) : stmt.run(...args); },
    };
  }
  return { sqlite, db: { prepare, async batch(statements) {
    sqlite.exec("BEGIN IMMEDIATE");
    try { const values = statements.map((s) => s.execute()); sqlite.exec("COMMIT"); return values; }
    catch (e) { sqlite.exec("ROLLBACK"); throw e; }
  } } };
}
async function save(db, owner, input) {
  const { preview } = await prepareChatgptImport(db, owner, input, catalog);
  return applyChatgptImport(db, owner, { ...input, action: "apply", previewToken: preview.previewToken, confirmCorrections: true }, catalog);
}

test("later editorial revisions preserve imported evidence, validate owner/problem, and replay atomically", async () => {
  const { db, sqlite } = database();
  try {
    const packet = fixture();
    const coding = packet.sessions[0].attempts.find((a) => a.question.specialty === "leetcode");
    coding.question.url = "https://leetcode.com/problems/two-sum/";
    const receipt = await save(db, "alice", request(packet));
    const record = receipt.records.find((r) => r.attempt.question.specialty === "leetcode");
    const original = sqlite.prepare("SELECT * FROM chatgpt_import_records").all();
    const originalRevisions = sqlite.prepare("SELECT * FROM chatgpt_import_revisions").all();
    const input = { operationId: "editorial-one", activityId: record.activityId, questionId: record.questionId,
      expectedRevision: 0, source: "owner_supplied", editorialUrl: "https://leetcode.com/problems/two-sum/editorial/",
      accessedAt: "2026-09-10T00:00:00Z", contentSha256: "a".repeat(64), approachTitles: ["Hash table"],
      explanation: "Synthetic original explanation of the observed hash-table approach." };
    const saved = await savePracticeEditorial(db, "alice", input, 1);
    assert.equal(saved.editorial.revision, 1);
    assert.equal((await savePracticeEditorial(db, "alice", input, 2)).duplicate, true);
    assert.equal(await readPracticeEditorial(db, "bob", record.activityId), null);
    await assert.rejects(savePracticeEditorial(db, "bob", input), /belonging to this owner/);
    await assert.rejects(savePracticeEditorial(db, "alice", { ...input, explanation: "Different explanation with the same operation." }), /different content/);
    await assert.rejects(savePracticeEditorial(db, "alice", { ...input, operationId: "wrong-question", questionId: "wrong" }), /belonging to this owner/);
    await assert.rejects(savePracticeEditorial(db, "alice", { ...input, operationId: "wrong-url", editorialUrl: "https://leetcode.com/problems/three-sum/editorial/" }), /must match/);
    await assert.rejects(savePracticeEditorial(db, "alice", { ...input, operationId: "stale" }), /not confirmed/);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM practice_editorial_additions").get().n, 1);
    const changed = { ...input, operationId: "editorial-two", expectedRevision: 1, explanation: "Corrected synthetic explanation with the same evidence source." };
    const lossyTransport = { ...db, async batch(statements) { await db.batch(statements); throw new Error("lost response"); } };
    assert.equal((await savePracticeEditorial(lossyTransport, "alice", changed)).editorial.revision, 2);
    assert.equal((await readPracticeEditorial(db, "alice", record.activityId, 1)).explanation, input.explanation);
    assert.equal((await readImportedPractice(db, "alice", record.activityId)).editorial.explanation, changed.explanation);
    assert.deepEqual(sqlite.prepare("SELECT * FROM chatgpt_import_records").all(), original);
    assert.deepEqual(sqlite.prepare("SELECT * FROM chatgpt_import_revisions").all(), originalRevisions);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM timers").get().n, 0);
  } finally { sqlite.close(); }
});

test("transport validates supplied example and rejects broken evidence, state and dates", () => {
  assert.equal(chatgptExportSchema.safeParse(sample).success, true);
  for (const mutate of [
    (p) => p.ownerId = "attacker",
    (p) => p.schemaVersion = 2,
    (p) => p.sessions[0].attempts[0].turnKeys.push("missing-turn"),
    (p) => p.sessions[0].attempts[0].snapshotId = "missing-snapshot",
    (p) => p.sources[0].turns[1].sequence = 1,
    (p) => p.sources[0].turns[1].turnKey = p.sources[0].turns[0].turnKey,
    (p) => p.sessions[0].attempts[1].outcomeEvidenceTurnKeys = ["missing-evidence"],
    (p) => p.sessions[0].attempts[1].userAttempted = false,
    (p) => p.sessions[0].attempts[1].kind = "walkthrough",
    (p) => p.sessions[0].attempts[0].timing.activeMinutes = -1,
    (p) => p.sessions[0].attempts[0].timing.events.unshift({ command: "resume", at: null, timestampBasis: null, evidence: null }),
    (p) => p.sessions[0].attempts[0].question.url = "javascript:alert(1)",
    (p) => p.sessions[0].attempts[0].dateBasis = "source_timestamp",
  ]) { const value = fixture(); mutate(value); assert.equal(chatgptExportSchema.safeParse(value).success, false); }
});

test("observed timing excludes pauses across midnight and DST and checks arithmetic", () => {
  const times = ["2026-11-01T01:50:00-07:00", "2026-11-01T01:55:00-07:00", "2026-11-01T01:05:00-08:00", "2026-11-01T01:10:00-08:00"];
  const timing = { state: "finished", activeMinutes: 10, basis: "observed_boundaries", evidence: "User supplied clock boundaries", events: ["start", "pause", "resume", "finish"].map((command, i) => ({ command, at: times[i], timestampBasis: "user_reported", evidence: "Clock reading" })) };
  assert.equal(chatgptTimingSchema.safeParse(timing).success, true);
  assert.equal(chatgptTimingSchema.safeParse({ ...timing, activeMinutes: 20 }).success, false);
  assert.equal(chatgptTimingSchema.safeParse({ ...timing, events: timing.events.slice().reverse() }).success, false);
});

test("real SQLite save preserves text and unknown time, isolates owners and deduplicates changed packet IDs", async () => {
  const { db, sqlite } = database();
  try {
    sqlite.exec(`INSERT INTO practice_workbenches(owner_id,id,opened_pacific_date,status,opened_at,updated_at) VALUES('alice','active','2026-09-09','open',1,1);`);
    const before = sqlite.prepare("SELECT * FROM practice_workbenches").all();
    const value = fixture(); const input = request(value);
    const preview = await prepareChatgptImport(db, "alice", input, catalog);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM chatgpt_import_records").get().n, 0);
    assert.equal(preview.preview.records.filter((r) => r.status === "completed").length, 2);
    const receipt = await save(db, "alice", input);
    assert.deepEqual(sqlite.prepare("SELECT * FROM practice_workbenches").all(), before);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM timers").get().n, 0);
    const record = await readImportedPractice(db, "alice", receipt.records[1].activityId);
    assert.equal(record.attempt.timing.activeMinutes, null);
    assert.equal(record.session.timing.activeMinutes, 30);
    assert.equal(record.sources[0].turns.find((t) => t.text.includes("def "))?.text, value.sources[0].turns.find((t) => t.text.includes("def "))?.text);
    assert.equal(await readImportedPractice(db, "bob", record.activityId), null);
    assert.deepEqual((await listImportedPractice(db, "bob")).records, []);
    assert.equal((await save(db, "alice", input)).duplicate, true);
    value.packetId = "new-packet-same-attempts";
    await save(db, "alice", request(value));
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM chatgpt_import_revisions").get().n, 2);
    const changed = fixture(); changed.gaps.push("Different packet content");
    await assert.rejects(save(db, "alice", request(changed)), /packet ID/);
  } finally { sqlite.close(); }
});

test("pending imports resolve into revisioned history and conflicting source edits never overwrite evidence", async () => {
  const { db, sqlite } = database();
  try {
    const value = structuredClone(sample);
    const receipt = await save(db, "alice", request(value));
    assert.equal(receipt.records.every((r) => r.status === "pending"), true);
    assert.equal((await listImportedPractice(db, "alice")).records.length, 0);
    const resolutions = value.sessions[0].attempts.map((a) => ({ attemptKey: a.attemptKey, practiceDate: "2026-09-08" }));
    value.packetId = "owner-resolved-date";
    const input = request(value, { resolutions });
    const { preview } = await prepareChatgptImport(db, "alice", input, catalog);
    assert.equal(preview.corrections, true);
    await assert.rejects(applyChatgptImport(db, "alice", { ...input, previewToken: preview.previewToken }, catalog), /Confirm/);
    const saved = await save(db, "alice", input);
    assert.equal(saved.records[0].revision, 2);
    assert.equal(saved.records[0].status, "completed");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM chatgpt_import_revisions").get().n, 4);
    value.packetId = "changed-source"; value.sources[0].turns[0].text = "Rewritten source";
    await assert.rejects(save(db, "alice", request(value, { resolutions })), /Source turn/);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM chatgpt_import_packets").get().n, 2);
  } finally { sqlite.close(); }
});

test("second real question attempt stays pending and atomic planning race rolls the whole packet back", async () => {
  const { db, sqlite } = database();
  try {
    const value = fixture();
    await save(db, "alice", request(value));
    const repeated = fixture(); repeated.packetId = "real-repeat";
    repeated.sessions[0].sessionKey += "-again";
    repeated.sessions[0].attempts.forEach((a) => a.attemptKey += "-again");
    const second = await save(db, "alice", request(repeated));
    assert.equal(second.records.every((r) => r.status === "pending" && r.reasons.some((s) => s.includes("already"))), true);
    assert.throws(() => sqlite.prepare("INSERT INTO extra_activities(owner_id,id,date,payload,revision,updated_at) VALUES(?,?,?,?,1,1)").run("alice", "race", "2026-09-08", JSON.stringify({ type: "leetcode", questionId: catalog[1].questionId })), /question_already_imported/);
    const isolated = request(fixture());
    const { preview } = await prepareChatgptImport(db, "bob", isolated, catalog);
    sqlite.prepare("INSERT INTO extra_activities(owner_id,id,date,payload,revision,updated_at) VALUES(?,?,?,?,1,1)").run("bob", "planned", "2026-09-08", JSON.stringify({ type: "leetcode", questionId: catalog[1].questionId }));
    await assert.rejects(applyChatgptImport(db, "bob", { ...isolated, previewToken: preview.previewToken }, catalog), /preview changed/);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM chatgpt_import_records WHERE owner_id='bob'").get().n, 0);
  } finally { sqlite.close(); }
});

test("bank export contains current owner questions and completed import progress without owner/source leakage", async () => {
  const { db, sqlite } = database();
  try {
    for (const q of catalog) sqlite.prepare("INSERT INTO content_bank(category,id,ord,payload) VALUES(?,?,0,?)").run(q.specialty === "system_design" ? "systemDesign" : q.specialty, q.questionId, JSON.stringify({ id: q.questionId, title: q.title, active: true, topics: [] }));
    const observed = fixture();
    const finish = observed.sessions[0].attempts[1].timing.events.at(-1);
    finish.at = "2026-09-08T12:00:00-07:00"; finish.timestampBasis = "user_reported"; finish.evidence = "User supplied the finish clock reading";
    await save(db, "alice", request(observed));
    const bank = await readChatgptBank(db, "alice", undefined, Date.parse("2026-09-09T10:00:00Z"));
    assert.equal(bank.questions.length, 2);
    assert.equal(bank.questions.every((q) => q.progress.attemptCount === 1), true);
    assert.equal(bank.questions.find((q) => q.specialty === "leetcode").progress.lastOutcome, "solved");
    assert.equal(bank.questions.find((q) => q.specialty === "system_design").progress.lastCompletedAt, null);
    assert.equal(bank.questions.find((q) => q.specialty === "leetcode").progress.lastCompletedAt, "2026-09-08T19:00:00.000Z");
    assert.equal((await readChatgptBank(db, "bob")).questions.every((q) => q.progress.attemptCount === 0), true);
    assert.doesNotMatch(JSON.stringify(bank), /alice|owner_id|sourceChatKey|synthetic-chat:t/);
  } finally { sqlite.close(); }
});

test("source-only captures stay pending and a resolved attempt survives a later unchanged daily export", async () => {
  const { db, sqlite } = database();
  try {
    const partial = structuredClone(sample);
    const input = request(partial, { resolutions: partial.sessions[0].attempts.map((a) => ({ attemptKey: a.attemptKey, practiceDate: "2026-09-08" })) });
    await save(db, "alice", input);
    partial.packetId = "later-daily-export";
    const again = await save(db, "alice", request(partial));
    assert.equal(again.records.every((r) => r.status === "completed" && r.revision === 1), true);
    const summary = fixture(); summary.packetId = "summary-evidence"; summary.sessions[0].sessionKey = "summary-session";
    summary.sessions[0].attempts = [summary.sessions[0].attempts[0]];
    summary.sources[0].kind = "summary_only"; summary.sources[0].coverage = "summary_only"; summary.sources[0].turns = [];
    summary.sessions[0].attempts[0].attemptKey = "summary-attempt"; summary.sessions[0].attempts[0].turnKeys = [];
    const saved = await save(db, "other", request(summary));
    assert.equal(saved.records[0].status, "pending");
  } finally { sqlite.close(); }
});

test("current session time is read separately from immutable capture and turn identity cannot move chats", async () => {
  const { db, sqlite } = database();
  try {
    const first = fixture(); first.packetId = "first-question"; first.sessions[0].attempts = [first.sessions[0].attempts[0]];
    first.sessions[0].timing = { state: "paused", activeMinutes: 10, basis: "user_estimate", evidence: "User estimated ten active minutes", events: [] };
    const receipt = await save(db, "alice", request(first));
    const second = fixture(); second.packetId = "second-question"; second.sessions[0].attempts = [second.sessions[0].attempts[1]];
    await save(db, "alice", request(second));
    const readback = await readImportedPractice(db, "alice", receipt.records[0].activityId);
    assert.equal(readback.session.timing.activeMinutes, 10);
    assert.equal(readback.currentSession.timing.activeMinutes, 30);
    assert.equal(readback.currentSession.timing.state, "finished");
    const moved = fixture(); moved.packetId = "moved-turn"; moved.sources[0].sourceChatKey = "new-source";
    moved.sessions[0].attempts.forEach((a) => a.sourceChatKeys = ["new-source"]);
    moved.sources[0].turns[0].text = "Changed under moved identity";
    await assert.rejects(save(db, "alice", request(moved)), /another source chat/);
  } finally { sqlite.close(); }
});

test("transaction failure rolls back earlier source and record statements, and failed readback reconciles on retry", async () => {
  const { db, sqlite } = database();
  try {
    const input = request(fixture());
    const { preview } = await prepareChatgptImport(db, "alice", input, catalog);
    const raceDb = { ...db, async batch(statements) {
      sqlite.prepare("INSERT INTO extra_activities(owner_id,id,date,payload,revision,updated_at) VALUES(?,?,?,?,1,1)").run("alice", "racing-plan", "2026-09-08", JSON.stringify({ type: "leetcode", questionId: catalog[1].questionId }));
      return db.batch(statements);
    } };
    await assert.rejects(applyChatgptImport(raceDb, "alice", { ...input, previewToken: preview.previewToken }, catalog), /not confirmed/);
    for (const table of ["chatgpt_import_sources", "chatgpt_import_sessions", "chatgpt_import_records", "chatgpt_import_revisions", "chatgpt_import_packets"]) assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
    const receipt = await save(db, "bob", input);
    const revision = sqlite.prepare("SELECT * FROM chatgpt_import_revisions WHERE owner_id='bob' LIMIT 1").get();
    sqlite.prepare("UPDATE chatgpt_import_revisions SET fingerprint='corrupt' WHERE owner_id=? AND attempt_key=?").run("bob", revision.attempt_key);
    await assert.rejects(save(db, "bob", input), /readback is incomplete/);
    sqlite.prepare("UPDATE chatgpt_import_revisions SET fingerprint=? WHERE owner_id=? AND attempt_key=?").run(revision.fingerprint, "bob", revision.attempt_key);
    assert.deepEqual((await save(db, "bob", input)).records, receipt.records);
  } finally { sqlite.close(); }
});

test("expanded evidence is rejected during preview before any D1 row can exceed its limit", async () => {
  const { db, sqlite } = database();
  try {
    const value = fixture();
    value.sources[0].turns.forEach((t) => t.text = "x".repeat(95000));
    assert.ok(Buffer.byteLength(JSON.stringify(value)) < 1000000);
    await assert.rejects(prepareChatgptImport(db, "alice", request(value), catalog), (e) => e.status === 413);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM chatgpt_import_packets").get().n, 0);
  } finally { sqlite.close(); }
});

test("separately supplied source chunks cannot reverse previously recorded timestamps", async () => {
  const { db, sqlite } = database();
  try {
    const first = fixture();
    first.sources[0].turns.at(-1).occurredAt = "2026-09-08T12:00:00Z";
    first.sources[0].turns.at(-1).timestampBasis = "platform_export";
    await save(db, "alice", request(first));
    const next = fixture(); next.packetId = "later-source-chunk"; next.sessions[0].sessionKey = "later-session";
    next.sources[0].turns = [{ turnKey: "new-turn", sequence: 11, speaker: "user", text: "New supplied turn", occurredAt: "2026-09-08T11:00:00Z", timestampBasis: "platform_export" }];
    next.sessions[0].attempts = [{ ...next.sessions[0].attempts[0], attemptKey: "later-attempt", turnKeys: ["new-turn"] }];
    await assert.rejects(prepareChatgptImport(db, "alice", request(next), catalog), /previously saved conversation order/);
  } finally { sqlite.close(); }
});

test("many independent sessions are bounded before exceeding the worker query budget", () => {
  const value = fixture();
  value.sessions = Array.from({ length: 100 }, (_, i) => ({ ...value.sessions[0], sessionKey: `session-${i}`, attempts: [{ ...value.sessions[0].attempts[0], attemptKey: `attempt-${i}` }] }));
  const result = chatgptExportSchema.safeParse(value);
  assert.equal(result.success, false);
  assert.ok(result.error.issues.some((i) => i.message.includes("fewer sessions")));
});
