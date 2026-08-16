import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export type EngineeringRecordType =
  | "change-note"
  | "adr"
  | "architecture-review"
  | "feature-retrospective"
  | "postmortem"
  | "capability-dossier";

export type EngineeringRecordStatus = "proposed" | "accepted" | "released" | "closed";

export type EngineeringRecordEffectiveStatus = EngineeringRecordStatus | "amended" | "superseded";

export type EngineeringPullRequestClassification = "none" | EngineeringRecordType;

export type EngineeringRecordSourceReference = {
  label: string;
  url: string;
  kind: "issue" | "pull-request" | "commit" | "release" | "run" | "documentation";
};

export type EngineeringRecordVerification = {
  state: "verified" | "not-recorded";
  evidenceRefs: string[];
};

export type TrustedJournalRepository = {
  repository: string;
  owner: string;
  canonicalPath: string;
  receiptPath?: string;
  commit?: string;
};

export type EngineeringJournalDocument = {
  repository: string;
  trustedCommit?: string;
  commit: string;
  path: string;
  markdown: string;
};

export type EngineeringPullRequestReceiptDocument = EngineeringJournalDocument & {
  committedAt: string;
};

export type EngineeringJournalBuildInput = {
  trustedRepositories: TrustedJournalRepository[];
  documents: EngineeringJournalDocument[];
  receiptDocuments?: EngineeringPullRequestReceiptDocument[];
};

export type EngineeringRecordSource = {
  repository: string;
  commit: string;
  path: string;
  permalink: string;
};

export type EngineeringRecordSection = {
  id: string;
  title: string;
  body: string;
};

export type EngineeringRecordDiagram = {
  title: string;
  sourcePath: string;
  renderedPath: string;
  summary: string;
  evidenceRefs: string[];
  sourcePermalink: string;
  renderedPermalink: string;
  renderedUrl: string;
};

export type EngineeringPullRequestReceipt = {
  schemaVersion: 1;
  ref: string;
  repository: string;
  pr: number;
  originalPullRequestUrl: string;
  title: string;
  summary: string;
  classification: EngineeringPullRequestClassification;
  richRecordRefs: string[];
  reconstructed: boolean;
  confidence: "verified" | "high" | "medium" | "low" | "unknown";
  unknowns: string[];
  headCommit: string | null;
  mergeCommit: string | null;
  mergedAt: string | null;
  timelineAt: string;
  timelineBasis: "verified-merge" | "source-commit";
  timelineCommit: string;
  timelineCommitBasis: "verified-merge" | "source-commit";
  missingFacts: Array<"head-commit" | "merge-commit" | "merged-at">;
  sources: EngineeringRecordSourceReference[];
  verification: EngineeringRecordVerification;
  visibility: "public-safe";
  publicationEligibility: "eligible";
  source: EngineeringRecordSource & { committedAt: string };
};

export type EngineeringJournalRecord = {
  schemaVersion: 1;
  id: string;
  revision: number;
  ref: string;
  type: EngineeringRecordType;
  status: EngineeringRecordStatus;
  effectiveStatus: EngineeringRecordEffectiveStatus;
  amendedBy: string[];
  supersededBy: string[];
  title: string;
  summary: string;
  repository: string;
  capabilityIds: string[];
  createdAt: string;
  reconstructed: boolean;
  confidence: "verified" | "high" | "medium" | "low" | "unknown";
  unknowns: string[];
  modules: string[];
  interfaces: string[];
  seams: string[];
  adapters: string[];
  relatedRecords: string[];
  decisions: string[];
  incidents: string[];
  features: string[];
  capabilities: string[];
  amends: string[];
  supersedes: string[];
  learningRefs: string[];
  diagrams: EngineeringRecordDiagram[];
  sources: EngineeringRecordSourceReference[];
  verification: EngineeringRecordVerification;
  visibility: "public-safe" | "owner-private";
  publicationEligibility: "eligible" | "ineligible";
  issue: number | null;
  pr: number | null;
  release: string | null;
  run: string | null;
  source: EngineeringRecordSource;
  body: string;
  sections: EngineeringRecordSection[];
  interviewView: EngineeringRecordSection | null;
};

export type EngineeringJournalStatistics = {
  totalRecords: number;
  earliestCreatedAt: string | null;
  latestCreatedAt: string | null;
  byType: Record<EngineeringRecordType, number>;
  byStatus: Record<EngineeringRecordEffectiveStatus, number>;
  byRepository: Record<string, number>;
  byCapability: Record<string, number>;
  verification: { verified: number; notRecorded: number };
  recordsWithReleaseRefs: number;
  recordsWithRunRefs: number;
  chronology: Array<{
    ref: string;
    createdAt: string;
    type: EngineeringRecordType;
    status: EngineeringRecordEffectiveStatus;
    repository: string;
  }>;
};

export type EngineeringPullRequestReceiptStatistics = {
  totalReceipts: number;
  earliestTimelineAt: string | null;
  latestTimelineAt: string | null;
  byRepository: Record<string, number>;
  byClassification: Record<EngineeringPullRequestClassification, number>;
  reconstructed: number;
  withMissingFacts: number;
  chronology: Array<{
    ref: string;
    pr: number;
    originalPullRequestUrl: string;
    timelineAt: string;
    timelineBasis: EngineeringPullRequestReceipt["timelineBasis"];
    repository: string;
    classification: EngineeringPullRequestClassification;
  }>;
};

export type EngineeringJournalIndex = {
  schemaVersion: 1;
  records: EngineeringJournalRecord[];
  pullRequestReceipts: EngineeringPullRequestReceipt[];
  search: Array<{
    id: string;
    ref: string;
    revision: number;
    createdAt: string;
    text: string;
    repository: string;
    type: EngineeringRecordType;
    status: EngineeringRecordStatus;
    effectiveStatus: EngineeringJournalRecord["effectiveStatus"];
    capabilityIds: string[];
  }>;
  receiptSearch: Array<{
    ref: string;
    pr: number;
    timelineAt: string;
    text: string;
    repository: string;
    classification: EngineeringPullRequestClassification;
    richRecordRefs: string[];
  }>;
  backlinks: Record<string, string[]>;
  receiptBacklinks: Record<string, string[]>;
  statistics: EngineeringJournalStatistics;
  receiptStatistics: EngineeringPullRequestReceiptStatistics;
};

export type EngineeringJournalBuild = {
  index: EngineeringJournalIndex;
  normalizedJson: string;
  standaloneHtml: string;
};

export class EngineeringJournalError extends Error {
  readonly code: string;
  readonly source: string;

  constructor(code: string, source: string) {
    super(`Engineering Journal rejected ${source} (${code}).`);
    this.name = "EngineeringJournalError";
    this.code = code;
    this.source = source;
  }
}

const RECORD_TYPES = new Set<EngineeringRecordType>([
  "change-note",
  "adr",
  "architecture-review",
  "feature-retrospective",
  "postmortem",
  "capability-dossier",
]);
const RECORD_STATUSES = new Set<EngineeringRecordStatus>(["proposed", "accepted", "released", "closed"]);
const RECEIPT_CLASSIFICATIONS = new Set<EngineeringPullRequestClassification>(["none", ...RECORD_TYPES]);
const CONFIDENCE = new Set(["verified", "high", "medium", "low", "unknown"]);
const FRONTMATTER_FIELDS = new Set([
  "schemaVersion",
  "id",
  "revision",
  "type",
  "status",
  "title",
  "repository",
  "capabilityIds",
  "createdAt",
  "reconstructed",
  "confidence",
  "unknowns",
  "modules",
  "interfaces",
  "seams",
  "adapters",
  "relatedRecords",
  "decisions",
  "incidents",
  "features",
  "capabilities",
  "amends",
  "supersedes",
  "learningRefs",
  "diagrams",
  "sources",
  "verification",
  "visibility",
  "publicationEligibility",
  "issue",
  "pr",
  "release",
  "run",
]);
const RECEIPT_FRONTMATTER_FIELDS = new Set([
  "schemaVersion",
  "repository",
  "pr",
  "title",
  "classification",
  "richRecordRefs",
  "reconstructed",
  "confidence",
  "unknowns",
  "headCommit",
  "mergeCommit",
  "mergedAt",
  "sources",
  "verification",
  "visibility",
  "publicationEligibility",
]);
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+$/;
const RECORD_REF_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*@[1-9]\d*$/;
const UTC_SECOND_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const PORTABLE_ASSET_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/;
const TYPE_STATUSES: Record<EngineeringRecordType, ReadonlySet<EngineeringRecordStatus>> = {
  "change-note": new Set(["released"]),
  adr: new Set(["proposed", "accepted"]),
  "architecture-review": new Set(["proposed", "accepted", "closed"]),
  "feature-retrospective": new Set(["released"]),
  postmortem: new Set(["closed"]),
  "capability-dossier": new Set(["accepted", "released"]),
};
const PRIVATE_CONTENT_PATTERNS = [
  /(?:^|[\s("'`])\/(?:Users|home|root)\/[^\s)"'`]+/m,
  /(?:^|[\s("'`])\/(?:private\/tmp|tmp|var|opt|srv|workspace|mnt|Volumes)\/[^\s)"'`]+/m,
  /(?:^|[\s("'`])~\/[^\s)"'`]+/m,
  /\b[A-Za-z]:\\[^\s"'`]+/,
  /\\\\[^\s\\]+\\[^\s"'`]+/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:password|access[_-]?token|api[_-]?key|client[_-]?secret)\s*[:=]\s*[^\s]{8,}/i,
  /\b(?:thread|task)_[A-Za-z0-9_-]{8,}\b/,
  /\bgit@[A-Za-z0-9.-]+:[^\s]+/,
  /https?:\/\/[^\s/@:]+:[^\s/@]+@[^\s/]+/,
  /\b[A-Z0-9._%+-]+@(?!example\.com\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
];

function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (!value || /^['|>&*!]/.test(value)) throw new Error("unsupported frontmatter scalar");
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value.startsWith('"') || value.startsWith("[") || value.startsWith("{")) {
    return JSON.parse(value);
  }
  return value;
}

function parseDocument(markdown: string, source: string) {
  const normalized = markdown.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) throw new EngineeringJournalError("frontmatter_missing", source);
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) throw new EngineeringJournalError("frontmatter_unclosed", source);

  const frontmatter: Record<string, unknown> = {};
  for (const line of normalized.slice(4, end).split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator < 1) throw new EngineeringJournalError("frontmatter_invalid", source);
    const key = line.slice(0, separator).trim();
    if (Object.hasOwn(frontmatter, key)) throw new EngineeringJournalError("frontmatter_duplicate_key", source);
    try {
      frontmatter[key] = parseScalar(line.slice(separator + 1));
    } catch {
      throw new EngineeringJournalError("frontmatter_invalid_value", source);
    }
  }

  const authoredBody = normalized.slice(end + 5).trim();
  if (!authoredBody) throw new EngineeringJournalError("body_missing", source);
  const titleMatch = authoredBody.match(/^#\s+(.+)$/m);
  if (!titleMatch || titleMatch.index !== 0) throw new EngineeringJournalError("document_title_missing", source);
  if ((authoredBody.match(/^#\s+/gm) ?? []).length !== 1) {
    throw new EngineeringJournalError("document_title_duplicate", source);
  }
  const documentTitle = titleMatch[1].trim();
  const body = authoredBody.slice(titleMatch[0].length).trim();
  if (!body) throw new EngineeringJournalError("body_missing", source);
  const sections: EngineeringRecordSection[] = [];
  const headings = [...body.matchAll(/^##\s+(.+)$/gm)];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const title = heading[1].trim();
    const start = (heading.index ?? 0) + heading[0].length;
    const finish = headings[index + 1]?.index ?? body.length;
    sections.push({ id: slug(title), title, body: body.slice(start, finish).trim() });
  }
  if (new Set(sections.map((section) => section.id)).size !== sections.length) {
    throw new EngineeringJournalError("section_id_duplicate", source);
  }
  const summary = body.slice(0, headings[0]?.index ?? body.length).trim();
  if (!summary) throw new EngineeringJournalError("summary_missing", source);
  const interviewSections = sections.filter((section) => section.id === "interview-view");
  if (interviewSections.length > 1) throw new EngineeringJournalError("interview_view_duplicate", source);
  const interviewHeadingIndex = headings.findIndex((heading) => slug(heading[1].trim()) === "interview-view");
  const readerBody = interviewHeadingIndex === -1
    ? body
    : `${body.slice(0, headings[interviewHeadingIndex].index).trim()}\n\n${body.slice(headings[interviewHeadingIndex + 1]?.index ?? body.length).trim()}`.trim();
  return {
    frontmatter,
    documentTitle,
    summary,
    body: readerBody,
    sections: sections.filter((section) => section.id !== "interview-view"),
    interviewView: interviewSections[0] ?? null,
  };
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function stringValue(frontmatter: Record<string, unknown>, key: string, source: string) {
  const value = frontmatter[key];
  if (typeof value !== "string" || !value.trim()) throw new EngineeringJournalError(`field_${key}_invalid`, source);
  return value.trim();
}

function stringArray(
  frontmatter: Record<string, unknown>,
  key: string,
  source: string,
  limits?: { maxItems?: number; maxLength?: number },
) {
  const value = frontmatter[key];
  if (!Array.isArray(value) || (limits?.maxItems !== undefined && value.length > limits.maxItems) ||
    value.some((item) => typeof item !== "string" || !item.trim() ||
      (limits?.maxLength !== undefined && item.trim().length > limits.maxLength))) {
    throw new EngineeringJournalError(`field_${key}_invalid`, source);
  }
  return value.map((item) => String(item).trim());
}

function nullableNumber(frontmatter: Record<string, unknown>, key: string, source: string) {
  const value = frontmatter[key];
  if (value === null) return null;
  if (!Number.isInteger(value) || Number(value) <= 0) throw new EngineeringJournalError(`field_${key}_invalid`, source);
  return Number(value);
}

function nullableString(frontmatter: Record<string, unknown>, key: string, source: string) {
  const value = frontmatter[key];
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) throw new EngineeringJournalError(`field_${key}_invalid`, source);
  return value.trim();
}

function nullableCommit(frontmatter: Record<string, unknown>, key: string, source: string) {
  const value = nullableString(frontmatter, key, source);
  if (value !== null && !COMMIT_PATTERN.test(value)) {
    throw new EngineeringJournalError(`field_${key}_invalid`, source);
  }
  return value;
}

function nullableTimestamp(frontmatter: Record<string, unknown>, key: string, source: string) {
  const value = nullableString(frontmatter, key, source);
  if (value !== null && !validUtcSecondTimestamp(value)) {
    throw new EngineeringJournalError(`field_${key}_invalid`, source);
  }
  return value;
}

function validUtcSecondTimestamp(value: string) {
  if (!UTC_SECOND_TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().replace(".000Z", "Z") === value;
}

function sourceReferences(
  frontmatter: Record<string, unknown>,
  source: string,
  repository?: TrustedJournalRepository,
  sourceCommit?: string,
  limits?: { maxItems?: number; labelMaxLength?: number; urlMaxLength?: number },
): EngineeringRecordSourceReference[] {
  const value = frontmatter.sources;
  if (!Array.isArray(value) || value.length === 0 ||
    (limits?.maxItems !== undefined && value.length > limits.maxItems)) {
    throw new EngineeringJournalError("field_sources_invalid", source);
  }
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new EngineeringJournalError("field_sources_invalid", source);
    }
    const entry = item as Record<string, unknown>;
    if (Object.keys(entry).some((key) => !["label", "url", "kind"].includes(key))) {
      throw new EngineeringJournalError("field_sources_invalid", source);
    }
    if (typeof entry.label !== "string" || !entry.label.trim() ||
      (limits?.labelMaxLength !== undefined && entry.label.trim().length > limits.labelMaxLength)) {
      throw new EngineeringJournalError("field_sources_invalid", source);
    }
    if (typeof entry.url !== "string" || !/^https:\/\/[^\s]+$/.test(entry.url) ||
      (limits?.urlMaxLength !== undefined && entry.url.length > limits.urlMaxLength)) {
      throw new EngineeringJournalError("field_sources_invalid", source);
    }
    if (!["issue", "pull-request", "commit", "release", "run", "documentation"].includes(String(entry.kind))) {
      throw new EngineeringJournalError("field_sources_invalid", source);
    }
    let url = entry.url;
    if (entry.kind === "documentation") {
      if (!repository || !sourceCommit || !COMMIT_PATTERN.test(sourceCommit)) {
        throw new EngineeringJournalError("field_sources_invalid", source);
      }
      const prefix = `https://github.com/${repository.owner}/${repository.repository}/blob/`;
      if (!url.startsWith(prefix)) throw new EngineeringJournalError("field_sources_invalid", source);
      const relative = url.slice(prefix.length);
      const slash = relative.indexOf("/");
      const revision = slash < 0 ? "" : relative.slice(0, slash);
      const path = slash < 0 ? "" : relative.slice(slash + 1);
      if (!path || path.startsWith("/") || path.includes("..")) {
        throw new EngineeringJournalError("field_sources_invalid", source);
      }
      if (revision === "main") url = `${prefix}${sourceCommit}/${path}`;
      else if (!COMMIT_PATTERN.test(revision)) throw new EngineeringJournalError("field_sources_invalid", source);
    }
    return {
      label: entry.label.trim(),
      url,
      kind: entry.kind as EngineeringRecordSourceReference["kind"],
    };
  });
}

function diagramReferences(
  frontmatter: Record<string, unknown>,
  source: string,
  repository: TrustedJournalRepository,
  commit: string,
  verificationEvidence: ReadonlySet<string>,
): EngineeringRecordDiagram[] {
  const value = frontmatter.diagrams ?? [];
  if (!Array.isArray(value)) throw new EngineeringJournalError("field_diagrams_invalid", source);
  const paths = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new EngineeringJournalError("field_diagrams_invalid", source);
    }
    const entry = item as Record<string, unknown>;
    const allowed = ["title", "sourcePath", "renderedPath", "summary", "evidenceRefs"];
    if (Object.keys(entry).some((key) => !allowed.includes(key))) {
      throw new EngineeringJournalError("field_diagrams_invalid", source);
    }
    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    const summary = typeof entry.summary === "string" ? entry.summary.trim() : "";
    const sourcePath = typeof entry.sourcePath === "string" ? entry.sourcePath.trim() : "";
    const renderedPath = typeof entry.renderedPath === "string" ? entry.renderedPath.trim() : "";
    const evidenceRefs = Array.isArray(entry.evidenceRefs)
      ? entry.evidenceRefs.map((ref) => typeof ref === "string" ? ref.trim() : "")
      : [];
    if (!title || title.length > 160 || !summary || summary.length > 280 ||
      !PORTABLE_ASSET_PATH_PATTERN.test(sourcePath) || !pathWithin(sourcePath, "docs/design") || !sourcePath.endsWith(".drawio") ||
      !PORTABLE_ASSET_PATH_PATTERN.test(renderedPath) || !pathWithin(renderedPath, "docs/design") || !/\.(?:png|svg)$/.test(renderedPath) ||
      sourcePath === renderedPath || evidenceRefs.length === 0 || evidenceRefs.some((ref) => !ref) ||
      new Set(evidenceRefs).size !== evidenceRefs.length || evidenceRefs.some((ref) => !verificationEvidence.has(ref))) {
      throw new EngineeringJournalError("field_diagrams_invalid", source);
    }
    if (paths.has(sourcePath) || paths.has(renderedPath)) {
      throw new EngineeringJournalError("diagram_path_duplicate", source);
    }
    paths.add(sourcePath);
    paths.add(renderedPath);
    return {
      title,
      sourcePath,
      renderedPath,
      summary,
      evidenceRefs,
      sourcePermalink: sourcePermalink(repository, commit, sourcePath),
      renderedPermalink: sourcePermalink(repository, commit, renderedPath),
      renderedUrl: bundledDiagramUrl(repository.repository, commit, renderedPath),
    };
  });
}

function verification(
  frontmatter: Record<string, unknown>,
  source: string,
  evidenceLimits?: { maxItems?: number; maxLength?: number },
): EngineeringRecordVerification {
  const value = frontmatter.verification;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EngineeringJournalError("field_verification_invalid", source);
  }
  const entry = value as Record<string, unknown>;
  if (Object.keys(entry).some((key) => !["state", "evidenceRefs"].includes(key))) {
    throw new EngineeringJournalError("field_verification_invalid", source);
  }
  if (entry.state !== "verified" && entry.state !== "not-recorded") {
    throw new EngineeringJournalError("field_verification_invalid", source);
  }
  if (!Array.isArray(entry.evidenceRefs) ||
    (evidenceLimits?.maxItems !== undefined && entry.evidenceRefs.length > evidenceLimits.maxItems) ||
    entry.evidenceRefs.some((ref) => typeof ref !== "string" || !ref.trim() ||
      (evidenceLimits?.maxLength !== undefined && ref.trim().length > evidenceLimits.maxLength))) {
    throw new EngineeringJournalError("field_verification_invalid", source);
  }
  if (entry.state === "verified" && entry.evidenceRefs.length === 0) {
    throw new EngineeringJournalError("verification_evidence_missing", source);
  }
  return { state: entry.state, evidenceRefs: entry.evidenceRefs.map((ref) => String(ref).trim()) };
}

function pathWithin(path: string, canonicalPath: string) {
  return path.startsWith(`${canonicalPath.replace(/\/$/, "")}/`) && !path.split("/").includes("..") && !path.startsWith("/");
}

function sourcePermalink(repository: TrustedJournalRepository, commit: string, path: string) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${repository.owner}/${repository.repository}/blob/${commit}/${encodedPath}`;
}

function bundledDiagramUrl(repository: string, commit: string, path: string) {
  const encodedPath = [repository, commit, ...path.split("/")].map(encodeURIComponent).join("/");
  return `/engineering-journal/assets/${encodedPath}`;
}

function normalizeDocument(
  document: EngineeringJournalDocument,
  repositories: Map<string, TrustedJournalRepository>,
  safeSource: string,
): EngineeringJournalRecord {
  const trusted = repositories.get(document.repository);
  if (!trusted) throw new EngineeringJournalError("repository_untrusted", safeSource);
  if (!COMMIT_PATTERN.test(document.commit)) throw new EngineeringJournalError("commit_invalid", safeSource);
  if (trusted.commit && trusted.commit !== document.trustedCommit) {
    throw new EngineeringJournalError("commit_pin_mismatch", safeSource);
  }
  if (!trusted.commit && document.trustedCommit) throw new EngineeringJournalError("commit_pin_mismatch", safeSource);
  if (document.trustedCommit && !COMMIT_PATTERN.test(document.trustedCommit)) {
    throw new EngineeringJournalError("commit_pin_mismatch", safeSource);
  }
  if (!pathWithin(document.path, trusted.canonicalPath) || !document.path.endsWith(".md")) {
    throw new EngineeringJournalError("source_path_untrusted", safeSource);
  }
  if ([document.repository, document.path, document.commit, document.markdown].some((value) =>
    PRIVATE_CONTENT_PATTERNS.some((pattern) => pattern.test(value)))) {
    throw new EngineeringJournalError("privacy_violation", safeSource);
  }

  const { frontmatter, documentTitle, summary, body, sections, interviewView } = parseDocument(document.markdown, safeSource);
  if (Object.keys(frontmatter).some((key) => !FRONTMATTER_FIELDS.has(key))) {
    throw new EngineeringJournalError("frontmatter_unknown_field", safeSource);
  }
  if (frontmatter.schemaVersion !== 1) throw new EngineeringJournalError("schema_version_unsupported", safeSource);
  const id = stringValue(frontmatter, "id", safeSource);
  if (!ID_PATTERN.test(id)) throw new EngineeringJournalError("field_id_invalid", safeSource);
  const revision = nullableNumber(frontmatter, "revision", safeSource);
  if (revision === null) throw new EngineeringJournalError("field_revision_invalid", safeSource);
  const type = stringValue(frontmatter, "type", safeSource) as EngineeringRecordType;
  if (!RECORD_TYPES.has(type)) throw new EngineeringJournalError("field_type_invalid", safeSource);
  const status = stringValue(frontmatter, "status", safeSource) as EngineeringRecordStatus;
  if (!RECORD_STATUSES.has(status)) throw new EngineeringJournalError("field_status_invalid", safeSource);
  if (!TYPE_STATUSES[type].has(status)) throw new EngineeringJournalError("type_status_invalid", safeSource);
  const repository = stringValue(frontmatter, "repository", safeSource);
  if (repository !== document.repository) throw new EngineeringJournalError("repository_mismatch", safeSource);
  const createdAt = stringValue(frontmatter, "createdAt", safeSource);
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z)?$/.test(createdAt)) {
    throw new EngineeringJournalError("field_createdAt_invalid", safeSource);
  }
  if (typeof frontmatter.reconstructed !== "boolean") {
    throw new EngineeringJournalError("field_reconstructed_invalid", safeSource);
  }
  const confidence = stringValue(frontmatter, "confidence", safeSource) as EngineeringJournalRecord["confidence"];
  if (!CONFIDENCE.has(confidence)) throw new EngineeringJournalError("field_confidence_invalid", safeSource);
  const visibility = stringValue(frontmatter, "visibility", safeSource) as EngineeringJournalRecord["visibility"];
  if (visibility !== "public-safe" && visibility !== "owner-private") {
    throw new EngineeringJournalError("field_visibility_invalid", safeSource);
  }
  const publicationEligibility = stringValue(frontmatter, "publicationEligibility", safeSource) as EngineeringJournalRecord["publicationEligibility"];
  if (publicationEligibility !== "eligible" && publicationEligibility !== "ineligible") {
    throw new EngineeringJournalError("field_publicationEligibility_invalid", safeSource);
  }
  if (visibility === "owner-private" && publicationEligibility === "eligible") {
    throw new EngineeringJournalError("owner_private_publication", safeSource);
  }
  const learningRefs = stringArray(frontmatter, "learningRefs", safeSource);
  if (learningRefs.length > 0) throw new EngineeringJournalError("learn_contract_unreleased", safeSource);
  const title = stringValue(frontmatter, "title", safeSource);
  if (title !== documentTitle) throw new EngineeringJournalError("document_title_mismatch", safeSource);
  const recordVerification = verification(frontmatter, safeSource);

  return {
    schemaVersion: 1,
    id,
    revision,
    ref: `${id}@${revision}`,
    type,
    status,
    effectiveStatus: status,
    amendedBy: [],
    supersededBy: [],
    title,
    summary,
    repository,
    capabilityIds: stringArray(frontmatter, "capabilityIds", safeSource),
    createdAt,
    reconstructed: frontmatter.reconstructed,
    confidence,
    unknowns: stringArray(frontmatter, "unknowns", safeSource),
    modules: stringArray(frontmatter, "modules", safeSource),
    interfaces: stringArray(frontmatter, "interfaces", safeSource),
    seams: stringArray(frontmatter, "seams", safeSource),
    adapters: stringArray(frontmatter, "adapters", safeSource),
    relatedRecords: stringArray(frontmatter, "relatedRecords", safeSource),
    decisions: stringArray(frontmatter, "decisions", safeSource),
    incidents: stringArray(frontmatter, "incidents", safeSource),
    features: stringArray(frontmatter, "features", safeSource),
    capabilities: stringArray(frontmatter, "capabilities", safeSource),
    amends: stringArray(frontmatter, "amends", safeSource),
    supersedes: stringArray(frontmatter, "supersedes", safeSource),
    learningRefs,
    diagrams: diagramReferences(
      frontmatter,
      safeSource,
      trusted,
      document.commit,
      new Set(recordVerification.evidenceRefs),
    ),
    sources: sourceReferences(frontmatter, safeSource, trusted, document.commit),
    verification: recordVerification,
    visibility,
    publicationEligibility,
    issue: nullableNumber(frontmatter, "issue", safeSource),
    pr: nullableNumber(frontmatter, "pr", safeSource),
    release: nullableString(frontmatter, "release", safeSource),
    run: nullableString(frontmatter, "run", safeSource),
    source: {
      repository: document.repository,
      commit: document.commit,
      path: document.path,
      permalink: sourcePermalink(trusted, document.commit, document.path),
    },
    body,
    sections,
    interviewView,
  };
}

function normalizeReceipt(
  document: EngineeringPullRequestReceiptDocument,
  repositories: Map<string, TrustedJournalRepository>,
  safeSource: string,
): EngineeringPullRequestReceipt {
  const trusted = repositories.get(document.repository);
  if (!trusted) throw new EngineeringJournalError("repository_untrusted", safeSource);
  if (!COMMIT_PATTERN.test(document.commit)) throw new EngineeringJournalError("commit_invalid", safeSource);
  if (trusted.commit && trusted.commit !== document.trustedCommit) {
    throw new EngineeringJournalError("commit_pin_mismatch", safeSource);
  }
  if (!trusted.commit && document.trustedCommit) throw new EngineeringJournalError("commit_pin_mismatch", safeSource);
  if (document.trustedCommit && !COMMIT_PATTERN.test(document.trustedCommit)) {
    throw new EngineeringJournalError("commit_pin_mismatch", safeSource);
  }
  if (!trusted.receiptPath || !pathWithin(document.path, trusted.receiptPath) || !document.path.endsWith(".md")) {
    throw new EngineeringJournalError("receipt_source_path_untrusted", safeSource);
  }
  if (!validUtcSecondTimestamp(document.committedAt)) {
    throw new EngineeringJournalError("source_committedAt_invalid", safeSource);
  }
  if ([document.repository, document.path, document.commit, document.committedAt, document.markdown].some((value) =>
    PRIVATE_CONTENT_PATTERNS.some((pattern) => pattern.test(value)))) {
    throw new EngineeringJournalError("privacy_violation", safeSource);
  }

  const parsed = parseDocument(document.markdown, safeSource);
  const { frontmatter, documentTitle, summary, sections, body } = parsed;
  if (Object.keys(frontmatter).some((key) => !RECEIPT_FRONTMATTER_FIELDS.has(key))) {
    throw new EngineeringJournalError("receipt_frontmatter_unknown_field", safeSource);
  }
  if (frontmatter.schemaVersion !== 1) throw new EngineeringJournalError("receipt_schema_version_unsupported", safeSource);
  const repository = stringValue(frontmatter, "repository", safeSource);
  if (repository !== document.repository) throw new EngineeringJournalError("repository_mismatch", safeSource);
  const pr = nullableNumber(frontmatter, "pr", safeSource);
  if (pr === null) throw new EngineeringJournalError("field_pr_invalid", safeSource);
  if (document.path !== `${trusted.receiptPath.replace(/\/$/, "")}/pr-${pr}.md`) {
    throw new EngineeringJournalError("receipt_filename_mismatch", safeSource);
  }
  const title = stringValue(frontmatter, "title", safeSource);
  if (title !== documentTitle) throw new EngineeringJournalError("document_title_mismatch", safeSource);
  if (title.length > 160 || sections.length > 0 || body !== summary || summary.length > 280 || /\n\s*\n/.test(summary) || /^#{2,6}\s/m.test(summary)) {
    throw new EngineeringJournalError("receipt_not_compact", safeSource);
  }
  const classification = stringValue(frontmatter, "classification", safeSource) as EngineeringPullRequestClassification;
  if (!RECEIPT_CLASSIFICATIONS.has(classification)) {
    throw new EngineeringJournalError("field_classification_invalid", safeSource);
  }
  const richRecordRefs = stringArray(frontmatter, "richRecordRefs", safeSource, { maxItems: 16, maxLength: 180 });
  if (new Set(richRecordRefs).size !== richRecordRefs.length || richRecordRefs.some((ref) => !RECORD_REF_PATTERN.test(ref))) {
    throw new EngineeringJournalError("field_richRecordRefs_invalid", safeSource);
  }
  if (classification === "none" && richRecordRefs.length > 0) {
    throw new EngineeringJournalError("receipt_none_has_rich_record", safeSource);
  }
  if (classification !== "none" && richRecordRefs.length === 0) {
    throw new EngineeringJournalError("receipt_material_record_missing", safeSource);
  }
  if (typeof frontmatter.reconstructed !== "boolean") {
    throw new EngineeringJournalError("field_reconstructed_invalid", safeSource);
  }
  const confidence = stringValue(frontmatter, "confidence", safeSource) as EngineeringPullRequestReceipt["confidence"];
  if (!CONFIDENCE.has(confidence)) throw new EngineeringJournalError("field_confidence_invalid", safeSource);
  const unknowns = stringArray(frontmatter, "unknowns", safeSource, { maxItems: 32, maxLength: 512 });
  const headCommit = nullableCommit(frontmatter, "headCommit", safeSource);
  const mergeCommit = nullableCommit(frontmatter, "mergeCommit", safeSource);
  const mergedAt = nullableTimestamp(frontmatter, "mergedAt", safeSource);
  const receiptVerification = verification(frontmatter, safeSource, { maxItems: 32, maxLength: 512 });
  if ((headCommit || mergeCommit || mergedAt) && receiptVerification.state !== "verified") {
    throw new EngineeringJournalError("receipt_supplied_fact_unverified", safeSource);
  }
  const visibility = stringValue(frontmatter, "visibility", safeSource);
  const publicationEligibility = stringValue(frontmatter, "publicationEligibility", safeSource);
  if (visibility !== "public-safe" || publicationEligibility !== "eligible") {
    throw new EngineeringJournalError("receipt_not_public_eligible", safeSource);
  }
  const sources = sourceReferences(
    frontmatter,
    safeSource,
    trusted,
    document.commit,
    { maxItems: 32, labelMaxLength: 160, urlMaxLength: 2048 },
  );
  const pullRequestUrl = `https://github.com/${trusted.owner}/${repository}/pull/${pr}`;
  if (!sources.some((entry) => entry.kind === "pull-request" && entry.url === pullRequestUrl)) {
    throw new EngineeringJournalError("receipt_pull_request_source_missing", safeSource);
  }
  const missingFacts: EngineeringPullRequestReceipt["missingFacts"] = [];
  if (!headCommit) missingFacts.push("head-commit");
  if (!mergeCommit) missingFacts.push("merge-commit");
  if (!mergedAt) missingFacts.push("merged-at");

  return {
    schemaVersion: 1,
    ref: `pr:${repository}:${pr}`,
    repository,
    pr,
    originalPullRequestUrl: pullRequestUrl,
    title,
    summary,
    classification,
    richRecordRefs,
    reconstructed: frontmatter.reconstructed,
    confidence,
    unknowns,
    headCommit,
    mergeCommit,
    mergedAt,
    timelineAt: mergedAt ?? document.committedAt,
    timelineBasis: mergedAt ? "verified-merge" : "source-commit",
    timelineCommit: mergeCommit ?? document.commit,
    timelineCommitBasis: mergeCommit ? "verified-merge" : "source-commit",
    missingFacts,
    sources,
    verification: receiptVerification,
    visibility: "public-safe",
    publicationEligibility: "eligible",
    source: {
      repository: document.repository,
      commit: document.commit,
      committedAt: document.committedAt,
      path: document.path,
      permalink: sourcePermalink(trusted, document.commit, document.path),
    },
  };
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function emptyTypeCounts(): Record<EngineeringRecordType, number> {
  return {
    "change-note": 0,
    adr: 0,
    "architecture-review": 0,
    "feature-retrospective": 0,
    postmortem: 0,
    "capability-dossier": 0,
  };
}

function emptyStatusCounts(): Record<EngineeringRecordEffectiveStatus, number> {
  return { proposed: 0, accepted: 0, released: 0, closed: 0, amended: 0, superseded: 0 };
}

function emptyReceiptClassificationCounts(): Record<EngineeringPullRequestClassification, number> {
  return {
    none: 0,
    "change-note": 0,
    adr: 0,
    "architecture-review": 0,
    "feature-retrospective": 0,
    postmortem: 0,
    "capability-dossier": 0,
  };
}

function buildStatistics(records: EngineeringJournalRecord[]): EngineeringJournalStatistics {
  const byType = emptyTypeCounts();
  const byStatus = emptyStatusCounts();
  const byRepository: Record<string, number> = {};
  const byCapability: Record<string, number> = {};
  let verified = 0;
  let recordsWithReleaseRefs = 0;
  let recordsWithRunRefs = 0;
  for (const record of records) {
    byType[record.type] += 1;
    byStatus[record.effectiveStatus] += 1;
    byRepository[record.repository] = (byRepository[record.repository] ?? 0) + 1;
    for (const capability of record.capabilityIds) {
      byCapability[capability] = (byCapability[capability] ?? 0) + 1;
    }
    if (record.verification.state === "verified") verified += 1;
    if (record.release) recordsWithReleaseRefs += 1;
    if (record.run) recordsWithRunRefs += 1;
  }
  const chronology = [...records]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.ref.localeCompare(right.ref))
    .map((record) => ({
      ref: record.ref,
      createdAt: record.createdAt,
      type: record.type,
      status: record.effectiveStatus,
      repository: record.repository,
    }));
  return {
    totalRecords: records.length,
    earliestCreatedAt: chronology[0]?.createdAt ?? null,
    latestCreatedAt: chronology.at(-1)?.createdAt ?? null,
    byType,
    byStatus,
    byRepository: Object.fromEntries(Object.entries(byRepository).sort(([left], [right]) => left.localeCompare(right))),
    byCapability: Object.fromEntries(Object.entries(byCapability).sort(([left], [right]) => left.localeCompare(right))),
    verification: { verified, notRecorded: records.length - verified },
    recordsWithReleaseRefs,
    recordsWithRunRefs,
    chronology,
  };
}

function buildReceiptStatistics(receipts: EngineeringPullRequestReceipt[]): EngineeringPullRequestReceiptStatistics {
  const byRepository: Record<string, number> = {};
  const byClassification = emptyReceiptClassificationCounts();
  let reconstructed = 0;
  let withMissingFacts = 0;
  for (const receipt of receipts) {
    byRepository[receipt.repository] = (byRepository[receipt.repository] ?? 0) + 1;
    byClassification[receipt.classification] += 1;
    if (receipt.reconstructed) reconstructed += 1;
    if (receipt.missingFacts.length > 0) withMissingFacts += 1;
  }
  const chronology = [...receipts]
    .sort((left, right) => left.timelineAt.localeCompare(right.timelineAt) || left.ref.localeCompare(right.ref))
    .map((receipt) => ({
      ref: receipt.ref,
      pr: receipt.pr,
      originalPullRequestUrl: receipt.originalPullRequestUrl,
      timelineAt: receipt.timelineAt,
      timelineBasis: receipt.timelineBasis,
      repository: receipt.repository,
      classification: receipt.classification,
    }));
  return {
    totalReceipts: receipts.length,
    earliestTimelineAt: chronology[0]?.timelineAt ?? null,
    latestTimelineAt: chronology.at(-1)?.timelineAt ?? null,
    byRepository: Object.fromEntries(Object.entries(byRepository).sort(([left], [right]) => left.localeCompare(right))),
    byClassification,
    reconstructed,
    withMissingFacts,
    chronology,
  };
}

function renderStandalone(index: EngineeringJournalIndex, normalizedJson: string) {
  const receipts = index.pullRequestReceipts.map((receipt) => `<article id="${escapeHtml(receipt.ref)}">
<p><a href="${escapeHtml(receipt.originalPullRequestUrl)}">PR #${receipt.pr}</a> · ${escapeHtml(receipt.repository)} · ${escapeHtml(receipt.classification)}</p>
<h2>${escapeHtml(receipt.title)}</h2>
<p>${escapeHtml(receipt.summary)}</p>
<p>${escapeHtml(receipt.timelineAt)} · ${escapeHtml(receipt.timelineBasis)}</p>
<p><a href="${escapeHtml(receipt.source.permalink)}">Exact receipt source</a></p>
</article>`).join("\n");
  const records = index.records.map((record) => `<article id="${escapeHtml(record.ref)}">
<p>${escapeHtml(record.type)} · ${escapeHtml(record.effectiveStatus)} · ${escapeHtml(record.repository)}</p>
<h1>${escapeHtml(record.title)}</h1>
<p>${escapeHtml(record.summary)}</p>
${record.diagrams.map((diagram) => `<figure><a href="${escapeHtml(diagram.renderedPermalink)}"><img src="${escapeHtml(diagram.renderedUrl)}" alt="${escapeHtml(diagram.summary)}"></a><figcaption><strong>${escapeHtml(diagram.title)}</strong> — ${escapeHtml(diagram.summary)} <a href="${escapeHtml(diagram.sourcePermalink)}">Editable source</a></figcaption></figure>`).join("\n")}
${record.sections.map((section) => `<section id="${escapeHtml(`${record.ref}-${section.id}`)}"><h2>${escapeHtml(section.title)}</h2>${renderMarkdown(section.body)}</section>`).join("\n")}
<p><a href="${escapeHtml(record.source.permalink)}">Exact source</a></p>
</article>`).join("\n");
  const embeddedJson = normalizedJson.trimEnd().replaceAll("<", "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Interview Arc Engineering Journal</title></head><body><main><section aria-labelledby="pull-request-timeline"><h1 id="pull-request-timeline">Pull request timeline</h1>${receipts}</section><section aria-labelledby="rich-engineering-records"><h1 id="rich-engineering-records">Rich engineering records</h1>${records}</section></main><script id="engineering-journal-index" type="application/json">${embeddedJson}</script></body></html>\n`;
}

function renderMarkdown(source: string) {
  return renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfm] }, source));
}

export function buildEngineeringJournal(input: EngineeringJournalBuildInput): EngineeringJournalBuild {
  const repositories = new Map<string, TrustedJournalRepository>();
  for (let index = 0; index < input.trustedRepositories.length; index += 1) {
    const repository = input.trustedRepositories[index];
    const safeSource = `trusted-repository-${index + 1}`;
    if (!REPOSITORY_PATTERN.test(repository.repository) || !REPOSITORY_PATTERN.test(repository.owner)) {
      throw new EngineeringJournalError("repository_config_invalid", safeSource);
    }
    if (!repository.canonicalPath || repository.canonicalPath.startsWith("/") || repository.canonicalPath.includes("..") ||
      PRIVATE_CONTENT_PATTERNS.some((pattern) => pattern.test(repository.canonicalPath))) {
      throw new EngineeringJournalError("repository_config_invalid", safeSource);
    }
    if (repository.receiptPath !== undefined && (!repository.receiptPath || repository.receiptPath.startsWith("/") ||
      repository.receiptPath.includes("..") || repository.receiptPath === repository.canonicalPath ||
      PRIVATE_CONTENT_PATTERNS.some((pattern) => pattern.test(repository.receiptPath)))) {
      throw new EngineeringJournalError("repository_receipt_config_invalid", safeSource);
    }
    if (repository.commit && !COMMIT_PATTERN.test(repository.commit)) {
      throw new EngineeringJournalError("repository_commit_invalid", safeSource);
    }
    if (repositories.has(repository.repository)) throw new EngineeringJournalError("repository_duplicate", safeSource);
    repositories.set(repository.repository, repository);
  }
  const normalizedRecords = input.documents.map((document, index) => normalizeDocument(document, repositories, `document-${index + 1}`));
  const records = normalizedRecords.filter((record) => record.visibility === "public-safe" && record.publicationEligibility === "eligible")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
  const refs = new Set<string>();
  for (const record of records) {
    if (refs.has(record.ref)) throw new EngineeringJournalError("record_revision_duplicate", record.source.repository);
    refs.add(record.ref);
  }
  const revisionsById = new Map<string, EngineeringJournalRecord[]>();
  for (const record of records) {
    const revisions = revisionsById.get(record.id) ?? [];
    revisions.push(record);
    revisionsById.set(record.id, revisions);
  }
  for (const revisions of revisionsById.values()) {
    revisions.sort((left, right) => left.revision - right.revision);
    for (let index = 0; index < revisions.length; index += 1) {
      if (revisions[index].revision !== index + 1) {
        throw new EngineeringJournalError("record_revision_sequence_invalid", revisions[index].ref);
      }
      if (index > 0 && revisions[index].createdAt < revisions[index - 1].createdAt) {
        throw new EngineeringJournalError("record_revision_chronology_invalid", revisions[index].ref);
      }
    }
  }
  const byRef = new Map(records.map((record) => [record.ref, record]));
  const backlinks: Record<string, string[]> = Object.fromEntries(records.map((record) => [record.ref, []]));
  for (const record of records) {
    const links = [...record.relatedRecords, ...record.decisions, ...record.incidents, ...record.features, ...record.amends, ...record.supersedes];
    if (new Set(links).size !== links.length) {
      throw new EngineeringJournalError("relation_duplicate", record.source.repository);
    }
    for (const target of links) {
      if (!RECORD_REF_PATTERN.test(target)) {
        throw new EngineeringJournalError("relation_ref_invalid", record.ref);
      }
      const targetRecord = byRef.get(target);
      if (!targetRecord) throw new EngineeringJournalError("relation_target_missing", record.source.repository);
      if (target === record.ref) throw new EngineeringJournalError("relation_self_reference", record.source.repository);
      backlinks[target].push(record.ref);
    }
    for (const target of record.amends) {
      const targetRecord = byRef.get(target)!;
      if (record.createdAt <= targetRecord.createdAt) {
        throw new EngineeringJournalError("amendment_chronology_invalid", record.source.repository);
      }
      targetRecord.amendedBy.push(record.ref);
    }
    for (const target of record.supersedes) {
      const targetRecord = byRef.get(target)!;
      if (record.createdAt <= targetRecord.createdAt) {
        throw new EngineeringJournalError("supersession_chronology_invalid", record.source.repository);
      }
      targetRecord.supersededBy.push(record.ref);
    }
  }
  for (const record of records) {
    record.amendedBy.sort();
    record.supersededBy.sort();
    record.effectiveStatus = record.supersededBy.length
      ? "superseded"
      : record.amendedBy.length
        ? "amended"
        : record.status;
  }
  for (const links of Object.values(backlinks)) links.sort();
  const pullRequestReceipts = (input.receiptDocuments ?? [])
    .map((document, index) => normalizeReceipt(document, repositories, `receipt-document-${index + 1}`))
    .sort((left, right) => right.timelineAt.localeCompare(left.timelineAt) || left.ref.localeCompare(right.ref));
  const receiptRefs = new Set<string>();
  const receiptBacklinks: Record<string, string[]> = Object.fromEntries(records.map((record) => [record.ref, []]));
  for (const receipt of pullRequestReceipts) {
    if (receiptRefs.has(receipt.ref)) throw new EngineeringJournalError("receipt_duplicate", receipt.source.repository);
    receiptRefs.add(receipt.ref);
    let classificationMatched = receipt.classification === "none";
    for (const target of receipt.richRecordRefs) {
      const targetRecord = byRef.get(target);
      if (!targetRecord) throw new EngineeringJournalError("receipt_record_target_missing", receipt.source.repository);
      receiptBacklinks[target].push(receipt.ref);
      if (targetRecord.type === receipt.classification) classificationMatched = true;
    }
    if (!classificationMatched) {
      throw new EngineeringJournalError("receipt_record_type_mismatch", receipt.source.repository);
    }
  }
  for (const links of Object.values(receiptBacklinks)) links.sort();
  const index: EngineeringJournalIndex = {
    schemaVersion: 1,
    records,
    pullRequestReceipts,
    search: records.map((record) => ({
      id: record.id,
      ref: record.ref,
      revision: record.revision,
      createdAt: record.createdAt,
      text: [
        record.title,
        record.summary,
        record.repository,
        record.type,
        record.status,
        record.effectiveStatus,
        ...record.capabilityIds,
        ...record.modules,
        ...record.interfaces,
        ...record.seams,
        ...record.adapters,
        ...record.relatedRecords,
        ...record.decisions,
        ...record.incidents,
        ...record.features,
        ...record.capabilities,
        ...record.amends,
        ...record.supersedes,
        ...record.learningRefs,
        ...record.diagrams.flatMap((diagram) => [
          diagram.title,
          diagram.summary,
          diagram.sourcePath,
          diagram.renderedPath,
          ...diagram.evidenceRefs,
        ]),
        ...record.sources.flatMap((source) => [source.label, source.kind, source.url]),
        record.issue ? `issue ${record.issue} #${record.issue}` : "",
        record.pr ? `pull request ${record.pr} pr ${record.pr}` : "",
        record.release ?? "",
        record.run ?? "",
        ...record.sections.map((section) => `${section.title} ${section.body}`),
        record.interviewView ? `${record.interviewView.title} ${record.interviewView.body}` : "",
      ].join(" ").toLowerCase(),
      repository: record.repository,
      type: record.type,
      status: record.status,
      effectiveStatus: record.effectiveStatus,
      capabilityIds: record.capabilityIds,
    })),
    receiptSearch: pullRequestReceipts.map((receipt) => ({
      ref: receipt.ref,
      pr: receipt.pr,
      timelineAt: receipt.timelineAt,
      text: [
        receipt.title,
        receipt.summary,
        receipt.repository,
        receipt.classification,
        ...receipt.richRecordRefs,
        ...receipt.unknowns,
        ...receipt.missingFacts,
        ...receipt.sources.flatMap((source) => [source.label, source.kind, source.url]),
        `pull request ${receipt.pr} pr ${receipt.pr}`,
      ].join(" ").toLowerCase(),
      repository: receipt.repository,
      classification: receipt.classification,
      richRecordRefs: receipt.richRecordRefs,
    })),
    backlinks,
    receiptBacklinks,
    statistics: buildStatistics(records),
    receiptStatistics: buildReceiptStatistics(pullRequestReceipts),
  };
  const normalizedJson = `${JSON.stringify(index, null, 2)}\n`;
  return { index, normalizedJson, standaloneHtml: renderStandalone(index, normalizedJson) };
}
