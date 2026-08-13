#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const TARGET = Object.freeze({
  activityId: "2026-08-05-extra-voice-2026-08-05-plan-hard20-unsolved-frequency-3",
  questionId: "basic-calculator",
  specialty: "leetcode",
  title: "Basic Calculator",
  previousRevision: 1,
  revision: 2,
  artifactPath: "practice/leetcode/solutions/0224-basic-calculator-profile-revision-02.md",
});

const requiredSections = [
  "Pattern recognition and constraints",
  "Best approach",
  "Reference implementations",
  "Correctness reasoning",
  "Time and space complexity",
  "Edge cases",
  "Meaningful alternatives",
  "Common mistakes and recall cues",
  "Interview walkthrough",
  "References",
];
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "../..");
const profilePath = path.join(scriptDirectory, "basic-calculator-profile-v2.json");

function fail(message) {
  throw new Error(message);
}

export function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function storedJson(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function resultSetsFromWrangler(output) {
  const parsed = JSON.parse(output);
  const batches = Array.isArray(parsed) ? parsed : [parsed];
  return batches.map((batch) => batch?.results ?? batch?.result?.[0]?.results ?? []);
}

function executeWrangler(sql, { remote }) {
  const wrangler = path.join(root, "node_modules", ".bin", "wrangler");
  const args = [
    "d1", "execute", "DB", remote ? "--remote" : "--local",
    "--command", sql,
    "--json",
  ];
  return resultSetsFromWrangler(execFileSync(wrangler, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }));
}

export function validateProfile(profile) {
  if (profile?.schemaVersion !== 1 || !profile.summary?.trim()) fail("Revision 2 needs a non-empty V1 Solution Profile.");
  if (JSON.stringify(profile.sections?.map((section) => section.title)) !== JSON.stringify(requiredSections)) {
    fail("Revision 2 has incorrect LeetCode section titles or ordering.");
  }
  if (profile.sections.some((section) => !section.body?.trim())) fail("Every revision-2 section needs a body.");
  const implementation = profile.sections.find((section) => section.title === "Reference implementations")?.body ?? "";
  if (!implementation.includes("```java") || !implementation.includes("```python")) {
    fail("Revision 2 needs complete Java and Python preferred implementations.");
  }
  const alternatives = profile.sections.find((section) => section.title === "Meaningful alternatives")?.body ?? "";
  if ((alternatives.match(/^### Alternative:/gm) ?? []).length !== 2
    || (alternatives.match(/^#### Reference implementation$/gm) ?? []).length !== 2
    || (alternatives.match(/```java/g) ?? []).length !== 2) {
    fail("Revision 2 needs two structured alternatives with Java implementations.");
  }
  if (!profile.references?.some((reference) => reference.url === "https://leetcode.com/problems/basic-calculator/")) {
    fail("Revision 2 needs the consulted official problem reference.");
  }
}

export function renderArtifact(profile) {
  const lines = [
    "---",
    "type: leetcode",
    "title: Basic Calculator — Solution Profile revision 2",
    "date: 2026-08-12",
    "status: published",
    "solution_profile_revision: 2",
    "previous_solution_profile_revision: 1",
    "question_id: basic-calculator",
    "problem_number: 224",
    "---",
    "",
    "# Basic Calculator — Solution Profile revision 2",
    "",
    "> Corrected canonical solution reference. It is not a new practice attempt. The historical activity, transcript, timer, result, finalization, and activity-to-solution link remain pinned to Solution Profile revision 1.",
    "",
    "## Summary",
    "",
    profile.summary,
  ];
  for (const section of profile.sections) lines.push("", `## ${section.title}`, "", section.body);
  lines.push(
    "",
    "## Revision boundary",
    "",
    "- Current reusable Solution Profile: revision 2",
    "- Historical completed activity Solution Profile: revision 1",
    "- User Code Attempt created by this correction: no",
    "- Historical Code Attempt available: no; the authoritative record contains no submitted owner code",
    "- Transcript, timer, result, finalization, recordings, delivery analysis, and publication receipt changed: no",
    "",
  );
  return lines.join("\n");
}

function snapshotQueries() {
  const ownerLookup = `SELECT owner_id FROM problem_solution_profiles WHERE specialty = ${sqlText(TARGET.specialty)} AND question_id = ${sqlText(TARGET.questionId)} ORDER BY owner_id`;
  const owner = `owner_id = (${ownerLookup} LIMIT 1)`;
  return [
    ["owners", `${ownerLookup};`],
    ["profile", `SELECT * FROM problem_solution_profiles WHERE ${owner} AND specialty = ${sqlText(TARGET.specialty)} AND question_id = ${sqlText(TARGET.questionId)};`],
    ["revisions", `SELECT * FROM problem_solution_revisions WHERE ${owner} AND specialty = ${sqlText(TARGET.specialty)} AND question_id = ${sqlText(TARGET.questionId)} ORDER BY revision;`],
    ["finalization", `SELECT * FROM activity_finalizations WHERE ${owner} AND activity_id = ${sqlText(TARGET.activityId)};`],
    ["solutionLink", `SELECT * FROM activity_solution_links WHERE ${owner} AND activity_id = ${sqlText(TARGET.activityId)};`],
    ["codeAttempts", `SELECT * FROM leetcode_code_attempts WHERE ${owner} AND activity_id = ${sqlText(TARGET.activityId)} ORDER BY sequence, id;`],
    ["activity", `SELECT * FROM extra_activities WHERE ${owner} AND id = ${sqlText(TARGET.activityId)};`],
    ["timers", `SELECT * FROM timers WHERE ${owner} AND subject_id = ${sqlText(TARGET.activityId)} ORDER BY kind;`],
    ["outcomes", `SELECT * FROM outcomes WHERE ${owner} AND activity_id = ${sqlText(TARGET.activityId)};`],
    ["publication", `SELECT * FROM publication_statuses WHERE ${owner} AND activity_id = ${sqlText(TARGET.activityId)};`],
    ["activityNotes", `SELECT * FROM activity_notes WHERE ${owner} AND activity_id = ${sqlText(TARGET.activityId)};`],
    ["practiceNotes", `SELECT * FROM practice_notes WHERE ${owner} AND activity_id = ${sqlText(TARGET.activityId)} ORDER BY id;`],
    ["transcript", `SELECT * FROM practice_transcript_turns WHERE ${owner} AND activity_id = ${sqlText(TARGET.activityId)} ORDER BY sequence, turn_id;`],
    ["audio", `SELECT * FROM activity_audio_clips WHERE ${owner} AND activity_id = ${sqlText(TARGET.activityId)} ORDER BY id;`],
    ["delivery", `SELECT * FROM activity_delivery_analyses WHERE ${owner} AND activity_id = ${sqlText(TARGET.activityId)} ORDER BY id;`],
  ];
}

function readSnapshot(remote) {
  const queries = snapshotQueries();
  const sets = executeWrangler(queries.map(([, sql]) => sql).join("\n"), { remote });
  const snapshot = Object.fromEntries(queries.map(([label], index) => [label, sets[index] ?? []]));
  if (snapshot.owners.length !== 1) fail("The target current Solution Profile does not resolve to exactly one owner.");
  delete snapshot.owners;
  return snapshot;
}

function protectedFingerprint(snapshot) {
  const protectedRows = Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== "profile" && key !== "revisions"));
  return sha256(protectedRows);
}

function assertHistoricalState(snapshot, profilePayload, { allowApplied = false } = {}) {
  if (snapshot.profile.length !== 1) fail("The target current Solution Profile is not unique.");
  const current = snapshot.profile[0];
  const revision1 = snapshot.revisions.find((row) => row.revision === TARGET.previousRevision);
  const revision2 = snapshot.revisions.find((row) => row.revision === TARGET.revision);
  if (!revision1 || revision1.activity_id !== TARGET.activityId) fail("Immutable Solution Profile revision 1 is missing or has the wrong source activity.");
  if (current.current_revision === TARGET.previousRevision && storedJson(current.payload) !== storedJson(revision1.payload)) {
    fail("The current revision-1 pointer payload does not match immutable revision 1.");
  }
  if (!allowApplied && (current.current_revision !== TARGET.previousRevision || revision2)) {
    fail("Write precondition failed: current revision must be exactly 1 and immutable revision 2 must be absent.");
  }
  if (allowApplied && (current.current_revision !== TARGET.revision
    || storedJson(current.payload) !== profilePayload
    || !revision2
    || revision2.activity_id !== TARGET.activityId
    || storedJson(revision2.payload) !== profilePayload)) {
    fail("The already-applied revision-2 state does not match the exact repair payload.");
  }
  if (snapshot.finalization.length !== 1 || snapshot.finalization[0].revision !== 1) fail("Historical finalization revision 1 is missing.");
  if (snapshot.solutionLink.length !== 1 || snapshot.solutionLink[0].solution_revision !== 1) {
    fail("The completed activity Solution Profile link is not pinned to revision 1.");
  }
  if (snapshot.codeAttempts.length !== 0) fail("This correction expects the authoritative historical Code Attempt set to remain empty.");
  if (snapshot.activity.length !== 1 || snapshot.transcript.length === 0) fail("The source activity or its authoritative transcript is missing.");
  return { current, revision1, revision2 };
}

function guard(condition, params = []) {
  return {
    sql: `SELECT json_extract(CASE WHEN (${condition}) THEN '{"allowed":1}' ELSE 'invalid' END, '$.allowed') AS allowed`,
    params,
  };
}

export function buildMutationBatch(snapshot, profile, createdAt) {
  const payload = JSON.stringify(profile);
  const tags = JSON.stringify(profile.tags);
  const { current, revision1 } = assertHistoricalState(snapshot, payload);
  return [
    guard("EXISTS (SELECT 1 FROM problem_solution_profiles WHERE owner_id = ? AND specialty = ? AND question_id = ? AND current_revision = 1 AND updated_at = ? AND payload = ?)", [current.owner_id, TARGET.specialty, TARGET.questionId, Number(current.updated_at), storedJson(current.payload)]),
    guard("EXISTS (SELECT 1 FROM problem_solution_revisions WHERE owner_id = ? AND specialty = ? AND question_id = ? AND revision = 1 AND activity_id = ? AND payload = ? AND created_at = ?)", [current.owner_id, TARGET.specialty, TARGET.questionId, revision1.activity_id, storedJson(revision1.payload), Number(revision1.created_at)]),
    guard("NOT EXISTS (SELECT 1 FROM problem_solution_revisions WHERE owner_id = ? AND specialty = ? AND question_id = ? AND revision = 2)", [current.owner_id, TARGET.specialty, TARGET.questionId]),
    guard("EXISTS (SELECT 1 FROM activity_solution_links WHERE owner_id = ? AND activity_id = ? AND specialty = ? AND question_id = ? AND solution_revision = 1)", [current.owner_id, TARGET.activityId, TARGET.specialty, TARGET.questionId]),
    guard("NOT EXISTS (SELECT 1 FROM leetcode_code_attempts WHERE owner_id = ? AND activity_id = ?)", [current.owner_id, TARGET.activityId]),
    {
      sql: "INSERT INTO problem_solution_revisions (owner_id, specialty, question_id, revision, activity_id, payload, created_at) VALUES (?, ?, ?, 2, ?, ?, ?)",
      params: [current.owner_id, TARGET.specialty, TARGET.questionId, TARGET.activityId, payload, Number(createdAt)],
    },
    {
      sql: "UPDATE problem_solution_profiles SET current_revision = 2, tags = ?, payload = ?, updated_at = ? WHERE owner_id = ? AND specialty = ? AND question_id = ? AND current_revision = 1 AND updated_at = ? AND payload = ?",
      params: [tags, payload, Number(createdAt), current.owner_id, TARGET.specialty, TARGET.questionId, Number(current.updated_at), storedJson(current.payload)],
    },
    guard("changes() = 1"),
    guard("EXISTS (SELECT 1 FROM problem_solution_profiles WHERE owner_id = ? AND specialty = ? AND question_id = ? AND current_revision = 2 AND tags = ? AND payload = ? AND updated_at = ?)", [current.owner_id, TARGET.specialty, TARGET.questionId, tags, payload, Number(createdAt)]),
    guard("EXISTS (SELECT 1 FROM problem_solution_revisions WHERE owner_id = ? AND specialty = ? AND question_id = ? AND revision = 2 AND activity_id = ? AND payload = ? AND created_at = ?)", [current.owner_id, TARGET.specialty, TARGET.questionId, TARGET.activityId, payload, Number(createdAt)]),
    guard("EXISTS (SELECT 1 FROM problem_solution_revisions WHERE owner_id = ? AND specialty = ? AND question_id = ? AND revision = 1 AND activity_id = ? AND payload = ? AND created_at = ?)", [current.owner_id, TARGET.specialty, TARGET.questionId, revision1.activity_id, storedJson(revision1.payload), Number(revision1.created_at)]),
    guard("EXISTS (SELECT 1 FROM activity_solution_links WHERE owner_id = ? AND activity_id = ? AND solution_revision = 1)", [current.owner_id, TARGET.activityId]),
  ];
}

export function databaseIdFromConfig(source) {
  const match = source.match(/"binding"\s*:\s*"DB"[\s\S]{0,500}?"database_id"\s*:\s*"([^"]+)"/);
  if (!match?.[1]) fail("wrangler.jsonc does not define the DB database_id.");
  return match[1];
}

function apiFailure(envelope, fallback) {
  const messages = envelope?.errors?.map((error) => error?.message).filter(Boolean);
  return messages?.length ? messages.join("; ") : fallback;
}

export async function executeRemoteBatch(batch, {
  accountId = process.env.CLOUDFLARE_ACCOUNT_ID,
  apiToken = process.env.CLOUDFLARE_API_TOKEN,
  databaseId,
  fetchImpl = fetch,
} = {}) {
  if (!accountId || !apiToken || !databaseId) fail("Cloudflare account, token, and D1 database ID are required.");
  if (!Array.isArray(batch) || batch.length === 0) fail("The D1 mutation batch must not be empty.");
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ batch }),
  });
  const envelope = await response.json();
  if (!response.ok || envelope?.success !== true) {
    fail(`Cloudflare D1 batch request failed: ${apiFailure(envelope, `HTTP ${response.status}`)}`);
  }
  if (!Array.isArray(envelope.result) || envelope.result.length !== batch.length) {
    fail(`Cloudflare D1 batch returned ${envelope?.result?.length ?? "no"} results for ${batch.length} statements.`);
  }
  const failedIndex = envelope.result.findIndex((result) => result?.success !== true);
  if (failedIndex !== -1) {
    fail(`Cloudflare D1 batch statement ${failedIndex + 1} failed: ${apiFailure(envelope.result[failedIndex], "unknown D1 error")}`);
  }
  return envelope.result;
}

async function main() {
  const profile = JSON.parse(await readFile(profilePath, "utf8"));
  validateProfile(profile);
  const rendered = renderArtifact(profile);
  if (process.argv.includes("--render-artifact")) {
    await writeFile(path.join(root, TARGET.artifactPath), rendered, "utf8");
    console.log(`Rendered ${TARGET.artifactPath}.`);
    return;
  }
  if (process.argv.includes("--check-artifact")) {
    const tracked = await readFile(path.join(root, TARGET.artifactPath), "utf8");
    if (tracked !== rendered) fail("The corrected artifact does not match the exact revision-2 profile source.");
    console.log(`Validated revision-2 profile and ${TARGET.artifactPath}.`);
    return;
  }

  const remote = process.argv.includes("--remote");
  const apply = process.argv.includes("--apply");
  const receiptPath = process.argv.includes("--receipt") ? process.argv[process.argv.indexOf("--receipt") + 1] : null;
  if (!apply) fail("Use --check-artifact for validation or --remote --apply --confirm-exact-target for the authorized correction.");
  if (!remote || !process.argv.includes("--confirm-exact-target")) fail("The one-time correction requires --remote --confirm-exact-target.");
  if (!receiptPath) fail("The one-time correction requires --receipt <path>.");

  const payload = JSON.stringify(profile);
  const before = readSnapshot(true);
  const currentRevision = before.profile[0]?.current_revision;
  const existingRevision2 = before.revisions.find((row) => row.revision === 2);
  if (currentRevision === 2 || existingRevision2) {
    const state = assertHistoricalState(before, payload, { allowApplied: true });
    const receipt = {
      schemaVersion: 1,
      operation: "basic-calculator-profile-v2-correction",
      result: "already_applied_verified",
      target: TARGET,
      profileSha256: sha256(payload),
      revision1PayloadSha256: sha256(storedJson(state.revision1.payload)),
      protectedStateSha256: protectedFingerprint(before),
      counts: { transcriptTurns: before.transcript.length, finalizations: before.finalization.length, codeAttempts: before.codeAttempts.length, activitySolutionLinks: before.solutionLink.length },
      verifiedAt: new Date().toISOString(),
    };
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    console.log(`Verified already-applied exact revision 2; receipt ${sha256(receipt)}.`);
    return;
  }

  const beforeState = assertHistoricalState(before, payload);
  const beforeProtected = protectedFingerprint(before);
  const beforeRevision1 = sha256(storedJson(beforeState.revision1.payload));
  const beforePointer = sha256(storedJson(beforeState.current.payload));
  const createdAt = Date.now();
  const wranglerConfig = await readFile(path.join(root, "wrangler.jsonc"), "utf8");
  await executeRemoteBatch(buildMutationBatch(before, profile, createdAt), {
    databaseId: databaseIdFromConfig(wranglerConfig),
  });

  const after = readSnapshot(true);
  const afterState = assertHistoricalState(after, payload, { allowApplied: true });
  const afterProtected = protectedFingerprint(after);
  const afterRevision1 = sha256(storedJson(afterState.revision1.payload));
  if (afterProtected !== beforeProtected) fail("Protected historical records changed during the one-time correction.");
  if (afterRevision1 !== beforeRevision1) fail("Immutable Solution Profile revision 1 changed during the one-time correction.");
  const receipt = {
    schemaVersion: 1,
    operation: "basic-calculator-profile-v2-correction",
    result: "applied",
    target: TARGET,
    preWrite: {
      currentRevision: 1,
      revision2Present: false,
      currentPointerPayloadSha256: beforePointer,
      revision1PayloadSha256: beforeRevision1,
      protectedStateSha256: beforeProtected,
    },
    postWrite: {
      currentRevision: 2,
      revision2Present: true,
      currentPointerPayloadSha256: sha256(storedJson(afterState.current.payload)),
      revision1PayloadSha256: afterRevision1,
      revision2PayloadSha256: sha256(storedJson(afterState.revision2.payload)),
      protectedStateSha256: afterProtected,
    },
    counts: { transcriptTurns: after.transcript.length, finalizations: after.finalization.length, codeAttempts: after.codeAttempts.length, activitySolutionLinks: after.solutionLink.length },
    changedTables: ["problem_solution_revisions", "problem_solution_profiles"],
    appliedAt: new Date(createdAt).toISOString(),
    verifiedAt: new Date().toISOString(),
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  console.log(`Applied and verified exact revision 2; receipt ${sha256(receipt)}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
