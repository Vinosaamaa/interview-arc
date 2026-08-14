#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { solutionProfileMissingRequirements } from "../app/solution-profile-policy.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

function executeWrangler(sql, remote) {
  const wrangler = path.join(root, "node_modules", ".bin", "wrangler");
  return resultSetsFromWrangler(execFileSync(wrangler, [
    "d1", "execute", "DB", remote ? "--remote" : "--local", "--command", sql, "--json",
  ], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
}

function targetQueries(target) {
  const where = `specialty = 'leetcode' AND question_id = ${sqlText(target.questionId)}`;
  const owner = `owner_id = (SELECT owner_id FROM problem_solution_profiles WHERE ${where} ORDER BY owner_id LIMIT 1)`;
  return [
    ["owners", `SELECT owner_id FROM problem_solution_profiles WHERE ${where} ORDER BY owner_id;`],
    ["profile", `SELECT * FROM problem_solution_profiles WHERE ${owner} AND ${where};`],
    ["revisions", `SELECT * FROM problem_solution_revisions WHERE ${owner} AND ${where} ORDER BY revision;`],
    ["links", `SELECT * FROM activity_solution_links WHERE ${owner} AND ${where} ORDER BY activity_id;`],
  ];
}

export const repairTargetReadBatchSize = 4;

export function repairTargetReadBatches(targets, batchSize = repairTargetReadBatchSize) {
  if (!Number.isInteger(batchSize) || batchSize < 1) fail("Repair read batch size must be a positive integer.");
  const batches = [];
  for (let index = 0; index < targets.length; index += batchSize) {
    batches.push(targets.slice(index, index + batchSize));
  }
  return batches;
}

function readTargets(targets, remote) {
  const snapshots = [];
  for (const batch of repairTargetReadBatches(targets)) {
    const queryGroups = batch.map(targetQueries);
    const resultSets = executeWrangler(queryGroups.flat().map(([, sql]) => sql).join("\n"), remote);
    queryGroups.forEach((queries, targetIndex) => {
      const offset = targetIndex * queries.length;
      snapshots.push(Object.fromEntries(
        queries.map(([label], queryIndex) => [label, resultSets[offset + queryIndex] ?? []]),
      ));
    });
  }
  return snapshots;
}

export function validateRepairPacket(packet) {
  if (packet?.schemaVersion !== 1 || packet.specialty !== "leetcode" || !packet.operationId?.trim()) {
    fail("The repair packet needs schemaVersion 1, specialty leetcode, and an operation ID.");
  }
  if (!Array.isArray(packet.targets) || packet.targets.length === 0) fail("The repair packet needs at least one target.");
  const identities = new Set();
  for (const target of packet.targets) {
    if (!target.questionId?.trim() || !target.title?.trim() || !Number.isInteger(target.expectedCurrentRevision) || target.expectedCurrentRevision < 1) {
      fail("Every repair target needs a question, title, and positive expected revision.");
    }
    if (identities.has(target.questionId)) fail(`Duplicate repair target: ${target.questionId}.`);
    identities.add(target.questionId);
    if (!/^[a-f0-9]{64}$/.test(target.expectedCurrentPayloadSha256 ?? "")) {
      fail(`Target ${target.questionId} needs the exact current payload fingerprint.`);
    }
    const missing = solutionProfileMissingRequirements("leetcode", target.profile);
    if (missing.length) fail(`Target ${target.questionId} is incomplete: ${missing.join(", ")}.`);
    if (target.profile.editorialResearch.url !== `https://leetcode.com/problems/${target.questionId}/editorial/`) {
      fail(`Target ${target.questionId} has the wrong Editorial URL.`);
    }
  }
}

function historicalFingerprint(snapshot, maximumRevision) {
  return sha256({
    revisions: snapshot.revisions.filter((revision) => revision.revision <= maximumRevision),
    links: snapshot.links,
  });
}

export function assertTargetState(target, snapshot, { allowApplied = false } = {}) {
  if (snapshot.owners.length !== 1 || snapshot.profile.length !== 1) {
    fail(`Target ${target.questionId} must resolve to exactly one owner and current profile.`);
  }
  const current = snapshot.profile[0];
  const expectedRevision = target.expectedCurrentRevision;
  const nextRevision = expectedRevision + 1;
  const prior = snapshot.revisions.find((revision) => revision.revision === expectedRevision);
  const next = snapshot.revisions.find((revision) => revision.revision === nextRevision);
  const expectedPayload = JSON.stringify(target.profile);
  if (!prior) {
    fail(`Target ${target.questionId} is missing its exact current immutable revision.`);
  }
  if (current.current_revision === expectedRevision && storedJson(prior.payload) !== storedJson(current.payload)) {
    fail(`Target ${target.questionId} current pointer does not match its immutable revision.`);
  }
  if (sha256(storedJson(prior.payload)) !== target.expectedCurrentPayloadSha256) {
    fail(`Target ${target.questionId} current payload fingerprint changed.`);
  }
  if (!allowApplied && (current.current_revision !== expectedRevision || next)) {
    fail(`Target ${target.questionId} write precondition failed.`);
  }
  if (allowApplied && (current.current_revision !== nextRevision
      || storedJson(current.payload) !== expectedPayload
      || !next
      || next.activity_id !== prior.activity_id
      || storedJson(next.payload) !== expectedPayload)) {
    fail(`Target ${target.questionId} applied state does not match the exact packet.`);
  }
  return { current, prior, next, nextRevision, expectedPayload };
}

function guard(condition, params = []) {
  return {
    sql: `SELECT json_extract(CASE WHEN (${condition}) THEN '{"allowed":1}' ELSE 'invalid' END, '$.allowed') AS allowed`,
    params,
  };
}

export function buildMutationBatch(packet, snapshots, createdAt) {
  return packet.targets.flatMap((target, index) => {
    const { current, prior, nextRevision, expectedPayload } = assertTargetState(target, snapshots[index]);
    const tags = JSON.stringify(target.profile.tags);
    return [
      guard("EXISTS (SELECT 1 FROM problem_solution_profiles WHERE owner_id = ? AND specialty = 'leetcode' AND question_id = ? AND current_revision = ? AND updated_at = ? AND payload = ?)", [current.owner_id, target.questionId, target.expectedCurrentRevision, Number(current.updated_at), storedJson(current.payload)]),
      guard("EXISTS (SELECT 1 FROM problem_solution_revisions WHERE owner_id = ? AND specialty = 'leetcode' AND question_id = ? AND revision = ? AND activity_id = ? AND payload = ? AND created_at = ?)", [current.owner_id, target.questionId, target.expectedCurrentRevision, prior.activity_id, storedJson(prior.payload), Number(prior.created_at)]),
      guard("NOT EXISTS (SELECT 1 FROM problem_solution_revisions WHERE owner_id = ? AND specialty = 'leetcode' AND question_id = ? AND revision = ?)", [current.owner_id, target.questionId, nextRevision]),
      {
        sql: "INSERT INTO problem_solution_revisions (owner_id, specialty, question_id, revision, activity_id, payload, created_at) VALUES (?, 'leetcode', ?, ?, ?, ?, ?)",
        params: [current.owner_id, target.questionId, nextRevision, prior.activity_id, expectedPayload, Number(createdAt)],
      },
      {
        sql: "UPDATE problem_solution_profiles SET title = ?, current_revision = ?, tags = ?, payload = ?, updated_at = ? WHERE owner_id = ? AND specialty = 'leetcode' AND question_id = ? AND current_revision = ? AND updated_at = ? AND payload = ?",
        params: [target.title, nextRevision, tags, expectedPayload, Number(createdAt), current.owner_id, target.questionId, target.expectedCurrentRevision, Number(current.updated_at), storedJson(current.payload)],
      },
      guard("changes() = 1"),
      guard("EXISTS (SELECT 1 FROM problem_solution_profiles WHERE owner_id = ? AND specialty = 'leetcode' AND question_id = ? AND current_revision = ? AND tags = ? AND payload = ? AND updated_at = ?)", [current.owner_id, target.questionId, nextRevision, tags, expectedPayload, Number(createdAt)]),
      guard("EXISTS (SELECT 1 FROM problem_solution_revisions WHERE owner_id = ? AND specialty = 'leetcode' AND question_id = ? AND revision = ? AND activity_id = ? AND payload = ? AND created_at = ?)", [current.owner_id, target.questionId, nextRevision, prior.activity_id, expectedPayload, Number(createdAt)]),
    ];
  });
}

export function databaseIdFromConfig(source) {
  const match = source.match(/"binding"\s*:\s*"DB"[\s\S]{0,500}?"database_id"\s*:\s*"([^"]+)"/);
  if (!match?.[1]) fail("wrangler.jsonc does not define the DB database_id.");
  return match[1];
}

export async function executeRemoteBatch(batch, {
  accountId = process.env.CLOUDFLARE_ACCOUNT_ID,
  apiToken = process.env.CLOUDFLARE_API_TOKEN,
  databaseId,
  fetchImpl = fetch,
} = {}) {
  if (!accountId || !apiToken || !databaseId) fail("Cloudflare account, token, and D1 database ID are required.");
  const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ batch }),
  });
  const envelope = await response.json();
  if (!response.ok || envelope?.success !== true || !Array.isArray(envelope.result) || envelope.result.length !== batch.length) {
    fail(`Cloudflare D1 batch failed: ${JSON.stringify(envelope?.errors ?? envelope)}`);
  }
  const failedIndex = envelope.result.findIndex((result) => result?.success !== true);
  if (failedIndex >= 0) fail(`Cloudflare D1 batch statement ${failedIndex + 1} failed.`);
  return envelope.result;
}

async function main() {
  const packetFlag = process.argv.indexOf("--packet");
  const receiptFlag = process.argv.indexOf("--receipt");
  if (packetFlag < 0 || !process.argv[packetFlag + 1]) fail("Use --packet <gitignored-json-path>.");
  const packetPath = process.argv[packetFlag + 1];
  let packetSource;
  if (packetPath === "-") {
    packetSource = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) packetSource += chunk;
  } else {
    packetSource = await readFile(path.resolve(packetPath), "utf8");
  }
  const packet = JSON.parse(packetSource);
  validateRepairPacket(packet);
  const remote = process.argv.includes("--remote");
  const apply = process.argv.includes("--apply");
  const before = readTargets(packet.targets, remote);
  const applied = packet.targets.map((target, index) => before[index].profile[0]?.current_revision === target.expectedCurrentRevision + 1);
  packet.targets.forEach((target, index) => assertTargetState(target, before[index], { allowApplied: applied[index] }));
  if (applied.every(Boolean)) {
    process.stdout.write(`${JSON.stringify({ result: "already_applied_verified", operationId: packet.operationId, targets: packet.targets.length })}\n`);
    return;
  }
  if (!apply) {
    process.stdout.write(`${JSON.stringify({ result: "validated", operationId: packet.operationId, targets: packet.targets.length, alreadyApplied: applied.filter(Boolean).length })}\n`);
    return;
  }
  if (!remote || !process.argv.includes("--confirm-exact-target") || receiptFlag < 0 || !process.argv[receiptFlag + 1]) {
    fail("Applying requires --remote --apply --confirm-exact-target --receipt <path>.");
  }
  const receiptPath = path.resolve(process.argv[receiptFlag + 1]);
  const historicalBefore = packet.targets.map((target, index) => historicalFingerprint(before[index], target.expectedCurrentRevision));
  const createdAt = Date.now();
  const config = await readFile(path.join(root, "wrangler.jsonc"), "utf8");
  const databaseId = databaseIdFromConfig(config);
  const completed = [];
  const verifiedAfter = [];
  for (let index = 0; index < packet.targets.length; index += 1) {
    const target = packet.targets[index];
    if (!applied[index]) {
      await executeRemoteBatch(buildMutationBatch({ ...packet, targets: [target] }, [before[index]], createdAt), { databaseId });
    }
    const targetAfter = applied[index] ? before[index] : readTargets([target], true)[0];
    const state = assertTargetState(target, targetAfter, { allowApplied: true });
    const historicalAfter = historicalFingerprint(targetAfter, target.expectedCurrentRevision);
    if (historicalAfter !== historicalBefore[index]) fail(`Target ${target.questionId} historical revisions or attempt links changed.`);
    completed.push({
      questionId: target.questionId,
      previousRevision: target.expectedCurrentRevision,
      currentRevision: state.nextRevision,
      previousPayloadSha256: target.expectedCurrentPayloadSha256,
      currentPayloadSha256: sha256(state.expectedPayload),
      historicalStateSha256: historicalAfter,
      result: applied[index] ? "already_applied_verified" : "applied",
    });
    verifiedAfter.push(targetAfter);
    const progressiveReceipt = {
      schemaVersion: 1,
      operationId: packet.operationId,
      result: completed.length === packet.targets.length ? "applied" : "partially_applied",
      createdAt,
      completedTargets: completed.length,
      totalTargets: packet.targets.length,
      targets: completed,
    };
    await writeFile(receiptPath, `${JSON.stringify(progressiveReceipt, null, 2)}\n`, { mode: 0o600 });
  }
  const targets = packet.targets.map((target, index) => {
    const state = assertTargetState(target, verifiedAfter[index], { allowApplied: true });
    const historicalAfter = historicalFingerprint(verifiedAfter[index], target.expectedCurrentRevision);
    if (historicalAfter !== historicalBefore[index]) fail(`Target ${target.questionId} historical revisions or attempt links changed.`);
    return {
      questionId: target.questionId,
      previousRevision: target.expectedCurrentRevision,
      currentRevision: state.nextRevision,
      previousPayloadSha256: target.expectedCurrentPayloadSha256,
      currentPayloadSha256: sha256(state.expectedPayload),
      historicalStateSha256: historicalAfter,
    };
  });
  const receipt = { schemaVersion: 1, operationId: packet.operationId, result: "applied", createdAt, completedTargets: targets.length, totalTargets: targets.length, targets };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ result: "applied", operationId: packet.operationId, targets: targets.length, receiptSha256: sha256(receipt) })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
