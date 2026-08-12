export type EngineeringRecordType =
  | "change-note"
  | "adr"
  | "architecture-review"
  | "feature-retrospective"
  | "postmortem"
  | "capability-dossier";

export type EngineeringRecordStatus = "proposed" | "accepted" | "released" | "closed";

export type EngineeringRecordEffectiveStatus = EngineeringRecordStatus | "amended" | "superseded";

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
  commit?: string;
};

export type EngineeringJournalDocument = {
  repository: string;
  commit: string;
  path: string;
  markdown: string;
};

export type EngineeringJournalBuildInput = {
  trustedRepositories: TrustedJournalRepository[];
  documents: EngineeringJournalDocument[];
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

export type EngineeringJournalIndex = {
  schemaVersion: 1;
  records: EngineeringJournalRecord[];
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
  backlinks: Record<string, string[]>;
  statistics: EngineeringJournalStatistics;
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
  "sources",
  "verification",
  "visibility",
  "publicationEligibility",
  "issue",
  "pr",
  "release",
  "run",
]);
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+$/;
const RECORD_REF_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*@[1-9]\d*$/;
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
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if ((value.startsWith("[") && value.endsWith("]")) || (value.startsWith("{") && value.endsWith("}"))) {
    return JSON.parse(value);
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
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

function stringArray(frontmatter: Record<string, unknown>, key: string, source: string) {
  const value = frontmatter[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
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

function sourceReferences(frontmatter: Record<string, unknown>, source: string): EngineeringRecordSourceReference[] {
  const value = frontmatter.sources;
  if (!Array.isArray(value) || value.length === 0) throw new EngineeringJournalError("field_sources_invalid", source);
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new EngineeringJournalError("field_sources_invalid", source);
    }
    const entry = item as Record<string, unknown>;
    if (Object.keys(entry).some((key) => !["label", "url", "kind"].includes(key))) {
      throw new EngineeringJournalError("field_sources_invalid", source);
    }
    if (typeof entry.label !== "string" || !entry.label.trim()) {
      throw new EngineeringJournalError("field_sources_invalid", source);
    }
    if (typeof entry.url !== "string" || !/^https:\/\/[^\s]+$/.test(entry.url)) {
      throw new EngineeringJournalError("field_sources_invalid", source);
    }
    if (!["issue", "pull-request", "commit", "release", "run", "documentation"].includes(String(entry.kind))) {
      throw new EngineeringJournalError("field_sources_invalid", source);
    }
    return {
      label: entry.label.trim(),
      url: entry.url,
      kind: entry.kind as EngineeringRecordSourceReference["kind"],
    };
  });
}

function verification(frontmatter: Record<string, unknown>, source: string): EngineeringRecordVerification {
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
  if (!Array.isArray(entry.evidenceRefs) || entry.evidenceRefs.some((ref) => typeof ref !== "string" || !ref.trim())) {
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

function normalizeDocument(
  document: EngineeringJournalDocument,
  repositories: Map<string, TrustedJournalRepository>,
  safeSource: string,
): EngineeringJournalRecord {
  const trusted = repositories.get(document.repository);
  if (!trusted) throw new EngineeringJournalError("repository_untrusted", safeSource);
  if (!COMMIT_PATTERN.test(document.commit)) throw new EngineeringJournalError("commit_invalid", safeSource);
  if (trusted.commit && trusted.commit !== document.commit) {
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
    sources: sourceReferences(frontmatter, safeSource),
    verification: verification(frontmatter, safeSource),
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

function renderStandalone(index: EngineeringJournalIndex, normalizedJson: string) {
  const records = index.records.map((record) => `<article id="${escapeHtml(record.ref)}">
<p>${escapeHtml(record.type)} · ${escapeHtml(record.effectiveStatus)} · ${escapeHtml(record.repository)}</p>
<h1>${escapeHtml(record.title)}</h1>
<p>${escapeHtml(record.summary)}</p>
${record.sections.map((section) => `<section id="${escapeHtml(section.id)}"><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.body)}</p></section>`).join("\n")}
<p><a href="${escapeHtml(record.source.permalink)}">Exact source</a></p>
</article>`).join("\n");
  const embeddedJson = normalizedJson.trimEnd().replaceAll("<", "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Interview Arc Engineering Journal</title></head><body><main>${records}</main><script id="engineering-journal-index" type="application/json">${embeddedJson}</script></body></html>\n`;
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
  const index: EngineeringJournalIndex = {
    schemaVersion: 1,
    records,
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
    backlinks,
    statistics: buildStatistics(records),
  };
  const normalizedJson = `${JSON.stringify(index, null, 2)}\n`;
  return { index, normalizedJson, standaloneHtml: renderStandalone(index, normalizedJson) };
}
