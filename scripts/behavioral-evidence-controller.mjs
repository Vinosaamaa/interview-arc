import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assertRemoteSafe,
  buildBehavioralEvidenceSite,
  validateBehavioralEvidenceBundle,
} from "./build-behavioral-evidence-site.mjs";

const execFileAsync = promisify(execFile);
const MAX_DIRECTORY_ENTRIES = 5_000;
const MAX_REMOTE_TEXT = 240;
const SOURCE_KINDS = new Set(["resume", "repository", "document", "chat_export", "architecture", "git_history", "user_statement", "other"]);
const REMOTE_E1_MAX_ORIGINS = new Set(["user_statement", "resume", "generated_secondary", "derived_inference"]);
const PROVENANCE_BY_ORIGIN = {
  user_statement: "conversation",
  resume: "resume_claim",
  document: "document_observation",
  code_observation: "repository_observation",
  test_config_observation: "repository_observation",
  git_metadata: "repository_observation",
  generated_secondary: "generated_secondary",
  derived_inference: "derived_inference",
  production_evidence: "production_evidence",
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableRemoteId(value) {
  const normalized = value.toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
    throw new Error("A canonical identity cannot be normalized into a remote stable ID.");
  }
  if (normalized.length <= 200) return normalized;
  return `${normalized.slice(0, 167)}-${sha256(normalized).slice(0, 32)}`;
}

function sourceRemoteId(projectId, sourceId) {
  return stableRemoteId(`${projectId}.${sourceId}`);
}

function boundedSafeText(value, label, max = MAX_REMOTE_TEXT) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new Error(`${label} must be a non-empty display-safe string of at most ${max} characters.`);
  }
  assertRemoteSafe(value, label);
  return value.trim();
}

function atomicJson(filePath, value) {
  return mkdir(path.dirname(filePath), { recursive: true }).then(async () => {
    const temporaryPath = `${filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  });
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function hashDirectoryMetadata(root) {
  const entries = [];
  async function visit(directory) {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      if (entries.length >= MAX_DIRECTORY_ENTRIES) throw new Error("source_entry_budget_exceeded");
      const absolute = path.join(directory, child.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (child.name === ".git") {
        entries.push(`${relative}:git-metadata`);
        continue;
      }
      const metadata = await lstat(absolute);
      entries.push(`${relative}:${child.isDirectory() ? "d" : "f"}:${metadata.size}:${Math.trunc(metadata.mtimeMs)}`);
      if (child.isDirectory()) await visit(absolute);
    }
  }
  await visit(root);
  return sha256(entries.join("\n"));
}

async function inspectLocalSource(locator) {
  const metadata = await stat(locator);
  if (metadata.isFile()) {
    const fingerprint = await hashFile(locator);
    return { fingerprint, revision: `sha256-${fingerprint}` };
  }
  if (!metadata.isDirectory()) throw new Error("unsupported_source_type");
  try {
    const [{ stdout: head }, { stdout: worktree }] = await Promise.all([
      execFileAsync("git", ["-C", locator, "rev-parse", "HEAD"], { timeout: 10_000, maxBuffer: 1024 * 1024 }),
      execFileAsync("git", ["-C", locator, "status", "--porcelain=v1", "--untracked-files=no"], { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }),
    ]);
    const revision = head.trim();
    const fingerprint = sha256(`git:${revision}\n${worktree}`);
    return { fingerprint, revision };
  } catch {
    const fingerprint = await hashDirectoryMetadata(locator);
    return { fingerprint, revision: `directory-${fingerprint}` };
  }
}

function filesystemLocator(source) {
  return source.refreshMode === "filesystem" ? source.locator : null;
}

function candidateDispositionSummary(project) {
  const pendingEvidenceIds = new Set(
    project.record.evidence
      .filter((item) => item.candidateState === "pending")
      .map((item) => item.id),
  );
  const candidateEvidenceIds = new Set(
    project.record.d1Candidates.map((candidate) => candidate.sourceEvidenceIds[0]),
  );
  const excludedEvidenceIds = new Set(
    project.record.d1Exclusions.map((exclusion) => exclusion.sourceEvidenceId),
  );
  let uncoveredPendingEvidence = 0;
  for (const evidenceId of pendingEvidenceIds) {
    if (!candidateEvidenceIds.has(evidenceId) && !excludedEvidenceIds.has(evidenceId)) {
      uncoveredPendingEvidence += 1;
    }
  }
  return {
    candidateCoveredEvidence: candidateEvidenceIds.size,
    excludedEvidence: excludedEvidenceIds.size,
    uncoveredPendingEvidence,
  };
}

export function summarizeBehavioralEvidenceBundle(bundle) {
  const totals = {
    projects: bundle.projects.length,
    sources: 0,
    availableSources: 0,
    blockedSources: 0,
    evidence: 0,
    pendingEvidence: 0,
    remoteCandidates: 0,
    candidateCoveredEvidence: 0,
    excludedEvidence: 0,
    uncoveredPendingEvidence: 0,
    publicationCandidates: 0,
  };
  for (const project of bundle.projects) {
    totals.sources += project.record.sources.length;
    totals.availableSources += project.record.sources.filter((source) => source.availability === "available").length;
    totals.blockedSources += project.record.sources.filter((source) => source.availability === "blocked").length;
    totals.evidence += project.record.evidence.length;
    totals.pendingEvidence += project.record.evidence.filter((item) => item.candidateState === "pending").length;
    totals.remoteCandidates += project.record.d1Candidates.length;
    const disposition = candidateDispositionSummary(project);
    totals.candidateCoveredEvidence += disposition.candidateCoveredEvidence;
    totals.excludedEvidence += disposition.excludedEvidence;
    totals.uncoveredPendingEvidence += disposition.uncoveredPendingEvidence;
    totals.publicationCandidates += project.record.publicationCandidates.length;
  }
  return totals;
}

export async function refreshBehavioralEvidenceSources({ bundleRoot, now = new Date() }) {
  const bundle = await validateBehavioralEvidenceBundle({ bundleRoot });
  const summary = { inspected: 0, changed: 0, missing: 0, blocked: 0, notChecked: 0 };
  for (const project of bundle.projects) {
    let projectChanged = false;
    for (const source of project.record.sources) {
      if (!["user_authorized", "user_owned"].includes(source.authorization)) {
        source.availability = "blocked";
        source.refreshStatus = "blocked";
        summary.blocked += 1;
        projectChanged = true;
        continue;
      }
      if (source.refreshMode === "blocked") {
        source.availability = "blocked";
        source.refreshStatus = "blocked";
        summary.blocked += 1;
        projectChanged = true;
        continue;
      }
      const locator = filesystemLocator(source);
      if (!locator) {
        if (["missing", "blocked"].includes(source.availability)) source.availability = "not_checked";
        source.refreshStatus = "not_checked";
        summary.notChecked += 1;
        projectChanged = true;
        continue;
      }
      const previousFingerprint = source.fingerprint ?? null;
      try {
        const observed = await inspectLocalSource(locator);
        source.fingerprint = observed.fingerprint;
        source.revision = observed.revision;
        source.inspectedAt = now.toISOString();
        source.availability = "available";
        source.refreshStatus = previousFingerprint && previousFingerprint !== observed.fingerprint ? "changed" : "current";
        summary.inspected += 1;
        if (source.refreshStatus === "changed") summary.changed += 1;
      } catch (error) {
        source.inspectedAt = now.toISOString();
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          source.availability = "missing";
          source.refreshStatus = "unavailable";
          summary.missing += 1;
        } else {
          source.availability = "blocked";
          source.refreshStatus = "blocked";
          summary.blocked += 1;
        }
      }
      projectChanged = true;
    }
    if (projectChanged) {
      project.record.project.inspectedAt = now.toISOString();
      await atomicJson(project.recordPath, project.record);
    }
  }
  const manifestPath = path.join(bundle.bundleRoot, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.updatedAt = now.toISOString();
  await atomicJson(manifestPath, manifest);
  await validateBehavioralEvidenceBundle({ bundleRoot });
  return summary;
}

function sourceRefreshStatus(source) {
  if (source.refreshStatus) return source.refreshStatus;
  if (source.availability === "blocked") return "blocked";
  if (source.availability === "missing") return "unavailable";
  if (source.availability === "not_checked") return "not_checked";
  return source.inspectedAt ? "current" : "not_checked";
}

function projectSourceSnapshot(project, source) {
  if (!SOURCE_KINDS.has(source.kind)) throw new Error("A source kind is outside the D1 source registry contract.");
  if (source.authorization === "authorization_required" && source.availability === "available") {
    throw new Error("An available source still requires authorization.");
  }
  const snapshot = {
    schemaVersion: 1,
    sourceId: sourceRemoteId(project.record.project.id, source.id),
    state: "active",
    projectKey: stableRemoteId(project.record.project.id),
    kind: source.kind,
    label: boundedSafeText(source.safeHint, "source.safeHint"),
    safeHint: `Sanitized ${source.kind.replaceAll("_", " ")} source metadata.`,
    authorization: source.authorization,
    sensitivity: source.sensitivity,
    availability: source.availability,
    refreshStatus: sourceRefreshStatus(source),
    ...(source.revision ? { contentRevision: boundedSafeText(source.revision, "source.revision", 200) } : {}),
    ...(/^[a-f0-9]{64}$/.test(source.fingerprint ?? "") ? { contentFingerprint: source.fingerprint } : {}),
    ...(source.inspectedAt && Number.isFinite(Date.parse(source.inspectedAt)) ? { lastInspectedAt: Date.parse(source.inspectedAt) } : {}),
    visibility: "owner_private",
  };
  if (snapshot.availability === "available" && !snapshot.contentRevision && !snapshot.contentFingerprint) {
    throw new Error("An available source must be refreshed before sync preparation.");
  }
  if (snapshot.availability === "available" && !snapshot.lastInspectedAt) {
    throw new Error("An available source needs an exact inspection timestamp before sync preparation.");
  }
  assertRemoteSafe(snapshot, "source registry snapshot");
  return snapshot;
}

function evidenceSourceRevision(project, evidence, sourceById) {
  if (evidence.origin === "user_statement") return undefined;
  const revisions = evidence.sourceIds.map((sourceId) => {
    const source = sourceById.get(sourceId);
    if (!source) throw new Error("Evidence references an unavailable source.");
    return source.revision ?? source.fingerprint;
  });
  if (revisions.some((revision) => !revision)) throw new Error("Non-conversation evidence requires refreshed source revisions before sync preparation.");
  return `source-set-${sha256(JSON.stringify(revisions.sort()))}`;
}

function remoteEvidenceWrites(project, sourceSnapshots) {
  const evidenceById = new Map(project.record.evidence.map((item) => [item.id, item]));
  const sourceById = new Map(project.record.sources.map((source) => [source.id, source]));
  const snapshotsByLocalId = new Map(project.record.sources.map((source, index) => [source.id, sourceSnapshots[index]]));
  const seenLinks = new Set();
  const writes = [];
  for (const candidate of project.record.d1Candidates ?? []) {
    const evidence = evidenceById.get(candidate.sourceEvidenceIds[0]);
    if (!evidence) throw new Error("A remote candidate references unavailable canonical evidence.");
    if (evidence.attributionGrade === "A3") {
      throw new Error("A3 owner attestation must be captured from an exact Behavioral transcript turn, not a local connector.");
    }
    if (REMOTE_E1_MAX_ORIGINS.has(evidence.origin) && ["E2", "E3"].includes(evidence.evidenceGrade)) {
      throw new Error("Owner statements, resume claims, generated material, and inferences cannot be prepared above E1 for D1 sync.");
    }
    const provenanceKind = PROVENANCE_BY_ORIGIN[evidence.origin];
    if (!provenanceKind) throw new Error("The evidence origin has no remote provenance mapping.");
    const sourceRevision = evidenceSourceRevision(project, evidence, sourceById);
    const evidencePayload = {
      evidenceId: stableRemoteId(evidence.id),
      projectKey: stableRemoteId(project.record.project.id),
      origin: evidence.origin,
      statement: evidence.statement,
      ...(sourceRevision ? { sourceRevision } : {}),
      evidenceGrade: evidence.evidenceGrade,
      attributionGrade: evidence.attributionGrade,
      claimStrength: evidence.claimStrength,
      candidateState: "pending",
      safeProvenance: evidence.sourceIds.map((sourceId) => ({
        kind: provenanceKind,
        reference: snapshotsByLocalId.get(sourceId)?.sourceId ?? sourceRemoteId(project.record.project.id, sourceId),
      })),
      supports: evidence.supports,
      limitations: evidence.limitations,
      tags: evidence.tags ?? [],
    };
    for (const link of candidate.content.questionLinks) {
      const questionLink = { questionId: stableRemoteId(link.questionId), relevance: link.relevance };
      const linkIdentity = `${evidencePayload.evidenceId}:${questionLink.questionId}`;
      if (seenLinks.has(linkIdentity)) throw new Error("Two sync candidates project the same evidence/question identity.");
      seenLinks.add(linkIdentity);
      const fingerprint = sha256(JSON.stringify({ evidence: evidencePayload, questionLink }));
      const operationId = stableRemoteId(`evidence-${candidate.id}-${fingerprint.slice(0, 20)}`);
      const input = { operationId, evidence: evidencePayload, questionLink };
      assertRemoteSafe(input, "evidence write");
      writes.push({
        tool: "upsert_behavioral_evidence_item",
        input,
        sourceEvidenceIds: candidate.sourceEvidenceIds,
        transformations: candidate.transformations,
        limitations: candidate.limitations,
      });
    }
  }
  return writes;
}

export async function prepareBehavioralEvidenceSyncPlan({ bundleRoot, now = new Date() }) {
  const bundle = await validateBehavioralEvidenceBundle({ bundleRoot });
  const sources = [];
  const evidence = [];
  let evidenceCandidates = 0;
  let excludedEvidence = 0;
  for (const project of bundle.projects) {
    const disposition = candidateDispositionSummary(project);
    if (disposition.uncoveredPendingEvidence > 0) {
      throw new Error(
        `Project ${project.record.project.id} has ${disposition.uncoveredPendingEvidence} pending evidence records without a D1 candidate or explicit local-only exclusion.`,
      );
    }
    evidenceCandidates += disposition.candidateCoveredEvidence;
    excludedEvidence += disposition.excludedEvidence;
    const snapshots = project.record.sources.map((source) => projectSourceSnapshot(project, source));
    for (const source of snapshots) {
      const fingerprint = sha256(JSON.stringify(source));
      sources.push({
        tool: "upsert_behavioral_evidence_source",
        sourceId: source.sourceId,
        operationIdSeed: stableRemoteId(`source-${source.sourceId}-${fingerprint.slice(0, 20)}`),
        expectedRevision: "read_current_registry_before_write",
        authorization: "behavioral_evidence_specialist",
        source,
      });
    }
    evidence.push(...remoteEvidenceWrites(project, snapshots));
  }
  const plan = {
    schemaVersion: 1,
    bundleId: stableRemoteId(bundle.manifest.bundleId),
    preparedAt: now.toISOString(),
    visibility: "owner_private",
    boundary: "sanitized_metadata_and_explicit_typed_candidates_only",
    sources,
    evidence,
    summary: {
      sources: sources.length,
      evidenceWrites: evidence.length,
      evidenceCandidates,
      excludedEvidence,
    },
  };
  assertRemoteSafe(plan, "sync plan");
  const planPath = path.join(bundle.bundleRoot, "sync", "plan.json");
  await atomicJson(planPath, plan);
  return { plan, planPath };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const repositoryRoot = new URL("../", import.meta.url);
  const bundleRoot = argumentValue("--bundle") ?? fileURLToPath(new URL("private-sources/behavioral-foundation", repositoryRoot));
  const command = process.argv[2] ?? "status";
  if (command === "status") {
    const bundle = await validateBehavioralEvidenceBundle({ bundleRoot });
    console.log(JSON.stringify(summarizeBehavioralEvidenceBundle(bundle)));
    return;
  }
  if (command === "refresh") {
    console.log(JSON.stringify(await refreshBehavioralEvidenceSources({ bundleRoot })));
    return;
  }
  if (command === "project") {
    const result = await buildBehavioralEvidenceSite({ bundleRoot });
    console.log(JSON.stringify({ projects: result.bundle.projects.length, projection: "generated" }));
    return;
  }
  if (command === "prepare-sync") {
    const result = await prepareBehavioralEvidenceSyncPlan({ bundleRoot });
    console.log(JSON.stringify(result.plan.summary));
    return;
  }
  throw new Error("Use status, refresh, project, or prepare-sync.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main().catch((error) => {
    console.error(`Behavioral evidence command failed: ${error instanceof Error ? error.message : "unexpected failure"}`);
    process.exitCode = 1;
  });
}
