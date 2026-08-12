#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const TARGET = Object.freeze({
  activityId: "2026-08-10-extra-voice-plan-resume-map-vortexnettech-2026-08-10-v1-0",
  questionId: "resume-map-vortexnettech",
  specialty: "behavioral",
  projectId: "chanter",
  bindingRevision: 1,
  focus: "project_overview",
  previousRevision: 1,
  revision: 2,
  artifactPath: "practice/behavioral/sessions/2026-08-12-experience-map-vortexnettech-solution-profile-revision-02.md",
});

const requiredSectionKeys = [
  "orientation",
  "architecture",
  "end_to_end_flows",
  "ownership_and_evidence",
  "decisions_and_tradeoffs",
  "operations_reliability_security",
  "results_and_gaps",
  "interview_walkthrough",
  "likely_follow_ups",
];
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "../..");
const profilePath = path.join(scriptDirectory, "vortex-profile-v2.json");

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

export function resultSetsFromWrangler(output, { file = false } = {}) {
  // Remote file imports print progress text even when Wrangler receives
  // `--json`. D1 has already committed or rolled back by the time the command
  // exits, and this repair verifies authoritative state with a fresh query.
  if (file) return [];
  const parsed = JSON.parse(output);
  const batches = Array.isArray(parsed) ? parsed : [parsed];
  return batches.map((batch) => batch?.results ?? batch?.result?.[0]?.results ?? []);
}

function executeWrangler(sqlOrFile, { remote, file = false }) {
  const wrangler = path.join(root, "node_modules", ".bin", "wrangler");
  const args = [
    "d1", "execute", "DB", remote ? "--remote" : "--local",
    file ? "--file" : "--command", sqlOrFile,
    "--json",
  ];
  return resultSetsFromWrangler(execFileSync(wrangler, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }), { file });
}

export function validateProfile(profile) {
  if (profile?.schemaVersion !== 1 || !profile.summary?.trim()) fail("Revision 2 needs a non-empty V1 Solution Profile.");
  const keys = profile.sections?.map((section) => section.sectionKey) ?? [];
  if (JSON.stringify(keys) !== JSON.stringify(requiredSectionKeys)) fail("Revision 2 has incorrect Project Deep Dive section keys or ordering.");
  if (profile.sections.some((section) => !section.title?.trim() || !section.body?.trim())) fail("Every revision-2 section needs a title and body.");
  if (profile.projectDeepDive?.projectId !== TARGET.projectId
    || profile.projectDeepDive?.bindingRevision !== TARGET.bindingRevision
    || profile.projectDeepDive?.focus !== TARGET.focus) {
    fail("Revision 2 has incorrect Project Deep Dive metadata.");
  }
  if (!profile.behavioralAnswer?.preferred?.answer?.trim()) fail("Revision 2 needs a preferred Behavioral answer.");
  if (!profile.behavioralAnswer.preferred.evidenceGaps?.length) fail("Revision 2 must preserve explicit evidence gaps.");
  if (!profile.practiceScenarios?.length) fail("Revision 2 needs its approved fictional practice scenarios.");
  for (const scenario of profile.practiceScenarios) {
    if (scenario.mode !== "fictional" || !scenario.label?.includes("not the owner's experience")) {
      fail("Every revision-2 practice scenario must be conspicuously fictional.");
    }
  }
  const coverage = profile.sections.map((section) => section.body).join("\n").toLowerCase();
  for (const phrase of [
    "customer account", "control-plane", "tenant isolation", "redpanda", "transactional outbox",
    "idempotency", "duplicate", "chunk", "embedding", "citation", "confidence", "quota",
    "teaching-assistant", "observability", "ownership", "deployment", "metrics",
  ]) {
    if (!coverage.includes(phrase)) fail(`Revision 2 is missing required coverage: ${phrase}.`);
  }
}

export function renderArtifact(profile) {
  const lines = [
    "---",
    "type: behavioral",
    "title: Experience Map: VortexNetTech — Solution Profile revision 2",
    "date: 2026-08-12",
    "status: published",
    "solution_profile_revision: 2",
    "previous_solution_profile_revision: 1",
    "question_id: resume-map-vortexnettech",
    "project_id: chanter",
    "project_binding_revision: 1",
    "project_focus: project_overview",
    "---",
    "",
    "# Experience Map: VortexNetTech — Solution Profile revision 2",
    "",
    "> Corrected reusable Solution Profile revision. The historical completed attempt, its final answer, finalization, Project Deep Dive link, and published revision-1 artifact remain pinned to Solution Profile revision 1.",
    "",
    "## Summary",
    "",
    profile.summary,
  ];
  for (const section of profile.sections) {
    lines.push("", `## ${section.title} · \`${section.sectionKey}\``, "", section.body);
  }
  lines.push("", "## Preferred Behavioral Answer", "", `### ${profile.behavioralAnswer.preferred.label}`, "", profile.behavioralAnswer.preferred.answer);
  lines.push("", "### Evidence gaps", "");
  for (const gap of profile.behavioralAnswer.preferred.evidenceGaps) lines.push(`- ${gap}`);
  for (const alternative of profile.behavioralAnswer.alternatives) {
    lines.push("", `### Alternative: ${alternative.label}`, "", alternative.answer);
    if (alternative.whenToUse) lines.push("", `Use when: ${alternative.whenToUse}`);
  }
  lines.push("", "## Approved Fictional Practice Scenarios", "", "> Every scenario in this section is fictional practice material, not the owner's experience and not evidence for an employment, ownership, deployment, scale, metric, or result claim.");
  for (const scenario of profile.practiceScenarios) {
    lines.push("", `### ${scenario.label}: ${scenario.scenarioId}`, "", scenario.answer, "", "Invented premises/actions/results:");
    for (const value of [
      ...scenario.canon.inventedPremises,
      ...scenario.canon.inventedActions,
      ...scenario.canon.inventedResults,
    ]) lines.push(`- ${value}`);
    lines.push("", "Limitations:");
    for (const value of scenario.limitations) lines.push(`- ${value}`);
  }
  lines.push("", "## Revision and Evidence Boundary", "", "- Current reusable Solution Profile: revision 2", "- Preserved historical attempt Solution Profile: revision 1", "- Canonical project: `chanter`", "- Binding revision: 1", "- Focus: `project_overview`", "- Exact-question accepted evidence: none", "- Project-level current-versus-target evidence: E1/A0 derived inference; no personal attribution", "- Raw private sources, transcript bytes, recordings, local paths, credentials, and private locators: not published", "");
  return lines.join("\n");
}

function snapshotSql(ownerId) {
  const owner = `owner_id = ${sqlText(ownerId)}`;
  return `
SELECT * FROM problem_solution_profiles
WHERE ${owner} AND specialty = ${sqlText(TARGET.specialty)} AND question_id = ${sqlText(TARGET.questionId)};
SELECT * FROM problem_solution_revisions
WHERE ${owner} AND specialty = ${sqlText(TARGET.specialty)} AND question_id = ${sqlText(TARGET.questionId)} ORDER BY revision;
SELECT * FROM behavioral_project_question_bindings WHERE ${owner} AND question_id = ${sqlText(TARGET.questionId)};
SELECT * FROM activity_finalizations WHERE ${owner} AND activity_id = ${sqlText(TARGET.activityId)};
SELECT * FROM behavioral_final_answer_snapshots WHERE ${owner} AND activity_id = ${sqlText(TARGET.activityId)} ORDER BY snapshot_revision;
SELECT * FROM activity_solution_links WHERE ${owner} AND activity_id = ${sqlText(TARGET.activityId)};
SELECT * FROM behavioral_project_activity_links WHERE ${owner} AND activity_id = ${sqlText(TARGET.activityId)};
SELECT * FROM extra_activities WHERE ${owner} AND id = ${sqlText(TARGET.activityId)};
SELECT * FROM timers WHERE ${owner} AND subject_id = ${sqlText(TARGET.activityId)} ORDER BY kind;
SELECT * FROM outcomes WHERE ${owner} AND activity_id = ${sqlText(TARGET.activityId)};
SELECT * FROM publication_statuses WHERE ${owner} AND activity_id = ${sqlText(TARGET.activityId)};
SELECT * FROM activity_notes WHERE ${owner} AND activity_id = ${sqlText(TARGET.activityId)};
SELECT * FROM practice_notes WHERE ${owner} AND activity_id = ${sqlText(TARGET.activityId)} ORDER BY id;
SELECT * FROM practice_transcript_turns WHERE ${owner} AND activity_id = ${sqlText(TARGET.activityId)} ORDER BY sequence, turn_id;
`;
}

const snapshotLabels = [
  "profile", "revisions", "binding", "finalization", "snapshots", "solutionLink", "projectLink",
  "activity", "timers", "outcomes", "publication", "activityNotes", "practiceNotes", "transcript",
];

function readSnapshot(remote) {
  const [owners] = executeWrangler(`SELECT owner_id FROM problem_solution_profiles WHERE specialty = ${sqlText(TARGET.specialty)} AND question_id = ${sqlText(TARGET.questionId)} ORDER BY owner_id;`, { remote });
  if (owners.length !== 1) fail("The target current Solution Profile does not resolve to exactly one owner.");
  const sets = executeWrangler(snapshotSql(owners[0].owner_id), { remote });
  return Object.fromEntries(snapshotLabels.map((label, index) => [label, sets[index] ?? []]));
}

function protectedFingerprint(snapshot) {
  const protectedRows = Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== "profile" && key !== "revisions"));
  return sha256(protectedRows);
}

function assertHistoricalState(snapshot, profilePayload, { allowApplied = false } = {}) {
  if (snapshot.profile.length !== 1) fail("The target current Solution Profile is not unique.");
  const current = snapshot.profile[0];
  const revisions = snapshot.revisions;
  const revision1 = revisions.find((row) => row.revision === TARGET.previousRevision);
  const revision2 = revisions.find((row) => row.revision === TARGET.revision);
  if (!revision1) fail("Immutable Solution Profile revision 1 is missing.");
  if (!allowApplied && (current.current_revision !== TARGET.previousRevision || revision2)) {
    fail("Write precondition failed: current revision must be exactly 1 and immutable revision 2 must be absent.");
  }
  if (allowApplied && (current.current_revision !== TARGET.revision || !revision2 || storedJson(revision2.payload) !== profilePayload)) {
    fail("The already-applied revision-2 state does not match the exact repair payload.");
  }
  if (snapshot.binding.length !== 1) fail("The exact current Project Deep Dive binding is missing.");
  const binding = snapshot.binding[0];
  if (binding.current_revision !== TARGET.bindingRevision || binding.project_id !== TARGET.projectId
    || binding.focus !== TARGET.focus || binding.state !== "active") fail("The Project Deep Dive binding is not the authorized revision-1 Chanter overview.");
  if (snapshot.finalization.length !== 1 || snapshot.finalization[0].revision !== 1) fail("Finalization revision 1 is missing.");
  if (snapshot.snapshots.length !== 1 || snapshot.snapshots[0].snapshot_revision !== 1) fail("Final-answer snapshot revision 1 is missing or not unique.");
  if (snapshot.solutionLink.length !== 1 || snapshot.solutionLink[0].solution_revision !== 1) fail("The activity Solution Profile link is not pinned to revision 1.");
  const link = snapshot.projectLink[0];
  if (snapshot.projectLink.length !== 1 || link.question_id !== TARGET.questionId || link.binding_revision !== 1
    || link.project_id !== TARGET.projectId || link.focus !== TARGET.focus || link.solution_revision !== 1) {
    fail("The immutable Project Deep Dive attempt link is not pinned to the exact revision-1 identities.");
  }
  if (snapshot.activity.length !== 1 || snapshot.transcript.length !== 98) fail("The target completed activity or authoritative 98-turn transcript is missing.");
  return { current, revision1, revision2 };
}

function guard(condition) {
  return `SELECT json_extract(CASE WHEN (${condition}) THEN '{"allowed":1}' ELSE 'invalid' END, '$.allowed') AS allowed;`;
}

export function buildMutationSql(snapshot, profile, createdAt) {
  const payload = JSON.stringify(profile);
  const tags = JSON.stringify(profile.tags);
  const { current, revision1 } = assertHistoricalState(snapshot, payload);
  return [
    guard(`EXISTS (SELECT 1 FROM problem_solution_profiles WHERE owner_id = ${sqlText(current.owner_id)} AND specialty = ${sqlText(TARGET.specialty)} AND question_id = ${sqlText(TARGET.questionId)} AND current_revision = 1 AND updated_at = ${Number(current.updated_at)} AND payload = ${sqlText(storedJson(current.payload))})`),
    guard(`EXISTS (SELECT 1 FROM problem_solution_revisions WHERE owner_id = ${sqlText(current.owner_id)} AND specialty = ${sqlText(TARGET.specialty)} AND question_id = ${sqlText(TARGET.questionId)} AND revision = 1 AND activity_id = ${sqlText(revision1.activity_id)} AND payload = ${sqlText(storedJson(revision1.payload))} AND created_at = ${Number(revision1.created_at)})`),
    guard(`NOT EXISTS (SELECT 1 FROM problem_solution_revisions WHERE owner_id = ${sqlText(current.owner_id)} AND specialty = ${sqlText(TARGET.specialty)} AND question_id = ${sqlText(TARGET.questionId)} AND revision = 2)`),
    guard(`EXISTS (SELECT 1 FROM activity_solution_links WHERE owner_id = ${sqlText(current.owner_id)} AND activity_id = ${sqlText(TARGET.activityId)} AND specialty = ${sqlText(TARGET.specialty)} AND question_id = ${sqlText(TARGET.questionId)} AND solution_revision = 1)`),
    guard(`EXISTS (SELECT 1 FROM behavioral_project_activity_links WHERE owner_id = ${sqlText(current.owner_id)} AND activity_id = ${sqlText(TARGET.activityId)} AND question_id = ${sqlText(TARGET.questionId)} AND binding_revision = 1 AND project_id = ${sqlText(TARGET.projectId)} AND focus = ${sqlText(TARGET.focus)} AND solution_revision = 1)`),
    `INSERT INTO problem_solution_revisions (owner_id, specialty, question_id, revision, activity_id, payload, created_at) VALUES (${sqlText(current.owner_id)}, ${sqlText(TARGET.specialty)}, ${sqlText(TARGET.questionId)}, 2, ${sqlText(TARGET.activityId)}, ${sqlText(payload)}, ${Number(createdAt)});`,
    `UPDATE problem_solution_profiles SET current_revision = 2, tags = ${sqlText(tags)}, payload = ${sqlText(payload)}, updated_at = ${Number(createdAt)} WHERE owner_id = ${sqlText(current.owner_id)} AND specialty = ${sqlText(TARGET.specialty)} AND question_id = ${sqlText(TARGET.questionId)} AND current_revision = 1 AND updated_at = ${Number(current.updated_at)} AND payload = ${sqlText(storedJson(current.payload))};`,
    guard("changes() = 1"),
    guard(`EXISTS (SELECT 1 FROM problem_solution_profiles WHERE owner_id = ${sqlText(current.owner_id)} AND specialty = ${sqlText(TARGET.specialty)} AND question_id = ${sqlText(TARGET.questionId)} AND current_revision = 2 AND tags = ${sqlText(tags)} AND payload = ${sqlText(payload)} AND updated_at = ${Number(createdAt)})`),
    guard(`EXISTS (SELECT 1 FROM problem_solution_revisions WHERE owner_id = ${sqlText(current.owner_id)} AND specialty = ${sqlText(TARGET.specialty)} AND question_id = ${sqlText(TARGET.questionId)} AND revision = 2 AND activity_id = ${sqlText(TARGET.activityId)} AND payload = ${sqlText(payload)} AND created_at = ${Number(createdAt)})`),
    guard(`EXISTS (SELECT 1 FROM problem_solution_revisions WHERE owner_id = ${sqlText(current.owner_id)} AND specialty = ${sqlText(TARGET.specialty)} AND question_id = ${sqlText(TARGET.questionId)} AND revision = 1 AND activity_id = ${sqlText(revision1.activity_id)} AND payload = ${sqlText(storedJson(revision1.payload))} AND created_at = ${Number(revision1.created_at)})`),
  ].join("\n");
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
  if (!apply) fail("Use --check-artifact for validation or --remote --apply --confirm-exact-target for the authorized repair.");
  if (!remote || !process.argv.includes("--confirm-exact-target")) fail("The one-time repair requires --remote --confirm-exact-target.");
  if (!receiptPath) fail("The one-time repair requires --receipt <path>.");

  const payload = JSON.stringify(profile);
  const before = readSnapshot(true);
  const currentRevision = before.profile[0]?.current_revision;
  const existingRevision2 = before.revisions.find((row) => row.revision === 2);
  if (currentRevision === 2 || existingRevision2) {
    const state = assertHistoricalState(before, payload, { allowApplied: true });
    const receipt = {
      schemaVersion: 1,
      operation: "vortex-profile-v2-repair",
      result: "already_applied_verified",
      target: TARGET,
      profileSha256: sha256(payload),
      revision1PayloadSha256: sha256(storedJson(state.revision1.payload)),
      protectedStateSha256: protectedFingerprint(before),
      counts: { transcriptTurns: before.transcript.length, finalizations: before.finalization.length, finalAnswerSnapshots: before.snapshots.length, projectAttemptLinks: before.projectLink.length },
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
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "vortex-profile-v2-"));
  const sqlPath = path.join(temporaryDirectory, "repair.sql");
  try {
    await writeFile(sqlPath, buildMutationSql(before, profile, createdAt), { mode: 0o600 });
    executeWrangler(sqlPath, { remote: true, file: true });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  const after = readSnapshot(true);
  const afterState = assertHistoricalState(after, payload, { allowApplied: true });
  const afterProtected = protectedFingerprint(after);
  const afterRevision1 = sha256(storedJson(afterState.revision1.payload));
  if (afterProtected !== beforeProtected) fail("Protected historical records changed during the one-time repair.");
  if (afterRevision1 !== beforeRevision1) fail("Immutable Solution Profile revision 1 changed during the one-time repair.");
  const receipt = {
    schemaVersion: 1,
    operation: "vortex-profile-v2-repair",
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
    counts: { transcriptTurns: after.transcript.length, finalizations: after.finalization.length, finalAnswerSnapshots: after.snapshots.length, activitySolutionLinks: after.solutionLink.length, projectAttemptLinks: after.projectLink.length },
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
