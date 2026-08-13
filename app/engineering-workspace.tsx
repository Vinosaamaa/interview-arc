"use client";

import { useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type {
  EngineeringJournalIndex,
  EngineeringJournalRecord,
  EngineeringPullRequestClassification,
  EngineeringPullRequestReceipt,
  EngineeringRecordEffectiveStatus,
  EngineeringRecordType,
} from "../engineering-journal/index";

export type EngineeringView = "journal" | "capabilities" | "decisions" | "incidents" | "case-studies" | "statistics";

export const ENGINEERING_NAV_ITEMS: ReadonlyArray<readonly [EngineeringView, string]> = [
  ["journal", "Journal"],
  ["capabilities", "Capabilities"],
  ["decisions", "Decisions"],
  ["incidents", "Incidents"],
  ["case-studies", "Case Studies"],
  ["statistics", "Statistics"],
];

export const ENGINEERING_VIEW_TITLES: Record<EngineeringView, string> = {
  journal: "Engineering · Journal",
  capabilities: "Engineering · Capabilities",
  decisions: "Engineering · Decisions",
  incidents: "Engineering · Incidents",
  "case-studies": "Engineering · Case Studies",
  statistics: "Engineering · Statistics",
};

const TYPE_LABELS: Record<EngineeringRecordType, string> = {
  "change-note": "Change Note",
  adr: "ADR",
  "architecture-review": "Architecture Review",
  "feature-retrospective": "Feature Retrospective",
  postmortem: "Postmortem",
  "capability-dossier": "Capability Dossier",
};

const STATUS_LABELS: Record<EngineeringRecordEffectiveStatus, string> = {
  proposed: "Proposed",
  accepted: "Accepted",
  released: "Released",
  closed: "Closed",
  amended: "Amended",
  superseded: "Superseded",
};

const RECEIPT_CLASSIFICATION_LABELS: Record<EngineeringPullRequestClassification, string> = {
  none: "Compact change",
  "change-note": "Change Note",
  adr: "ADR",
  "architecture-review": "Architecture Review",
  "feature-retrospective": "Feature Retrospective",
  postmortem: "Postmortem",
  "capability-dossier": "Capability Dossier",
};

type EngineeringJournalLayer = "records" | "receipts";

export type EngineeringIconName =
  | "interview"
  | "learn"
  | "engineering"
  | "journal"
  | "capabilities"
  | "decisions"
  | "incidents"
  | "case-studies"
  | "statistics"
  | "search"
  | "source"
  | "copy"
  | "lineage";

export function EngineeringIcon({ name }: { name: EngineeringIconName }) {
  const paths = (() => {
    if (name === "interview") return <><path d="M5 5.5h14v10H9l-4 3v-13Z" /><path d="M8.5 9h7M8.5 12h4.5" /></>;
    if (name === "learn") return <><path d="M4.5 6.5c2.7-1.1 5.2-.8 7.5.8v11c-2.3-1.6-4.8-1.9-7.5-.8v-11Z" /><path d="M19.5 6.5c-2.7-1.1-5.2-.8-7.5.8v11c2.3-1.6 4.8-1.9 7.5-.8v-11Z" /></>;
    if (name === "engineering") return <><path d="m8.5 7-4 5 4 5M15.5 7l4 5-4 5M13.5 4.5l-3 15" /></>;
    if (name === "journal") return <><path d="M5.5 4.5h11a2 2 0 0 1 2 2v13h-11a2 2 0 0 1-2-2v-13Z" /><path d="M8.5 8h6M8.5 11.5h6M8.5 15h4" /></>;
    if (name === "capabilities") return <><path d="m12 3.8 7 4v8.4l-7 4-7-4V7.8l7-4Z" /><circle cx="12" cy="12" r="2.4" /><path d="M12 6.8v2.8M16.5 9.4l-2.3 1.3M16.5 14.6l-2.3-1.3M12 17.2v-2.8M7.5 14.6l2.3-1.3M7.5 9.4l2.3 1.3" /></>;
    if (name === "decisions") return <><path d="M5 5.5h4v4H5zM15 14.5h4v4h-4zM15 5.5h4v4h-4z" /><path d="M9 7.5h3a3 3 0 0 1 3 3v4M9 7.5h6" /></>;
    if (name === "incidents") return <><path d="M12 4 21 19H3L12 4Z" /><path d="M12 9v4.5M12 16.5h.01" /></>;
    if (name === "case-studies") return <><path d="m4.5 8 7.5-4 7.5 4-7.5 4-7.5-4Z" /><path d="m4.5 12 7.5 4 7.5-4M4.5 16l7.5 4 7.5-4" /></>;
    if (name === "statistics") return <><path d="M5 19V9h3v10M10.5 19V5h3v14M16 19v-7h3v7M3.5 19.5h17" /></>;
    if (name === "search") return <><circle cx="10.8" cy="10.8" r="6.3" /><path d="m15.5 15.5 4.2 4.2" /></>;
    if (name === "source") return <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v6H5V6h6" /></>;
    if (name === "copy") return <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>;
    return <><circle cx="6" cy="7" r="2" /><circle cx="18" cy="7" r="2" /><circle cx="12" cy="18" r="2" /><path d="M8 7h8M7.3 8.7l3.4 7.6M16.7 8.7l-3.4 7.6" /></>;
  })();
  return <svg className="engineering-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>;
}

function CopyControl({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
  };
  const action = state === "copied" ? "Copied" : state === "failed" ? "Retry" : "Copy";
  return <button type="button" className="engineering-copy" onClick={() => void copy()} aria-label={`${action} ${label}`} title={`${action} ${label}`}><EngineeringIcon name="copy" /><span aria-live="polite">{action}</span></button>;
}

function viewRecord(record: EngineeringJournalRecord, view: EngineeringView) {
  if (view === "decisions") return record.type === "adr" || record.type === "architecture-review";
  if (view === "incidents") return record.type === "postmortem";
  if (view === "case-studies") return record.type === "feature-retrospective";
  if (view === "capabilities") return record.type === "capability-dossier";
  return true;
}

function EmptyEngineeringView({ view }: { view: EngineeringView }) {
  const copy: Record<Exclude<EngineeringView, "journal" | "statistics">, string> = {
    capabilities: "No eligible Capability Dossiers have been accepted yet. Capability tags from other records remain searchable in Journal.",
    decisions: "No eligible ADR or Architecture Review matches this view yet.",
    incidents: "No public-safe Postmortem has been published yet.",
    "case-studies": "No released Feature Retrospective has been published yet.",
  };
  return <div className="engineering-empty" role="status"><h2>Nothing fabricated</h2><p>{view === "journal" || view === "statistics" ? "No eligible Engineering records match these filters." : copy[view]}</p></div>;
}

function ReceiptTimeline({
  receipts,
  onOpenRecord,
}: {
  receipts: EngineeringPullRequestReceipt[];
  onOpenRecord: (ref: string) => void;
}) {
  if (receipts.length === 0) {
    return <div className="engineering-empty engineering-receipt-empty" role="status"><h2>No receipts yet</h2><p>No pull-request receipts match these filters. Canonical receipts appear here after their reviewed commit pins are ingested.</p></div>;
  }

  return <ol className="engineering-receipt-list" aria-label="Complete merged pull-request timeline">
    {receipts.map((receipt) => <li key={receipt.ref}>
      <details>
        <summary>
          <span><time dateTime={receipt.timelineAt}>{receipt.timelineAt.slice(0, 10)}</time><i>{receipt.repository} · PR #{receipt.pr}</i></span>
          <strong>{receipt.title}</strong>
          <span><em>{RECEIPT_CLASSIFICATION_LABELS[receipt.classification]}</em><small>{receipt.timelineBasis === "verified-merge" ? "Verified merge" : "Source-commit fallback"}</small></span>
        </summary>
        <div className="engineering-receipt-detail">
          <p>{receipt.summary}</p>
          <dl>
            <div><dt>Receipt</dt><dd><code>{receipt.ref}</code></dd></div>
            <div><dt>Timeline</dt><dd><time dateTime={receipt.timelineAt}>{receipt.timelineAt}</time> · {receipt.timelineBasis === "verified-merge" ? "verified merge facts" : "source commit fallback"}</dd></div>
            <div><dt>Timeline commit</dt><dd><code>{receipt.timelineCommit}</code></dd></div>
            {receipt.headCommit ? <div><dt>Head commit</dt><dd><code>{receipt.headCommit}</code></dd></div> : null}
            {receipt.mergeCommit ? <div><dt>Merge commit</dt><dd><code>{receipt.mergeCommit}</code></dd></div> : null}
            <div><dt>Source</dt><dd><code>{receipt.source.path}</code> at <code>{receipt.source.commit}</code></dd></div>
            <div><dt>Confidence</dt><dd>{receipt.confidence}{receipt.reconstructed ? " · reconstructed" : ""}</dd></div>
            {receipt.missingFacts.length > 0 ? <div><dt>Missing facts</dt><dd>{receipt.missingFacts.join(", ")}</dd></div> : null}
            {receipt.unknowns.length > 0 ? <div><dt>Unknowns</dt><dd>{receipt.unknowns.join(" · ")}</dd></div> : null}
          </dl>
          <ul className="engineering-receipt-sources" aria-label={`Evidence sources for ${receipt.ref}`}>{receipt.sources.map((source) => <li key={`${source.kind}:${source.url}`}><a href={source.url} target="_blank" rel="noreferrer">{source.label}<EngineeringIcon name="source" /></a><span>{source.kind}</span></li>)}</ul>
          {receipt.richRecordRefs.length > 0 ? <div className="engineering-receipt-records"><span>Rich records</span>{receipt.richRecordRefs.map((ref) => <button type="button" key={ref} onClick={() => onOpenRecord(ref)}>{ref}</button>)}</div> : <p className="engineering-receipt-compact-note">Compact receipt only; no rich record was required.</p>}
          <a href={receipt.source.permalink} target="_blank" rel="noreferrer"><EngineeringIcon name="source" />Exact receipt source</a>
        </div>
      </details>
    </li>)}
  </ol>;
}

function RecordReader({
  record,
  index,
  onSelect,
  onBack,
}: {
  record: EngineeringJournalRecord;
  index: EngineeringJournalIndex;
  onSelect: (ref: string) => void;
  onBack: () => void;
}) {
  const readerBody = record.body.startsWith(record.summary)
    ? record.body.slice(record.summary.length).trim()
    : record.body;
  const corrections = [...record.amendedBy, ...record.supersededBy];
  const outgoing = [...record.amends, ...record.supersedes, ...record.relatedRecords, ...record.decisions, ...record.incidents, ...record.features];
  const backlinks = index.backlinks[record.ref] ?? [];
  const lineageRefs = [...new Set([...corrections, ...outgoing, ...backlinks])];
  const relatedReceipts = (index.receiptBacklinks[record.ref] ?? [])
    .map((ref) => index.pullRequestReceipts.find((receipt) => receipt.ref === ref))
    .filter((receipt): receipt is EngineeringPullRequestReceipt => Boolean(receipt));
  return <article className="engineering-reader" aria-labelledby="engineering-record-title">
    <header className="engineering-reader-header">
      <button type="button" className="engineering-mobile-back" onClick={onBack}>Back to records</button>
      <div className="engineering-record-classification">
        <span>{TYPE_LABELS[record.type]}</span>
        <i data-status={record.effectiveStatus}>{STATUS_LABELS[record.effectiveStatus]}</i>
        {record.reconstructed ? <i data-status="reconstructed">Reconstructed</i> : null}
      </div>
      <h1 id="engineering-record-title">{record.title}</h1>
      <p>{record.summary}</p>
      <div className="engineering-provenance">
        <span aria-hidden="true" />
        <dl>
          <div><dt>Record</dt><dd><code>{record.ref}</code><CopyControl key={`record:${record.ref}`} value={record.ref} label="record reference" /></dd></div>
          <div><dt>Commit</dt><dd><code>{record.source.commit}</code><CopyControl key={`commit:${record.source.commit}`} value={record.source.commit} label="full commit" /></dd></div>
          <div><dt>Source path</dt><dd><code>{record.source.path}</code><CopyControl key={`path:${record.source.path}`} value={record.source.path} label="source path" /></dd></div>
        </dl>
        <a href={record.source.permalink} target="_blank" rel="noreferrer"><EngineeringIcon name="source" />Exact source</a>
      </div>
      <div className="engineering-lineage-compact">
        <div><EngineeringIcon name="lineage" /><span>Immutable lineage</span><strong>{record.ref}</strong></div>
        {lineageRefs.length > 0 ? <div>{lineageRefs.slice(0, 3).map((ref) => <button type="button" key={ref} onClick={() => onSelect(ref)} title={`Open ${ref} in Journal`}>{ref}</button>)}{lineageRefs.length > 3 ? <small>+{lineageRefs.length - 3} more below</small> : null}</div> : <small>No linked revisions or backlinks.</small>}
      </div>
    </header>

    <div className="engineering-reader-body">
      <dl className="engineering-facts">
        <div><dt>Modules</dt><dd>{record.modules.join(", ") || "Not recorded"}</dd></div>
        <div><dt>Interfaces</dt><dd>{record.interfaces.join(", ") || "Not recorded"}</dd></div>
        <div><dt>Capabilities</dt><dd>{record.capabilityIds.join(", ") || "Not recorded"}</dd></div>
        <div><dt>Verification</dt><dd>{record.verification.state === "verified" ? "Explicit evidence recorded" : "Not recorded"}</dd></div>
      </dl>

      {record.diagrams.length > 0 ? <section className="engineering-diagrams" aria-labelledby="engineering-diagrams-title">
        <header><h2 id="engineering-diagrams-title">Architecture diagrams</h2><p>Evidence-backed assets bundled from this record&apos;s exact Git revision.</p></header>
        {record.diagrams.map((diagram) => <figure key={`${diagram.sourcePath}:${diagram.renderedPath}`}>
          <a className="engineering-diagram-preview" href={diagram.renderedPermalink} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element -- the Journal must serve the exact commit-pinned generated bytes without an image optimizer rewrite */}
            <img src={diagram.renderedUrl} alt={diagram.summary} loading="lazy" decoding="async" />
          </a>
          <figcaption><strong>{diagram.title}</strong><span>{diagram.summary}</span><div><a href={diagram.renderedPermalink} target="_blank" rel="noreferrer"><EngineeringIcon name="source" />Exact rendered asset</a><a href={diagram.sourcePermalink} target="_blank" rel="noreferrer"><EngineeringIcon name="source" />Editable draw.io source</a></div></figcaption>
        </figure>)}
      </section> : null}

      <div className="engineering-markdown">
        <Markdown remarkPlugins={[remarkGfm]}>{readerBody}</Markdown>
      </div>

      {record.interviewView ? <details className="engineering-interview-view">
        <summary>Interview view</summary>
        <Markdown remarkPlugins={[remarkGfm]}>{record.interviewView.body}</Markdown>
      </details> : null}

      <section className="engineering-lineage" aria-labelledby="engineering-lineage-title">
        <h2 id="engineering-lineage-title">Revision lineage</h2>
        <p>Exact immutable references only. Derived state never rewrites an accepted source.</p>
        <div className="engineering-lineage-current"><span aria-hidden="true" /><strong>{record.ref}</strong><small>{STATUS_LABELS[record.effectiveStatus]}</small></div>
        {lineageRefs.length > 0 ? <div className="engineering-lineage-links">
          {lineageRefs.map((ref) => <button type="button" key={ref} onClick={() => onSelect(ref)}><EngineeringIcon name="lineage" />{ref}</button>)}
        </div> : <small>No amendments, supersessions, or related backlinks recorded.</small>}
      </section>

      <section className="engineering-evidence" aria-labelledby="engineering-evidence-title">
        <h2 id="engineering-evidence-title">Evidence</h2>
        <ul>{record.sources.map((source) => <li key={`${source.kind}:${source.url}`}><a href={source.url} target="_blank" rel="noreferrer">{source.label}<EngineeringIcon name="source" /></a><span>{source.kind}</span></li>)}</ul>
      </section>

      {relatedReceipts.length > 0 ? <section className="engineering-record-receipts" aria-labelledby="engineering-record-receipts-title">
        <h2 id="engineering-record-receipts-title">Pull request history</h2>
        <p>Compact receipts that cite this rich record. Receipt coverage remains independent from record status and verification.</p>
        <ul>{relatedReceipts.map((receipt) => <li key={receipt.ref}><div><span>{receipt.repository} · PR #{receipt.pr}</span><strong>{receipt.title}</strong></div><a href={receipt.source.permalink} target="_blank" rel="noreferrer">Exact receipt<EngineeringIcon name="source" /></a></li>)}</ul>
      </section> : null}

      <div className="engineering-actions">
        <button type="button" disabled aria-disabled="true" title="Available after the Learn runtime contract is released">Learn this</button>
        <small>Pending the released Learn revision, commit, and symbol contract.</small>
      </div>
    </div>
  </article>;
}

function EngineeringStatistics({ index }: { index: EngineeringJournalIndex }) {
  const statistics = index.statistics;
  const receiptStatistics = index.receiptStatistics;
  const dateRange = statistics.earliestCreatedAt && statistics.latestCreatedAt
    ? statistics.earliestCreatedAt === statistics.latestCreatedAt
      ? statistics.earliestCreatedAt
      : `${statistics.earliestCreatedAt} — ${statistics.latestCreatedAt}`
    : "No eligible records";
  const receiptDateRange = receiptStatistics.earliestTimelineAt && receiptStatistics.latestTimelineAt
    ? receiptStatistics.earliestTimelineAt === receiptStatistics.latestTimelineAt
      ? receiptStatistics.earliestTimelineAt
      : `${receiptStatistics.earliestTimelineAt} — ${receiptStatistics.latestTimelineAt}`
    : "No projected receipts";
  return <section className="engineering-statistics" aria-labelledby="engineering-statistics-title">
    <header><h1 id="engineering-statistics-title">Statistics</h1><p>Deterministic facts from the same normalized Journal projection used by every reader. Rich records and complete pull-request coverage remain separate measures.</p></header>
    <section className="engineering-stat-section" aria-labelledby="engineering-record-statistics-title">
      <header><h2 id="engineering-record-statistics-title">Rich engineering records</h2><p>Curated architecture, decision, incident, capability, and retrospective narratives.</p></header>
      <div className="engineering-stat-ledger">
        <dl>
          <div><dt>Eligible records</dt><dd>{statistics.totalRecords}</dd></div>
          <div><dt>Explicitly verified</dt><dd>{statistics.verification.verified}</dd></div>
          <div><dt>With release refs</dt><dd>{statistics.recordsWithReleaseRefs}</dd></div>
          <div><dt>With run refs</dt><dd>{statistics.recordsWithRunRefs}</dd></div>
        </dl>
        <section><h2>Record types</h2><table><tbody>{Object.entries(statistics.byType).map(([type, count]) => <tr key={type}><th>{TYPE_LABELS[type as EngineeringRecordType]}</th><td>{count}</td></tr>)}</tbody></table></section>
        <section><h2>Effective status</h2><table><tbody>{Object.entries(statistics.byStatus).map(([status, count]) => <tr key={status}><th>{STATUS_LABELS[status as EngineeringRecordEffectiveStatus]}</th><td>{count}</td></tr>)}</tbody></table></section>
        <section className="engineering-date-range"><h2>Date range</h2><p>{dateRange}</p></section>
        <section><h2>Repositories</h2>{Object.keys(statistics.byRepository).length > 0 ? <table><tbody>{Object.entries(statistics.byRepository).map(([repository, count]) => <tr key={repository}><th>{repository}</th><td>{count}</td></tr>)}</tbody></table> : <p>No eligible repositories.</p>}</section>
        <section><h2>Capabilities</h2>{Object.keys(statistics.byCapability).length > 0 ? <table><tbody>{Object.entries(statistics.byCapability).map(([capability, count]) => <tr key={capability}><th>{capability}</th><td>{count}</td></tr>)}</tbody></table> : <p>No capability tags recorded.</p>}</section>
        <section className="engineering-chronology"><h2>Chronology</h2>{statistics.chronology.length > 0 ? <ol>{statistics.chronology.map((entry) => <li key={entry.ref}><span>{entry.createdAt}</span><strong>{entry.ref}</strong><small>{TYPE_LABELS[entry.type]} · {STATUS_LABELS[entry.status]}</small></li>)}</ol> : <p>No eligible records.</p>}</section>
      </div>
    </section>
    <section className="engineering-stat-section engineering-receipt-stat-section" aria-labelledby="engineering-receipt-statistics-title">
      <header><h2 id="engineering-receipt-statistics-title">Pull request coverage</h2><p>One compact factual receipt per ingested merged PR, including small changes that do not warrant rich narrative.</p></header>
      <div className="engineering-stat-ledger engineering-receipt-stat-ledger">
        <dl>
          <div><dt>Projected receipts</dt><dd>{receiptStatistics.totalReceipts}</dd></div>
          <div><dt>Complete merge facts</dt><dd>{receiptStatistics.totalReceipts - receiptStatistics.withMissingFacts}</dd></div>
          <div><dt>Reconstructed</dt><dd>{receiptStatistics.reconstructed}</dd></div>
          <div><dt>With missing facts</dt><dd>{receiptStatistics.withMissingFacts}</dd></div>
        </dl>
        <section><h2>Classification</h2><table><tbody>{Object.entries(receiptStatistics.byClassification).map(([classification, count]) => <tr key={classification}><th>{RECEIPT_CLASSIFICATION_LABELS[classification as EngineeringPullRequestClassification]}</th><td>{count}</td></tr>)}</tbody></table></section>
        <section><h2>Repositories</h2>{Object.keys(receiptStatistics.byRepository).length > 0 ? <table><tbody>{Object.entries(receiptStatistics.byRepository).map(([repository, count]) => <tr key={repository}><th>{repository}</th><td>{count}</td></tr>)}</tbody></table> : <p>No projected repositories.</p>}</section>
        <section className="engineering-date-range"><h2>Timeline range</h2><p>{receiptDateRange}</p></section>
        <section className="engineering-chronology engineering-receipt-chronology"><h2>Complete receipt chronology</h2>{receiptStatistics.chronology.length > 0 ? <ol>{receiptStatistics.chronology.map((entry) => <li key={entry.ref}><time dateTime={entry.timelineAt}>{entry.timelineAt}</time><strong>{entry.repository} · PR #{entry.pr}</strong><small>{RECEIPT_CLASSIFICATION_LABELS[entry.classification]} · {entry.timelineBasis === "verified-merge" ? "verified merge" : "source commit"}</small></li>)}</ol> : <p>No projected receipts.</p>}</section>
      </div>
    </section>
    <p className="engineering-stat-note">Release and run references are not verification receipts. Verification is counted only from an explicit record state.</p>
  </section>;
}

type EngineeringWorkspaceMemory = {
  journalLayer: EngineeringJournalLayer;
  query: string;
  type: EngineeringRecordType | "all";
  status: EngineeringRecordEffectiveStatus | "all";
  repository: string;
  receiptQuery: string;
  receiptClassification: EngineeringPullRequestClassification | "all";
  receiptRepository: string;
  selectedRef: string;
  mobileReaderOpen: boolean;
};

const ENGINEERING_MEMORY_KEY = "interview-arc-engineering-workspace-v1";

function readEngineeringMemory(): Partial<EngineeringWorkspaceMemory> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(ENGINEERING_MEMORY_KEY) ?? "{}") as Record<string, unknown>;
    const type = parsed.type === "all" || (typeof parsed.type === "string" && parsed.type in TYPE_LABELS) ? parsed.type as EngineeringWorkspaceMemory["type"] : "all";
    const status = parsed.status === "all" || (typeof parsed.status === "string" && parsed.status in STATUS_LABELS) ? parsed.status as EngineeringWorkspaceMemory["status"] : "all";
    const receiptClassification = parsed.receiptClassification === "all" || (typeof parsed.receiptClassification === "string" && parsed.receiptClassification in RECEIPT_CLASSIFICATION_LABELS) ? parsed.receiptClassification as EngineeringWorkspaceMemory["receiptClassification"] : "all";
    return {
      journalLayer: parsed.journalLayer === "receipts" ? "receipts" : "records",
      query: typeof parsed.query === "string" ? parsed.query : "",
      type,
      status,
      repository: typeof parsed.repository === "string" ? parsed.repository : "all",
      receiptQuery: typeof parsed.receiptQuery === "string" ? parsed.receiptQuery : "",
      receiptClassification,
      receiptRepository: typeof parsed.receiptRepository === "string" ? parsed.receiptRepository : "all",
      selectedRef: typeof parsed.selectedRef === "string" ? parsed.selectedRef : "",
      mobileReaderOpen: parsed.mobileReaderOpen === true,
    };
  } catch {
    return {};
  }
}

export default function EngineeringWorkspace({ index, view, onNavigateView }: { index: EngineeringJournalIndex; view: EngineeringView; onNavigateView: (view: EngineeringView) => void }) {
  const [journalLayer, setJournalLayer] = useState<EngineeringJournalLayer>("records");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<EngineeringRecordType | "all">("all");
  const [status, setStatus] = useState<EngineeringRecordEffectiveStatus | "all">("all");
  const [repository, setRepository] = useState("all");
  const [receiptQuery, setReceiptQuery] = useState("");
  const [receiptClassification, setReceiptClassification] = useState<EngineeringPullRequestClassification | "all">("all");
  const [receiptRepository, setReceiptRepository] = useState("all");
  const [selectedRef, setSelectedRef] = useState(index.records[0]?.ref ?? "");
  const [mobileReaderOpen, setMobileReaderOpen] = useState(false);
  const [memoryReady, setMemoryReady] = useState(false);
  const searchByRef = useMemo(() => new Map(index.search.map((entry) => [entry.ref, entry])), [index.search]);
  const repositories = useMemo(() => [...new Set(index.records.map((record) => record.repository))].sort(), [index.records]);
  const receiptSearchByRef = useMemo(() => new Map(index.receiptSearch.map((entry) => [entry.ref, entry])), [index.receiptSearch]);
  const receiptRepositories = useMemo(() => [...new Set(index.pullRequestReceipts.map((receipt) => receipt.repository))].sort(), [index.pullRequestReceipts]);
  const records = useMemo(() => index.records.filter((record) => {
    const search = searchByRef.get(record.ref);
    return viewRecord(record, view)
      && (view !== "journal" || type === "all" || record.type === type)
      && (view !== "journal" || status === "all" || record.effectiveStatus === status)
      && (view !== "journal" || repository === "all" || record.repository === repository)
      && (view !== "journal" || !query.trim() || search?.text.includes(query.trim().toLowerCase()));
  }), [index.records, query, repository, searchByRef, status, type, view]);
  const receipts = useMemo(() => index.pullRequestReceipts.filter((receipt) => {
    const search = receiptSearchByRef.get(receipt.ref);
    return (receiptClassification === "all" || receipt.classification === receiptClassification)
      && (receiptRepository === "all" || receipt.repository === receiptRepository)
      && (!receiptQuery.trim() || search?.text.includes(receiptQuery.trim().toLowerCase()));
  }), [index.pullRequestReceipts, receiptClassification, receiptQuery, receiptRepository, receiptSearchByRef]);

  useEffect(() => {
    const memory = readEngineeringMemory();
    const frame = window.requestAnimationFrame(() => {
      const rememberedLayer = memory.journalLayer ?? "records";
      setJournalLayer(rememberedLayer);
      setQuery(memory.query ?? "");
      setType(memory.type ?? "all");
      setStatus(memory.status ?? "all");
      setRepository(memory.repository ?? "all");
      setReceiptQuery(memory.receiptQuery ?? "");
      setReceiptClassification(memory.receiptClassification ?? "all");
      setReceiptRepository(memory.receiptRepository ?? "all");
      if (index.records.some((record) => record.ref === memory.selectedRef)) setSelectedRef(memory.selectedRef!);
      setMobileReaderOpen(rememberedLayer === "receipts" ? false : memory.mobileReaderOpen ?? false);
      setMemoryReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [index.records]);

  useEffect(() => {
    if (!memoryReady) return;
    try {
      const next: EngineeringWorkspaceMemory = { journalLayer, query, type, status, repository, receiptQuery, receiptClassification, receiptRepository, selectedRef, mobileReaderOpen };
      window.sessionStorage.setItem(ENGINEERING_MEMORY_KEY, JSON.stringify(next));
    } catch {
      // Session storage can be unavailable in hardened browsing contexts; in-memory state remains active.
    }
  }, [journalLayer, memoryReady, mobileReaderOpen, query, receiptClassification, receiptQuery, receiptRepository, repository, selectedRef, status, type]);

  if (view === "statistics") return <EngineeringStatistics index={index} />;
  const activeSelectedRef = records.some((record) => record.ref === selectedRef) ? selectedRef : records[0]?.ref;
  const selected = index.records.find((record) => record.ref === activeSelectedRef) ?? null;
  const select = (ref: string) => { setSelectedRef(ref); setMobileReaderOpen(true); };
  const openRelation = (ref: string) => {
    setJournalLayer("records");
    setQuery("");
    setType("all");
    setStatus("all");
    setRepository("all");
    setSelectedRef(ref);
    setMobileReaderOpen(true);
    if (view !== "journal") onNavigateView("journal");
  };
  const showReceipts = view === "journal" && journalLayer === "receipts";
  const chooseJournalLayer = (next: EngineeringJournalLayer) => {
    setJournalLayer(next);
    if (next === "receipts") setMobileReaderOpen(false);
  };

  return <section className={`engineering-workspace ${mobileReaderOpen ? "mobile-reader-open" : ""}`}>
    <aside className="engineering-records" aria-label={`${ENGINEERING_VIEW_TITLES[view]} ${showReceipts ? "pull-request receipts" : "rich records"}`}>
      <header><h1>{ENGINEERING_VIEW_TITLES[view].replace("Engineering · ", "")}</h1><p>{showReceipts ? `${receipts.length} of ${index.receiptStatistics.totalReceipts} pull-request receipts` : `${records.length} factual ${records.length === 1 ? "record" : "records"}`}</p></header>
      {view === "journal" ? <div className="engineering-journal-layers" role="group" aria-label="Journal evidence layer">
        <button type="button" aria-pressed={journalLayer === "records"} onClick={() => chooseJournalLayer("records")}><span>Rich records</span><strong>{index.statistics.totalRecords}</strong></button>
        <button type="button" aria-pressed={journalLayer === "receipts"} onClick={() => chooseJournalLayer("receipts")}><span>All merged PRs</span><strong>{index.receiptStatistics.totalReceipts}</strong></button>
      </div> : null}
      {view === "journal" && !showReceipts ? <div className="engineering-filters">
        <label className="engineering-search"><EngineeringIcon name="search" /><span className="sr-only">Search Engineering records</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search evidence, Module, issue…" /></label>
        <div>
          <label><span>Type</span><select value={type} onChange={(event) => setType(event.target.value as EngineeringRecordType | "all")}><option value="all">All types</option>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as EngineeringRecordEffectiveStatus | "all")}><option value="all">All status</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <label><span>Repository</span><select value={repository} onChange={(event) => setRepository(event.target.value)}><option value="all">All repositories</option>{repositories.map((value) => <option key={value}>{value}</option>)}</select></label>
      </div> : null}
      {showReceipts ? <div className="engineering-filters engineering-receipt-filters">
        <label className="engineering-search"><EngineeringIcon name="search" /><span className="sr-only">Search pull-request receipts</span><input value={receiptQuery} onChange={(event) => setReceiptQuery(event.target.value)} placeholder="Search PR, title, source…" /></label>
        <label><span>Classification</span><select value={receiptClassification} onChange={(event) => setReceiptClassification(event.target.value as EngineeringPullRequestClassification | "all")}><option value="all">All classifications</option>{Object.entries(RECEIPT_CLASSIFICATION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>Repository</span><select value={receiptRepository} onChange={(event) => setReceiptRepository(event.target.value)}><option value="all">All repositories</option>{receiptRepositories.map((value) => <option key={value}>{value}</option>)}</select></label>
      </div> : null}
      {showReceipts ? <ReceiptTimeline receipts={receipts} onOpenRecord={openRelation} /> : <div className="engineering-record-list">
        {records.map((record) => <button type="button" key={record.ref} className={record.ref === selected?.ref ? "active" : ""} aria-current={record.ref === selected?.ref ? "true" : undefined} onClick={() => select(record.ref)}>
          <span><i>{TYPE_LABELS[record.type]}</i><time>{record.createdAt}</time></span>
          <strong>{record.title}</strong>
          <small>{record.repository} · {record.ref}</small>
          <em data-status={record.effectiveStatus}>{STATUS_LABELS[record.effectiveStatus]}</em>
        </button>)}
        {records.length === 0 ? <EmptyEngineeringView view={view} /> : null}
      </div>}
    </aside>
    {selected ? <RecordReader record={selected} index={index} onSelect={openRelation} onBack={() => setMobileReaderOpen(false)} /> : <div className="engineering-reader engineering-reader-empty"><EmptyEngineeringView view={view} /></div>}
  </section>;
}
