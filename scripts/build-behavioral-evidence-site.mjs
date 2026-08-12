import { constants as fsConstants } from "node:fs";
import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CLAIM_STATUSES = new Set(["unverified", "partial", "verified", "contradicted"]);
const CLAIM_STRENGTHS = new Set([
  "project_fact",
  "personal_contribution_candidate",
  "user_confirmation_required",
  "unsupported",
  "contradicted",
]);
const EVIDENCE_GRADES = new Set(["E0", "E1", "E2", "E3"]);
const ATTRIBUTION_GRADES = new Set(["A0", "A1", "A2", "A3"]);
const CANDIDATE_STATES = new Set(["pending", "accepted", "rejected", "superseded"]);
const VISIBILITIES = new Set(["local_only", "owner_private", "publication_safe"]);
const SOURCE_REFRESH_MODES = new Set(["filesystem", "remote", "conversation", "blocked"]);
const MAX_ASSET_COPY_CONCURRENCY = 8;
const REMOTE_UNSAFE_PATTERNS = [
  { label: "home-relative path", pattern: /(?:^|[\s"'(])~[\\/]/m },
  { label: "relative filesystem path", pattern: /(?:^|[\s"'(])\.{1,2}[\\/][^\s"']+/m },
  { label: "absolute filesystem path", pattern: /(?:^|[^A-Za-z0-9])\/(?!\/)[^\s"'<>]+/m },
  { label: "absolute Windows path", pattern: /\b[A-Za-z]:\\[^\s"']+/m },
  { label: "network filesystem path", pattern: /(?:^|[\s"'(])\\\\[^\\\s]+\\[^\s"']+/m },
  { label: "repository-relative private locator", pattern: /(?:^|[\s"'(])(?:private-sources|sources?|documents?|repos?(?:itories)?|projects?|docs?|src|app|packages?)[\\/][^\s"']+/im },
  { label: "file-like private locator", pattern: /\b[A-Z0-9._-]+(?:[\\/][A-Z0-9._-]+)+\.(?:json|md|txt|pdf|docx?|ya?ml|toml|swift|tsx?|jsx?|mjs|cjs|java|py|go|rs)\b/i },
  { label: "email address", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { label: "SSH Git remote", pattern: /\bgit@[A-Za-z0-9.-]+:/i },
  { label: "SSH URL", pattern: /\bssh:\/\//i },
  { label: "file URL", pattern: /\bfile:\/\//i },
  { label: "web URL", pattern: /\bhttps?:\/\//i },
  { label: "private key material", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: "bearer credential", pattern: /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/i },
  { label: "service credential", pattern: /\b(?:github_pat_|gh[pousr]_|sk-(?:proj-)?|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/i },
  { label: "cloud access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "social-security identifier", pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
];

function fail(location, message) {
  throw new Error(`${location}: ${message}`);
}

function requireObject(value, location) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(location, "expected an object");
  }
}

function requireArray(value, location) {
  if (!Array.isArray(value)) fail(location, "expected an array");
}

function requireString(value, location) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(location, "expected a non-empty string");
  }
}

function requireStableId(value, location) {
  requireString(value, location);
  if (!STABLE_ID.test(value)) fail(location, `invalid stable ID: ${value}`);
}

function requireEnum(value, allowed, location) {
  if (!allowed.has(value)) {
    fail(location, `expected one of ${[...allowed].join(", ")}; received ${String(value)}`);
  }
}

function requireRelativePath(value, location) {
  requireString(value, location);
  if (path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) {
    fail(location, "must be a bundle-relative path without parent traversal");
  }
}

function uniqueIndex(records, location, globalIds = null) {
  requireArray(records, location);
  const index = new Map();
  for (const [position, record] of records.entries()) {
    requireObject(record, `${location}[${position}]`);
    requireStableId(record.id, `${location}[${position}].id`);
    if (index.has(record.id)) fail(location, `duplicate ID ${record.id}`);
    if (globalIds?.has(record.id)) fail(location, `ID ${record.id} is duplicated in another record family`);
    index.set(record.id, record);
    globalIds?.add(record.id);
  }
  return index;
}

function requireKnownIds(ids, index, location) {
  requireArray(ids, location);
  const seen = new Set();
  for (const [position, id] of ids.entries()) {
    requireStableId(id, `${location}[${position}]`);
    if (seen.has(id)) fail(location, `duplicate reference ${id}`);
    if (!index.has(id)) fail(location, `unknown reference ${id}`);
    seen.add(id);
  }
}

async function readJson(filePath, location) {
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    fail(location, `cannot read the declared JSON file (${error?.code ?? "read failure"})`);
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    fail(location, `invalid JSON: ${error.message}`);
  }
}

export function assertRemoteSafe(value, location = "remote candidate") {
  const serialized = JSON.stringify(value);
  for (const unsafe of REMOTE_UNSAFE_PATTERNS) {
    if (unsafe.pattern.test(serialized)) fail(location, `contains ${unsafe.label}`);
  }
}

async function requireReadableAsset(filePath, location) {
  await access(filePath, fsConstants.R_OK).catch(() => fail(location, "cannot access the declared asset"));
}

async function validateProjectMetadata(record, descriptor, recordPath, bundleRoot) {
  const location = `project ${descriptor.id}`;
  requireObject(record, location);
  if (record.schemaVersion !== 1) fail(`${location}.schemaVersion`, "expected 1");
  requireObject(record.project, `${location}.project`);
  requireStableId(record.project.id, `${location}.project.id`);
  if (record.project.id !== descriptor.id) {
    fail(`${location}.project.id`, `must match manifest ID ${descriptor.id}`);
  }
  for (const key of ["title", "organization", "summary", "evidenceBoundary", "inspectedAt"]) {
    requireString(record.project[key], `${location}.project.${key}`);
  }
  if (record.project.visibility !== "local_only") {
    fail(`${location}.project.visibility`, "the canonical project record must remain local_only");
  }
  requireRelativePath(record.project.dossierPath, `${location}.project.dossierPath`);

  const recordDirectory = path.dirname(recordPath);
  const dossierPath = path.resolve(recordDirectory, record.project.dossierPath);
  if (!dossierPath.startsWith(`${path.resolve(bundleRoot)}${path.sep}`)) {
    fail(`${location}.project.dossierPath`, "resolves outside the bundle");
  }
  const dossier = await readFile(dossierPath, "utf8").catch(() => {
    fail(`${location}.project.dossierPath`, "cannot read the declared dossier");
  });
  return { location, recordDirectory, dossier };
}

function indexProjectRecords(record, location) {
  const globalIds = new Set();
  const sources = uniqueIndex(record.sources, `${location}.sources`, globalIds);
  const evidence = uniqueIndex(record.evidence, `${location}.evidence`, globalIds);
  const claims = uniqueIndex(record.claims, `${location}.claims`, globalIds);
  const contradictions = uniqueIndex(record.contradictions, `${location}.contradictions`, globalIds);
  const storySeeds = uniqueIndex(record.storySeeds, `${location}.storySeeds`, globalIds);
  const curriculum = uniqueIndex(record.curriculum, `${location}.curriculum`, globalIds);
  const diagrams = uniqueIndex(record.diagrams, `${location}.diagrams`, globalIds);
  uniqueIndex(record.sanitization, `${location}.sanitization`, globalIds);
  const d1Candidates = uniqueIndex(record.d1Candidates, `${location}.d1Candidates`, globalIds);
  const d1Exclusions = uniqueIndex(record.d1Exclusions, `${location}.d1Exclusions`, globalIds);
  const publicationCandidates = uniqueIndex(record.publicationCandidates, `${location}.publicationCandidates`, globalIds);
  return { sources, evidence, claims, contradictions, storySeeds, curriculum, diagrams, d1Candidates, d1Exclusions, publicationCandidates };
}

function validateSources(sources, location) {
  for (const [id, source] of sources) {
    for (const key of ["kind", "label", "locator", "refreshMode", "safeHint", "authorization", "sensitivity", "availability"]) {
      requireString(source[key], `${location}.sources.${id}.${key}`);
    }
    requireEnum(source.refreshMode, SOURCE_REFRESH_MODES, `${location}.sources.${id}.refreshMode`);
    if (source.refreshMode === "filesystem" && !path.isAbsolute(source.locator)) {
      fail(`${location}.sources.${id}.locator`, "filesystem refresh requires one absolute canonical source root or exact file");
    }
    if (source.refreshMode === "remote" && !/^[a-z][a-z0-9+.-]*:/i.test(source.locator)) {
      fail(`${location}.sources.${id}.locator`, "remote refresh metadata requires an explicit non-filesystem URI");
    }
    if (source.refreshMode === "remote" && /^file:/i.test(source.locator)) {
      fail(`${location}.sources.${id}.locator`, "remote refresh metadata cannot use a file URI");
    }
    if (source.refreshMode === "conversation" && !/^conversation:/i.test(source.locator)) {
      fail(`${location}.sources.${id}.locator`, "conversation provenance requires a conversation: locator");
    }
    if (source.visibility !== "local_only") {
      fail(`${location}.sources.${id}.visibility`, "source locators must remain local_only");
    }
    requireArray(source.canSupport, `${location}.sources.${id}.canSupport`);
    requireArray(source.cannotSupport, `${location}.sources.${id}.cannotSupport`);
    if (source.refreshStatus !== undefined) {
      requireEnum(source.refreshStatus, new Set(["current", "changed", "unavailable", "not_checked", "blocked"]), `${location}.sources.${id}.refreshStatus`);
    }
  }
}

function validateEvidence(evidence, sources, location) {
  for (const [id, item] of evidence) {
    requireString(item.origin, `${location}.evidence.${id}.origin`);
    requireString(item.statement, `${location}.evidence.${id}.statement`);
    requireKnownIds(item.sourceIds, sources, `${location}.evidence.${id}.sourceIds`);
    requireEnum(item.evidenceGrade, EVIDENCE_GRADES, `${location}.evidence.${id}.evidenceGrade`);
    requireEnum(item.attributionGrade, ATTRIBUTION_GRADES, `${location}.evidence.${id}.attributionGrade`);
    requireEnum(item.claimStrength, CLAIM_STRENGTHS, `${location}.evidence.${id}.claimStrength`);
    requireEnum(item.candidateState, CANDIDATE_STATES, `${location}.evidence.${id}.candidateState`);
    requireEnum(item.visibility, VISIBILITIES, `${location}.evidence.${id}.visibility`);
    requireArray(item.safeLocators, `${location}.evidence.${id}.safeLocators`);
    requireArray(item.supports, `${location}.evidence.${id}.supports`);
    requireArray(item.limitations, `${location}.evidence.${id}.limitations`);
    requireKnownIds(item.contraryEvidenceIds ?? [], evidence, `${location}.evidence.${id}.contraryEvidenceIds`);
  }
}

function validateClaims(claims, evidence, location) {
  for (const [id, claim] of claims) {
    requireString(claim.text, `${location}.claims.${id}.text`);
    requireEnum(claim.status, CLAIM_STATUSES, `${location}.claims.${id}.status`);
    requireEnum(claim.claimStrength, CLAIM_STRENGTHS, `${location}.claims.${id}.claimStrength`);
    requireEnum(claim.evidenceGrade, EVIDENCE_GRADES, `${location}.claims.${id}.evidenceGrade`);
    requireEnum(claim.attributionGrade, ATTRIBUTION_GRADES, `${location}.claims.${id}.attributionGrade`);
    requireKnownIds(claim.evidenceIds, evidence, `${location}.claims.${id}.evidenceIds`);
    requireKnownIds(claim.contraryEvidenceIds, evidence, `${location}.claims.${id}.contraryEvidenceIds`);
    requireArray(claim.gaps, `${location}.claims.${id}.gaps`);
    requireEnum(claim.visibility, VISIBILITIES, `${location}.claims.${id}.visibility`);
    if (claim.status === "verified") {
      const accepted = claim.evidenceIds.map((evidenceId) => evidence.get(evidenceId)).filter((item) => item.candidateState === "accepted");
      if (accepted.length === 0) fail(`${location}.claims.${id}`, "verified claims require accepted evidence");
      if (claim.claimStrength === "project_fact" && !accepted.some((item) => item.evidenceGrade === "E3")) {
        fail(`${location}.claims.${id}`, "verified project facts require accepted E3 evidence");
      }
      if (claim.scope === "personal_contribution" && claim.attributionGrade !== "A3") {
        fail(`${location}.claims.${id}`, "verified personal contributions require A3 attribution");
      }
    }
  }
}

function validateContradictions(contradictions, evidence, location) {
  for (const [id, contradiction] of contradictions) {
    requireString(contradiction.summary, `${location}.contradictions.${id}.summary`);
    requireKnownIds(contradiction.evidenceIds, evidence, `${location}.contradictions.${id}.evidenceIds`);
    requireString(contradiction.resolutionQuestion, `${location}.contradictions.${id}.resolutionQuestion`);
  }
}

function validateStorySeeds(storySeeds, evidence, location) {
  for (const [id, story] of storySeeds) {
    requireString(story.title, `${location}.storySeeds.${id}.title`);
    requireKnownIds(story.evidenceIds, evidence, `${location}.storySeeds.${id}.evidenceIds`);
    requireEnum(story.evidenceGrade, EVIDENCE_GRADES, `${location}.storySeeds.${id}.evidenceGrade`);
    requireEnum(story.attributionGrade, ATTRIBUTION_GRADES, `${location}.storySeeds.${id}.attributionGrade`);
    for (const key of ["situationFacts", "taskFacts", "actionFacts", "resultFacts", "learningFacts", "missingFields", "tags"]) {
      requireArray(story[key], `${location}.storySeeds.${id}.${key}`);
    }
  }
}

function validateCurriculum(curriculum, evidence, location) {
  for (const [id, item] of curriculum) {
    requireString(item.title, `${location}.curriculum.${id}.title`);
    requireString(item.objective, `${location}.curriculum.${id}.objective`);
    requireKnownIds(item.evidenceIds, evidence, `${location}.curriculum.${id}.evidenceIds`);
    requireArray(item.questions, `${location}.curriculum.${id}.questions`);
  }
}

async function validateDiagramAssets(diagrams, evidence, recordDirectory, location) {
  const diagramAssets = [];
  for (const [id, diagram] of diagrams) {
    requireString(diagram.title, `${location}.diagrams.${id}.title`);
    requireRelativePath(diagram.sourcePath, `${location}.diagrams.${id}.sourcePath`);
    requireKnownIds(diagram.evidenceIds, evidence, `${location}.diagrams.${id}.evidenceIds`);
    requireArray(diagram.limitations, `${location}.diagrams.${id}.limitations`);
    requireEnum(diagram.visibility, VISIBILITIES, `${location}.diagrams.${id}.visibility`);
    const sourcePath = path.resolve(recordDirectory, diagram.sourcePath);
    await requireReadableAsset(sourcePath, `${location}.diagrams.${id}.sourcePath`);
    let renderedPath = null;
    if (diagram.renderedPath) {
      requireRelativePath(diagram.renderedPath, `${location}.diagrams.${id}.renderedPath`);
      renderedPath = path.resolve(recordDirectory, diagram.renderedPath);
      await requireReadableAsset(renderedPath, `${location}.diagrams.${id}.renderedPath`);
    }
    diagramAssets.push({ id, sourcePath, renderedPath });
  }
  return diagramAssets;
}

function validateCandidates(d1Candidates, d1Exclusions, publicationCandidates, evidence, location) {
  const dispositions = new Map();
  for (const [id, candidate] of d1Candidates) {
    if (candidate.visibility !== "owner_private") fail(`${location}.d1Candidates.${id}.visibility`, "must be owner_private");
    requireKnownIds(candidate.sourceEvidenceIds, evidence, `${location}.d1Candidates.${id}.sourceEvidenceIds`);
    if (candidate.kind !== "evidence") fail(`${location}.d1Candidates.${id}.kind`, "only typed evidence ingestion is currently supported");
    if (candidate.sourceEvidenceIds.length !== 1) fail(`${location}.d1Candidates.${id}.sourceEvidenceIds`, "an evidence candidate must project exactly one canonical evidence record");
    const sourceEvidence = evidence.get(candidate.sourceEvidenceIds[0]);
    if (sourceEvidence.candidateState !== "pending") fail(`${location}.d1Candidates.${id}`, "new remote evidence must remain pending until explicit owner review");
    if (dispositions.has(sourceEvidence.id)) fail(`${location}.d1Candidates.${id}`, `evidence ${sourceEvidence.id} already has a D1 disposition`);
    dispositions.set(sourceEvidence.id, "candidate");
    requireObject(candidate.content, `${location}.d1Candidates.${id}.content`);
    requireArray(candidate.content.questionLinks, `${location}.d1Candidates.${id}.content.questionLinks`);
    if (candidate.content.questionLinks.length === 0) fail(`${location}.d1Candidates.${id}.content.questionLinks`, "at least one question link is required");
    const seenQuestions = new Set();
    for (const [position, link] of candidate.content.questionLinks.entries()) {
      requireObject(link, `${location}.d1Candidates.${id}.content.questionLinks[${position}]`);
      requireStableId(link.questionId, `${location}.d1Candidates.${id}.content.questionLinks[${position}].questionId`);
      requireEnum(link.relevance, new Set(["supporting", "contrary"]), `${location}.d1Candidates.${id}.content.questionLinks[${position}].relevance`);
      if (seenQuestions.has(link.questionId)) fail(`${location}.d1Candidates.${id}.content.questionLinks`, `duplicate question ${link.questionId}`);
      seenQuestions.add(link.questionId);
    }
    assertRemoteSafe(candidate, `${location}.d1Candidates.${id}`);
  }
  for (const [id, exclusion] of d1Exclusions) {
    requireStableId(exclusion.sourceEvidenceId, `${location}.d1Exclusions.${id}.sourceEvidenceId`);
    const sourceEvidence = evidence.get(exclusion.sourceEvidenceId);
    if (!sourceEvidence) fail(`${location}.d1Exclusions.${id}.sourceEvidenceId`, `unknown reference ${exclusion.sourceEvidenceId}`);
    if (sourceEvidence.candidateState !== "pending") fail(`${location}.d1Exclusions.${id}`, "only pending evidence may have a local-only sync exclusion");
    if (exclusion.disposition !== "local_only") fail(`${location}.d1Exclusions.${id}.disposition`, "must be local_only");
    requireString(exclusion.reason, `${location}.d1Exclusions.${id}.reason`);
    if (dispositions.has(sourceEvidence.id)) fail(`${location}.d1Exclusions.${id}`, `evidence ${sourceEvidence.id} already has a D1 disposition`);
    dispositions.set(sourceEvidence.id, "exclusion");
  }
  for (const [id, candidate] of publicationCandidates) {
    if (candidate.visibility !== "publication_safe") fail(`${location}.publicationCandidates.${id}.visibility`, "must be publication_safe");
    requireKnownIds(candidate.sourceEvidenceIds, evidence, `${location}.publicationCandidates.${id}.sourceEvidenceIds`);
    if (candidate.approval?.status !== "approved" || candidate.approval.approvedBy !== "owner" || !candidate.approval.approvedAt) {
      fail(`${location}.publicationCandidates.${id}.approval`, "publication_safe requires explicit owner approval");
    }
    assertRemoteSafe(candidate, `${location}.publicationCandidates.${id}`);
  }
}

async function validateProject(record, descriptor, recordPath, bundleRoot) {
  const { location, recordDirectory, dossier } = await validateProjectMetadata(
    record,
    descriptor,
    recordPath,
    bundleRoot,
  );
  const indexes = indexProjectRecords(record, location);
  validateSources(indexes.sources, location);
  validateEvidence(indexes.evidence, indexes.sources, location);
  validateClaims(indexes.claims, indexes.evidence, location);
  validateContradictions(indexes.contradictions, indexes.evidence, location);
  validateStorySeeds(indexes.storySeeds, indexes.evidence, location);
  validateCurriculum(indexes.curriculum, indexes.evidence, location);
  const diagramAssets = await validateDiagramAssets(
    indexes.diagrams,
    indexes.evidence,
    recordDirectory,
    location,
  );
  validateCandidates(indexes.d1Candidates, indexes.d1Exclusions, indexes.publicationCandidates, indexes.evidence, location);

  return {
    descriptor,
    record,
    recordPath,
    recordDirectory,
    dossier,
    indexes: {
      sources: indexes.sources,
      evidence: indexes.evidence,
      claims: indexes.claims,
      contradictions: indexes.contradictions,
      storySeeds: indexes.storySeeds,
      curriculum: indexes.curriculum,
      diagrams: indexes.diagrams,
    },
    diagramAssets,
  };
}

export async function validateBehavioralEvidenceBundle({ bundleRoot }) {
  const resolvedRoot = path.resolve(bundleRoot);
  const manifestPath = path.join(resolvedRoot, "manifest.json");
  const manifest = await readJson(manifestPath, "manifest");
  requireObject(manifest, "manifest");
  if (manifest.schemaVersion !== 1) fail("manifest.schemaVersion", "expected 1");
  requireStableId(manifest.bundleId, "manifest.bundleId");
  requireString(manifest.title, "manifest.title");
  if (manifest.visibility !== "local_only") fail("manifest.visibility", "must remain local_only");
  requireString(manifest.createdAt, "manifest.createdAt");
  requireString(manifest.updatedAt, "manifest.updatedAt");
  requireArray(manifest.projects, "manifest.projects");
  if (manifest.projects.length === 0) fail("manifest.projects", "must contain at least one project");

  const seenProjects = new Set();
  const projects = [];
  for (const [position, descriptor] of manifest.projects.entries()) {
    requireObject(descriptor, `manifest.projects[${position}]`);
    requireStableId(descriptor.id, `manifest.projects[${position}].id`);
    requireRelativePath(descriptor.recordPath, `manifest.projects[${position}].recordPath`);
    if (seenProjects.has(descriptor.id)) fail("manifest.projects", `duplicate project ID ${descriptor.id}`);
    seenProjects.add(descriptor.id);
    const recordPath = path.resolve(resolvedRoot, descriptor.recordPath);
    if (!recordPath.startsWith(`${resolvedRoot}${path.sep}`)) {
      fail(`manifest.projects[${position}].recordPath`, "resolves outside the bundle");
    }
    const record = await readJson(recordPath, `project ${descriptor.id}`);
    projects.push(await validateProject(record, descriptor, recordPath, resolvedRoot));
  }
  return { bundleRoot: resolvedRoot, manifest, projects };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function markdownToHtml(source) {
  const components = {
    table({ node, children, ...props }) {
      void node;
      return createElement(
        "div",
        { className: "table-scroll", role: "region", "aria-label": "Scrollable table", tabIndex: 0 },
        createElement("table", props, children),
      );
    },
    pre({ node, children, ...props }) {
      void node;
      return createElement(
        "div",
        { className: "code-scroll", role: "region", "aria-label": "Scrollable code", tabIndex: 0 },
        createElement("pre", props, children),
      );
    },
  };
  return renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfm], components }, source));
}

function renderPills(values) {
  if (!values?.length) return "";
  return `<div class="pill-row">${values.map((value) => `<span class="pill">${escapeHtml(value)}</span>`).join("")}</div>`;
}

function renderTextList(values, empty = "No recorded items.") {
  if (!values?.length) return `<p class="empty">${escapeHtml(empty)}</p>`;
  return `<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`;
}

function renderEvidence(project) {
  return project.record.evidence.map((item) => `
    <article class="record evidence-record searchable" id="${escapeHtml(item.id)}" data-search="${escapeHtml(`${item.id} ${item.statement} ${(item.tags ?? []).join(" ")}`.toLowerCase())}">
      <div class="record-kicker"><code>${escapeHtml(item.id)}</code><span>${escapeHtml(item.origin.replaceAll("_", " "))}</span></div>
      <h4>${escapeHtml(item.statement)}</h4>
      <div class="grade-line"><span class="grade">${escapeHtml(item.evidenceGrade)}</span><span class="grade">${escapeHtml(item.attributionGrade)}</span><span class="strength strength-${escapeHtml(item.claimStrength)}">${escapeHtml(item.claimStrength.replaceAll("_", " "))}</span><span class="state">${escapeHtml(item.candidateState)}</span></div>
      <details><summary>What it supports and cannot prove</summary><div class="detail-grid"><div><h5>Supports</h5>${renderTextList(item.supports)}</div><div><h5>Limitations</h5>${renderTextList(item.limitations)}</div></div></details>
      ${renderPills(item.safeLocators)}
    </article>`).join("");
}

function renderClaims(project) {
  return project.record.claims.map((claim) => `
    <article class="record claim-record searchable status-${escapeHtml(claim.status)}" id="${escapeHtml(claim.id)}" data-claim-status="${escapeHtml(claim.status)}" data-search="${escapeHtml(`${claim.id} ${claim.text} ${claim.scope} ${claim.status} ${(claim.tags ?? []).join(" ")}`.toLowerCase())}">
      <div class="record-kicker"><code>${escapeHtml(claim.id)}</code><span>${escapeHtml(claim.scope.replaceAll("_", " "))}</span></div>
      <h4>${escapeHtml(claim.text)}</h4>
      <div class="grade-line"><span class="status-badge">${escapeHtml(claim.status)}</span><span class="grade">${escapeHtml(claim.evidenceGrade)}</span><span class="grade">${escapeHtml(claim.attributionGrade)}</span></div>
      <p class="support-links"><strong>Evidence:</strong> ${claim.evidenceIds.map((id) => `<a href="#${escapeHtml(id)}">${escapeHtml(id)}</a>`).join(", ") || "none"}</p>
      ${claim.saferWording ? `<p class="safer"><strong>Truthful pending wording</strong><br>${escapeHtml(claim.saferWording)}</p>` : ""}
      <details><summary>Open proof gaps</summary>${renderTextList(claim.gaps, "No recorded gaps.")}</details>
    </article>`).join("");
}

function renderContradictions(project) {
  return project.record.contradictions.map((item) => `
    <article class="contradiction searchable" id="${escapeHtml(item.id)}" data-search="${escapeHtml(`${item.id} ${item.summary} ${item.resolutionQuestion}`.toLowerCase())}">
      <div class="record-kicker"><code>${escapeHtml(item.id)}</code><span class="priority">${escapeHtml(item.priority)}</span><span>${escapeHtml(item.status)}</span></div>
      <h4>${escapeHtml(item.summary)}</h4>
      <p><strong>Resolve by asking:</strong> ${escapeHtml(item.resolutionQuestion)}</p>
      <p class="support-links"><strong>Evidence:</strong> ${item.evidenceIds.map((id) => `<a href="#${escapeHtml(id)}">${escapeHtml(id)}</a>`).join(", ")}</p>
    </article>`).join("");
}

function renderStories(project) {
  return project.record.storySeeds.map((story) => `
    <article class="story searchable" id="${escapeHtml(story.id)}" data-search="${escapeHtml(`${story.id} ${story.title} ${story.tags.join(" ")}`.toLowerCase())}">
      <div class="record-kicker"><code>${escapeHtml(story.id)}</code><span>${escapeHtml(story.status.replaceAll("_", " "))}</span></div>
      <h4>${escapeHtml(story.title)}</h4>
      <div class="starl-grid">
        <div><h5>Situation</h5>${renderTextList(story.situationFacts)}</div>
        <div><h5>Task</h5>${renderTextList(story.taskFacts)}</div>
        <div><h5>Actions</h5>${renderTextList(story.actionFacts)}</div>
        <div><h5>Result</h5>${renderTextList(story.resultFacts, "Not yet verified.")}</div>
        <div><h5>Learning</h5>${renderTextList(story.learningFacts, "Not yet established.")}</div>
      </div>
      <details><summary>Missing before synthesis</summary>${renderTextList(story.missingFields)}</details>
      ${renderPills(story.tags)}
    </article>`).join("");
}

function renderCurriculum(project) {
  return project.record.curriculum
    .toSorted((left, right) => left.priority - right.priority)
    .map((item) => `
      <li class="curriculum-item searchable" data-search="${escapeHtml(`${item.title} ${item.objective} ${item.questions.join(" ")}`.toLowerCase())}">
        <span class="curriculum-index">${String(item.priority).padStart(2, "0")}</span>
        <div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.objective)}</p><details><summary>Grilling questions</summary>${renderTextList(item.questions)}</details></div>
        <span class="state">${escapeHtml(item.status.replaceAll("_", " "))}</span>
      </li>`).join("");
}

function renderDiagrams(project, copiedAssets) {
  if (!project.record.diagrams.length) {
    return `<p class="empty">No runtime architecture was claimed. This dossier uses evidence-provenance views only where supported.</p>`;
  }
  return project.record.diagrams.map((diagram) => {
    const asset = copiedAssets.get(`${project.record.project.id}:${diagram.id}`);
    return `<figure class="diagram searchable" id="${escapeHtml(diagram.id)}" data-search="${escapeHtml(`${diagram.title} ${diagram.kind}`.toLowerCase())}">
      <figcaption><span>${escapeHtml(diagram.kind.replaceAll("_", " "))}</span><h4>${escapeHtml(diagram.title)}</h4><p>${escapeHtml(diagram.relationshipBasis.replaceAll("_", " "))}</p></figcaption>
      ${asset?.rendered ? `<a class="diagram-frame" href="${escapeHtml(asset.rendered)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(asset.rendered)}" alt="${escapeHtml(diagram.title)}"></a>` : `<pre><code>Source retained as ${escapeHtml(diagram.sourceFormat)}; no exported image is available yet.</code></pre>`}
      <div class="diagram-actions"><a href="${escapeHtml(asset.source)}" download>Editable source</a><span>Evidence: ${diagram.evidenceIds.map((id) => `<a href="#${escapeHtml(id)}">${escapeHtml(id)}</a>`).join(", ")}</span></div>
      <details><summary>Diagram limitations</summary>${renderTextList(diagram.limitations)}</details>
    </figure>`;
  }).join("");
}

function renderProject(project, copiedAssets) {
  const info = project.record.project;
  const counts = {
    sources: project.record.sources.length,
    evidence: project.record.evidence.length,
    claims: project.record.claims.length,
    gaps: project.record.contradictions.length,
  };
  return `<article class="project-dossier" id="project-${escapeHtml(info.id)}">
    <header class="project-header">
      <div><p class="eyebrow">${escapeHtml(info.organization)} · ${escapeHtml(info.relationship.replaceAll("_", " "))}</p><h2>${escapeHtml(info.title)}</h2><p class="project-summary">${escapeHtml(info.summary)}</p></div>
      <div class="review-stamp"><span>Review state</span><strong>${escapeHtml(info.reviewState.replaceAll("_", " "))}</strong><small>${escapeHtml(info.sourceRevision ?? "source revision recorded in dossier")}</small></div>
    </header>
    <div class="ledger-strip" aria-label="Project record counts">
      ${Object.entries(counts).map(([label, value]) => `<span><strong>${value}</strong>${escapeHtml(label)}</span>`).join("")}
    </div>
    <aside class="evidence-boundary"><strong>Evidence boundary</strong><p>${escapeHtml(info.evidenceBoundary)}</p></aside>
    <section><div class="section-heading"><p>01 / Traceability</p><h3>Claims under review</h3></div><div class="record-grid">${renderClaims(project)}</div></section>
    <section><div class="section-heading"><p>02 / Source record</p><h3>Evidence ledger</h3></div><div class="record-grid evidence-grid">${renderEvidence(project)}</div></section>
    <section><div class="section-heading"><p>03 / System understanding</p><h3>Architecture and evidence maps</h3></div><div class="diagram-grid">${renderDiagrams(project, copiedAssets)}</div></section>
    <section><div class="section-heading"><p>04 / Conflict register</p><h3>Contradictions and open proof</h3></div><div class="contradiction-grid">${renderContradictions(project)}</div></section>
    <section><div class="section-heading"><p>05 / Rehearsal material</p><h3>Fact-only story seeds</h3></div><div class="story-grid">${renderStories(project)}</div></section>
    <section><div class="section-heading"><p>06 / Learning order</p><h3>Private curriculum</h3></div><ol class="curriculum">${renderCurriculum(project)}</ol></section>
    <section><details class="full-dossier"><summary>Open complete archaeology dossier</summary><div class="markdown-body">${markdownToHtml(project.dossier)}</div></details></section>
  </article>`;
}

function buildHtml(bundle, copiedAssets) {
  const totalEvidence = bundle.projects.reduce((sum, project) => sum + project.record.evidence.length, 0);
  const totalClaims = bundle.projects.reduce((sum, project) => sum + project.record.claims.length, 0);
  const totalContradictions = bundle.projects.reduce((sum, project) => sum + project.record.contradictions.length, 0);
  const nav = bundle.projects.map((project) => `<a href="#project-${escapeHtml(project.record.project.id)}"><span>${escapeHtml(project.record.project.organization)}</span>${escapeHtml(project.record.project.title)}</a>`).join("");
  const projects = bundle.projects.map((project) => renderProject(project, copiedAssets)).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(bundle.manifest.title)}</title>
  <style>
    :root{--ink:#101526;--slate:#27324a;--paper:#eef4fa;--white:#fbfdff;--line:#b9c8d8;--blue:#2864dc;--blue-soft:#dce8ff;--amber:#d88b16;--amber-soft:#fff0cf;--teal:#157a69;--teal-soft:#d9f1eb;--red:#a84444;--red-soft:#f8dddd;--shadow:0 20px 60px rgba(16,21,38,.12);--display:"Avenir Next Condensed","Arial Narrow",sans-serif;--body:Charter,"Iowan Old Style",Georgia,serif;--utility:ui-monospace,"SFMono-Regular",Menlo,monospace}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:linear-gradient(90deg,var(--ink) 0 18px,var(--paper) 18px);color:var(--ink);font-family:var(--body);line-height:1.55}a{color:var(--blue);text-underline-offset:3px}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible,.table-scroll:focus-visible,.code-scroll:focus-visible{outline:3px solid var(--amber);outline-offset:3px}code,.eyebrow,.record-kicker,.grade-line,.pill,.state,.priority,.section-heading p,.review-stamp,.ledger-strip,.site-nav,.filter-bar,.diagram-actions,.curriculum-index{font-family:var(--utility)}.visually-hidden{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
    .shell{max-width:1680px;margin:auto;padding:40px 40px 96px 58px}.privacy-banner{display:flex;gap:12px;align-items:center;border:1px solid var(--line);background:rgba(251,253,255,.84);padding:11px 16px;font-family:var(--utility);font-size:12px}.privacy-banner strong{color:var(--teal)}
    .hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(270px,420px);gap:64px;padding:74px 0 48px;border-bottom:1px solid var(--slate)}.hero h1{font-family:var(--display);font-size:clamp(54px,7vw,116px);font-weight:700;letter-spacing:-.045em;line-height:.82;max-width:1000px;margin:12px 0 28px}.hero h1 em{display:block;color:var(--blue);font-style:normal}.hero-copy{font-size:20px;max-width:720px}.hero-ledger{border-left:6px solid var(--blue);padding:12px 0 12px 24px;align-self:end}.hero-ledger p{margin:0 0 12px}.hero-ledger dl{display:grid;grid-template-columns:1fr auto;gap:8px 24px;margin:0;font-family:var(--utility);font-size:12px}.hero-ledger dd{font-weight:700}
    .toolbar{position:sticky;top:0;z-index:20;display:grid;grid-template-columns:minmax(260px,1fr) auto;gap:20px;background:rgba(238,244,250,.94);backdrop-filter:blur(14px);border-bottom:1px solid var(--line);padding:16px 0}.filter-bar{display:flex;gap:10px}.filter-bar input,.filter-bar select{min-height:42px;border:1px solid var(--slate);background:var(--white);padding:9px 12px;color:var(--ink);font:inherit}.filter-bar input{flex:1}.site-nav{display:flex;gap:6px;overflow:auto}.site-nav a{display:flex;flex-direction:column;min-width:150px;padding:8px 12px;border:1px solid var(--line);background:var(--white);text-decoration:none;color:var(--ink);font-size:12px}.site-nav a span{color:var(--blue);font-size:10px;text-transform:uppercase;letter-spacing:.08em}
    .project-dossier{padding:70px 0;border-bottom:3px solid var(--ink);min-width:0;max-width:100%;overflow-x:clip}.project-header{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:48px;align-items:end}.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:12px;color:var(--blue)}.project-header h2{font-family:var(--display);font-size:clamp(48px,6vw,88px);line-height:.9;letter-spacing:-.035em;margin:8px 0}.project-summary{font-size:20px;max-width:900px}.review-stamp{border:2px solid var(--ink);box-shadow:8px 8px 0 var(--blue-soft);padding:18px;transform:rotate(-1deg)}.review-stamp span,.review-stamp small{display:block;font-size:11px;overflow-wrap:anywhere}.review-stamp strong{display:block;font-family:var(--display);font-size:25px;line-height:1.05;margin:8px 0;text-transform:uppercase}
    .ledger-strip{display:flex;gap:32px;margin:42px 0 18px;padding:14px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:11px;text-transform:uppercase}.ledger-strip span{display:flex;gap:7px;align-items:baseline}.ledger-strip strong{font-family:var(--display);font-size:25px;color:var(--blue)}.evidence-boundary{border-left:6px solid var(--amber);background:var(--amber-soft);padding:15px 20px;margin:0 0 54px}.evidence-boundary p{margin:3px 0}
    section{margin:68px 0}.section-heading{display:grid;grid-template-columns:180px 1fr;gap:24px;border-top:1px solid var(--slate);padding-top:14px;margin-bottom:22px}.section-heading p{font-size:11px;color:var(--blue);text-transform:uppercase}.section-heading h3{font-family:var(--display);font-size:36px;letter-spacing:-.02em;margin:0}.record-grid,.contradiction-grid,.story-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.record,.contradiction,.story,.diagram{background:var(--white);border:1px solid var(--line);padding:22px;box-shadow:0 8px 25px rgba(16,21,38,.05)}.record h4,.contradiction h4,.story h4,.diagram h4{font-family:var(--display);font-size:24px;line-height:1.05;margin:10px 0 16px}.record-kicker{display:flex;gap:10px;align-items:center;font-size:10px;text-transform:uppercase;letter-spacing:.07em}.record-kicker code{color:var(--blue);font-weight:700}.record-kicker span+span{margin-left:auto}.grade-line{display:flex;flex-wrap:wrap;gap:7px;margin:15px 0;font-size:10px;text-transform:uppercase}.grade,.state,.status-badge,.strength,.priority{border:1px solid var(--line);padding:4px 7px;background:var(--paper)}.status-verified{border-left:5px solid var(--teal)}.status-partial{border-left:5px solid var(--amber)}.status-contradicted{border-left:5px solid var(--red)}.status-unverified{border-left:5px solid var(--slate)}.strength-unsupported,.strength-contradicted{background:var(--red-soft);color:var(--red)}.safer{border-left:4px solid var(--teal);background:var(--teal-soft);padding:12px}.support-links{font-size:14px}.detail-grid,.starl-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.starl-grid>div{border-top:2px solid var(--blue-soft)}h5{font-family:var(--utility);font-size:11px;text-transform:uppercase;letter-spacing:.06em}.pill-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}.pill{font-size:9px;background:var(--blue-soft);padding:4px 7px}.empty{font-style:italic;color:#657087}summary{cursor:pointer;font-family:var(--utility);font-size:11px;color:var(--blue);margin:12px 0}
    .contradiction{background:linear-gradient(135deg,var(--white),var(--amber-soft));border-top:4px solid var(--amber)}.story{border-top:4px solid var(--teal)}.diagram-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.diagram{margin:0}.diagram figcaption span{font-family:var(--utility);font-size:10px;text-transform:uppercase;color:var(--blue)}.diagram figcaption p{font-family:var(--utility);font-size:10px}.diagram-frame{display:block;background:#fff;border:1px solid var(--line);overflow:auto}.diagram img{display:block;width:100%;height:auto;min-height:240px;object-fit:contain}.diagram-actions{display:flex;justify-content:space-between;gap:12px;font-size:10px;margin-top:10px}.curriculum{list-style:none;padding:0;margin:0;border-top:1px solid var(--line)}.curriculum-item{display:grid;grid-template-columns:58px 1fr auto;gap:18px;padding:20px 0;border-bottom:1px solid var(--line)}.curriculum-index{font-size:26px;color:var(--blue)}.curriculum-item h4{font-family:var(--display);font-size:24px;margin:0}.curriculum-item p{margin:4px 0}.full-dossier{width:100%;background:var(--white);border:2px solid var(--ink);padding:20px;min-width:0;max-width:100%;overflow:hidden;contain:inline-size}.full-dossier>summary{font-family:var(--display);font-size:28px;color:var(--ink)}.markdown-body{width:100%;max-width:980px;min-width:0;margin:28px auto}.markdown-body h1,.markdown-body h2,.markdown-body h3{font-family:var(--display);line-height:1}.table-scroll,.code-scroll{display:block;width:100%;max-width:100%;min-width:0;overflow-x:auto;contain:inline-size}.markdown-body table{width:max-content;min-width:100%;border-collapse:collapse}.markdown-body th,.markdown-body td{border:1px solid var(--line);padding:8px;text-align:left}.markdown-body pre{width:max-content;min-width:100%;margin:0;background:var(--ink);color:#e9f0ff;padding:16px}.is-hidden{display:none!important}.no-results{display:none;margin:40px 0;padding:20px;border:2px dashed var(--amber);background:var(--amber-soft)}.no-results.visible{display:block}
    @media(max-width:980px){.shell{padding:22px 20px 70px 38px}.hero,.project-header{grid-template-columns:1fr}.toolbar{position:relative;grid-template-columns:1fr}.filter-bar{flex-wrap:wrap}.filter-bar input{flex-basis:100%}.record-grid,.contradiction-grid,.story-grid,.diagram-grid{grid-template-columns:1fr}.section-heading{grid-template-columns:1fr}.site-nav{padding-bottom:4px}.review-stamp{max-width:360px}.ledger-strip{flex-wrap:wrap}}
    @media(max-width:600px){body{background:linear-gradient(90deg,var(--ink) 0 9px,var(--paper) 9px)}.shell{padding-left:22px}.hero{padding-top:46px;gap:28px}.hero h1{font-size:50px}.hero-copy,.project-summary{font-size:17px}.site-nav a{min-width:132px}.ledger-strip{gap:12px}.detail-grid,.starl-grid{grid-template-columns:1fr}.curriculum-item{grid-template-columns:42px 1fr}.curriculum-item>.state{grid-column:2}.diagram-actions{flex-direction:column}.record,.story,.contradiction,.diagram{padding:17px}}
    @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important;animation:none!important}.review-stamp{transform:none}}
    @media print{body{background:#fff}.toolbar,.privacy-banner{position:static}.site-nav,.filter-bar{display:none}.project-dossier{break-before:page}.record,.story,.contradiction,.diagram{box-shadow:none}}
  </style>
</head>
<body>
  <main class="shell">
    <div class="privacy-banner"><strong>LOCAL PRIVATE PROJECTION</strong><span>Generated from an ignored evidence bundle. Not synced to D1. Not published.</span></div>
    <header class="hero">
      <div><p class="eyebrow">Behavioral foundation · evidence before rehearsal</p><h1>Every claim has to <em>survive the evidence.</em></h1><p class="hero-copy">A revisable field guide to what the projects prove, what they only suggest, and what must still be confirmed before it becomes a résumé bullet or interview answer.</p></div>
      <aside class="hero-ledger"><p><strong>${escapeHtml(bundle.manifest.title)}</strong></p><dl><dt>Projects</dt><dd>${bundle.projects.length}</dd><dt>Evidence records</dt><dd>${totalEvidence}</dd><dt>Claims</dt><dd>${totalClaims}</dd><dt>Open contradictions</dt><dd>${totalContradictions}</dd><dt>Canonical source</dt><dd>Ignored JSON bundle</dd></dl></aside>
    </header>
    <div class="toolbar">
      <div class="filter-bar"><label class="visually-hidden" for="evidence-search">Search evidence</label><input id="evidence-search" type="search" placeholder="Search claims, evidence IDs, stories, or concepts"><label class="visually-hidden" for="claim-status">Claim status</label><select id="claim-status"><option value="all">All claim states</option><option value="unverified">Unverified</option><option value="partial">Partial</option><option value="verified">Verified</option><option value="contradicted">Contradicted</option></select></div>
      <nav class="site-nav" aria-label="Project dossiers">${nav}</nav>
    </div>
    <p class="no-results" id="no-results">No records match the current evidence filter.</p>
    ${projects}
  </main>
  <script>
    const search = document.querySelector('#evidence-search');
    const status = document.querySelector('#claim-status');
    const records = [...document.querySelectorAll('.searchable')];
    const noResults = document.querySelector('#no-results');
    function applyFilters(){
      const query = search.value.trim().toLowerCase();
      const wantedStatus = status.value;
      let visible = 0;
      for(const record of records){
        const textMatch = !query || (record.dataset.search || record.textContent.toLowerCase()).includes(query);
        const claimStatus = record.dataset.claimStatus;
        const statusMatch = wantedStatus === 'all' || !claimStatus || claimStatus === wantedStatus;
        const show = textMatch && statusMatch;
        record.classList.toggle('is-hidden', !show);
        if(show) visible += 1;
      }
      noResults.classList.toggle('visible', visible === 0);
    }
    search.addEventListener('input', applyFilters);
    status.addEventListener('change', applyFilters);
  </script>
</body>
</html>`;
}

async function copyDiagramAssets(bundle, assetsRoot) {
  const copiedAssets = new Map();
  const copyPlans = [];
  for (const project of bundle.projects) {
    for (const asset of project.diagramAssets) {
      const prefix = `${project.record.project.id}-${asset.id}`;
      const sourceName = `${prefix}${path.extname(asset.sourcePath)}`;
      copyPlans.push({ from: asset.sourcePath, to: path.join(assetsRoot, sourceName) });
      let renderedName = null;
      if (asset.renderedPath) {
        renderedName = `${prefix}${path.extname(asset.renderedPath)}`;
        copyPlans.push({ from: asset.renderedPath, to: path.join(assetsRoot, renderedName) });
      }
      copiedAssets.set(`${project.record.project.id}:${asset.id}`, {
        source: `assets/${sourceName}`,
        rendered: renderedName ? `assets/${renderedName}` : null,
      });
    }
  }
  for (let start = 0; start < copyPlans.length; start += MAX_ASSET_COPY_CONCURRENCY) {
    const batch = copyPlans.slice(start, start + MAX_ASSET_COPY_CONCURRENCY);
    await Promise.all(batch.map((plan) => copyFile(plan.from, plan.to)));
  }
  return copiedAssets;
}

export async function buildBehavioralEvidenceSite({ bundleRoot, outputRoot = null }) {
  const bundle = await validateBehavioralEvidenceBundle({ bundleRoot });
  const siteRoot = outputRoot ? path.resolve(outputRoot) : path.join(bundle.bundleRoot, "site");
  const assetsRoot = path.join(siteRoot, "assets");
  await rm(assetsRoot, { recursive: true, force: true });
  await mkdir(assetsRoot, { recursive: true });
  const copiedAssets = await copyDiagramAssets(bundle, assetsRoot);
  const html = buildHtml(bundle, copiedAssets);
  await writeFile(path.join(siteRoot, "index.html"), html, "utf8");
  return { bundle, siteRoot, indexPath: path.join(siteRoot, "index.html"), html };
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const repositoryRoot = new URL("../", import.meta.url);
  const defaultBundle = fileURLToPath(new URL("private-sources/behavioral-foundation", repositoryRoot));
  const bundleRoot = argumentValue("--bundle") ?? defaultBundle;
  if (process.argv.includes("--validate-only")) {
    const result = await validateBehavioralEvidenceBundle({ bundleRoot });
    console.log(`Behavioral evidence bundle is valid (${result.projects.length} projects).`);
    return;
  }
  const result = await buildBehavioralEvidenceSite({ bundleRoot, outputRoot: argumentValue("--output") });
  console.log(`Behavioral evidence review generated (${result.bundle.projects.length} projects).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main().catch((error) => {
    console.error(`Behavioral evidence command failed: ${error instanceof Error ? error.message : "unexpected failure"}`);
    process.exitCode = 1;
  });
}
