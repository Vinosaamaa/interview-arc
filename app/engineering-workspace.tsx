"use client";

import { useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type {
  EngineeringJournalIndex,
  EngineeringJournalRecord,
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

function SearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.2 4.2" /></svg>;
}

function SourceIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v6H5V6h6" /></svg>;
}

function viewRecord(record: EngineeringJournalRecord, view: EngineeringView) {
  if (view === "decisions") return record.type === "adr" || record.type === "architecture-review";
  if (view === "incidents") return record.type === "postmortem";
  if (view === "case-studies") return record.type === "feature-retrospective";
  if (view === "capabilities") return record.type === "capability-dossier" || record.capabilityIds.length > 0;
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
  return <article className="engineering-reader" aria-labelledby="engineering-record-title">
    <header className="engineering-reader-header">
      <button type="button" className="engineering-mobile-back" onClick={onBack}>Back to records</button>
      <div className="engineering-record-classification">
        <span>{TYPE_LABELS[record.type]}</span>
        <i data-status={record.effectiveStatus}>{STATUS_LABELS[record.effectiveStatus]}</i>
      </div>
      <h1 id="engineering-record-title">{record.title}</h1>
      <p>{record.summary}</p>
      <div className="engineering-provenance">
        <span aria-hidden="true" />
        <div><strong>{record.ref}</strong><small>{record.repository} · {record.source.commit.slice(0, 8)} · {record.createdAt}</small></div>
        <a href={record.source.permalink} target="_blank" rel="noreferrer"><SourceIcon />Exact source</a>
      </div>
    </header>

    <div className="engineering-reader-body">
      <dl className="engineering-facts">
        <div><dt>Modules</dt><dd>{record.modules.join(", ") || "Not recorded"}</dd></div>
        <div><dt>Interfaces</dt><dd>{record.interfaces.join(", ") || "Not recorded"}</dd></div>
        <div><dt>Capabilities</dt><dd>{record.capabilityIds.join(", ") || "Not recorded"}</dd></div>
        <div><dt>Verification</dt><dd>{record.verification.state === "verified" ? "Explicit evidence recorded" : "Not recorded"}</dd></div>
      </dl>

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
        {[...corrections, ...outgoing, ...backlinks].length > 0 ? <div className="engineering-lineage-links">
          {[...new Set([...corrections, ...outgoing, ...backlinks])].map((ref) => <button type="button" key={ref} onClick={() => onSelect(ref)}>{ref}</button>)}
        </div> : <small>No amendments, supersessions, or related backlinks recorded.</small>}
      </section>

      <section className="engineering-evidence" aria-labelledby="engineering-evidence-title">
        <h2 id="engineering-evidence-title">Evidence</h2>
        <ul>{record.sources.map((source) => <li key={`${source.kind}:${source.url}`}><a href={source.url} target="_blank" rel="noreferrer">{source.label}<SourceIcon /></a><span>{source.kind}</span></li>)}</ul>
      </section>

      <div className="engineering-actions">
        <button type="button" disabled aria-disabled="true" title="Available after the Learn runtime contract is released">Learn this</button>
        <small>Pending the released Learn revision, commit, and symbol contract.</small>
      </div>
    </div>
  </article>;
}

function EngineeringStatistics({ index }: { index: EngineeringJournalIndex }) {
  const statistics = index.statistics;
  return <section className="engineering-statistics" aria-labelledby="engineering-statistics-title">
    <header><h1 id="engineering-statistics-title">Statistics</h1><p>Deterministic facts from the same normalized Journal projection used by every reader.</p></header>
    <div className="engineering-stat-ledger">
      <dl>
        <div><dt>Eligible records</dt><dd>{statistics.totalRecords}</dd></div>
        <div><dt>Explicitly verified</dt><dd>{statistics.verification.verified}</dd></div>
        <div><dt>With release refs</dt><dd>{statistics.recordsWithReleaseRefs}</dd></div>
        <div><dt>With run refs</dt><dd>{statistics.recordsWithRunRefs}</dd></div>
      </dl>
      <section><h2>Record types</h2><table><tbody>{Object.entries(statistics.byType).map(([type, count]) => <tr key={type}><th>{TYPE_LABELS[type as EngineeringRecordType]}</th><td>{count}</td></tr>)}</tbody></table></section>
      <section><h2>Effective status</h2><table><tbody>{Object.entries(statistics.byStatus).map(([status, count]) => <tr key={status}><th>{STATUS_LABELS[status as EngineeringRecordEffectiveStatus]}</th><td>{count}</td></tr>)}</tbody></table></section>
      <section className="engineering-chronology"><h2>Chronology</h2>{statistics.chronology.length > 0 ? <ol>{statistics.chronology.map((entry) => <li key={entry.ref}><span>{entry.createdAt}</span><strong>{entry.ref}</strong><small>{TYPE_LABELS[entry.type]} · {STATUS_LABELS[entry.status]}</small></li>)}</ol> : <p>No eligible records.</p>}</section>
    </div>
    <p className="engineering-stat-note">Release and run references are not verification receipts. Verification is counted only from an explicit record state.</p>
  </section>;
}

export default function EngineeringWorkspace({ index, view }: { index: EngineeringJournalIndex; view: EngineeringView }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<EngineeringRecordType | "all">("all");
  const [status, setStatus] = useState<EngineeringRecordEffectiveStatus | "all">("all");
  const [repository, setRepository] = useState("all");
  const [selectedRef, setSelectedRef] = useState(index.records[0]?.ref ?? "");
  const [mobileReaderOpen, setMobileReaderOpen] = useState(false);
  const searchByRef = useMemo(() => new Map(index.search.map((entry) => [entry.ref, entry])), [index.search]);
  const repositories = useMemo(() => [...new Set(index.records.map((record) => record.repository))].sort(), [index.records]);
  const records = useMemo(() => index.records.filter((record) => {
    const search = searchByRef.get(record.ref);
    return viewRecord(record, view)
      && (type === "all" || record.type === type)
      && (status === "all" || record.effectiveStatus === status)
      && (repository === "all" || record.repository === repository)
      && (!query.trim() || search?.text.includes(query.trim().toLowerCase()));
  }), [index.records, query, repository, searchByRef, status, type, view]);

  if (view === "statistics") return <EngineeringStatistics index={index} />;
  const activeSelectedRef = records.some((record) => record.ref === selectedRef) ? selectedRef : records[0]?.ref;
  const selected = index.records.find((record) => record.ref === activeSelectedRef) ?? null;
  const select = (ref: string) => { setSelectedRef(ref); setMobileReaderOpen(true); };

  return <section className={`engineering-workspace ${mobileReaderOpen ? "mobile-reader-open" : ""}`}>
    <aside className="engineering-records" aria-label={`${ENGINEERING_VIEW_TITLES[view]} records`}>
      <header><h1>{ENGINEERING_VIEW_TITLES[view].replace("Engineering · ", "")}</h1><p>{records.length} factual {records.length === 1 ? "record" : "records"}</p></header>
      {view === "journal" ? <div className="engineering-filters">
        <label className="engineering-search"><SearchIcon /><span className="sr-only">Search Engineering records</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search evidence, Module, issue…" /></label>
        <div>
          <label><span>Type</span><select value={type} onChange={(event) => setType(event.target.value as EngineeringRecordType | "all")}><option value="all">All types</option>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as EngineeringRecordEffectiveStatus | "all")}><option value="all">All status</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <label><span>Repository</span><select value={repository} onChange={(event) => setRepository(event.target.value)}><option value="all">All repositories</option>{repositories.map((value) => <option key={value}>{value}</option>)}</select></label>
      </div> : null}
      <div className="engineering-record-list">
        {records.map((record) => <button type="button" key={record.ref} className={record.ref === selected?.ref ? "active" : ""} aria-current={record.ref === selected?.ref ? "true" : undefined} onClick={() => select(record.ref)}>
          <span><i>{TYPE_LABELS[record.type]}</i><time>{record.createdAt}</time></span>
          <strong>{record.title}</strong>
          <small>{record.repository} · {record.ref}</small>
          <em data-status={record.effectiveStatus}>{STATUS_LABELS[record.effectiveStatus]}</em>
        </button>)}
        {records.length === 0 ? <EmptyEngineeringView view={view} /> : null}
      </div>
    </aside>
    {selected ? <RecordReader record={selected} index={index} onSelect={select} onBack={() => setMobileReaderOpen(false)} /> : <div className="engineering-reader engineering-reader-empty"><EmptyEngineeringView view={view} /></div>}
  </section>;
}
