"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, CSSProperties } from "react";
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
type EngineeringContentsSection = "overview" | "architecture" | "record" | "interview";

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
  | "filter"
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
    if (name === "filter") return <><path d="M4 6h16M7 12h10M10 18h4" /></>;
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

const ENGINEERING_HERO_COPY: Record<EngineeringView, { eyebrow: string; title: string; accent: string; description: string }> = {
  journal: { eyebrow: "Engineering · Journal", title: "Engineering decisions, mapped in the terrain.", accent: "#d86742", description: "Read the architecture, tradeoffs, incidents, and verification behind every shipped capability." },
  capabilities: { eyebrow: "Engineering · Capabilities", title: "Reusable strengths, grown from exact work.", accent: "#25856c", description: "Trace durable capabilities back to the records, modules, interfaces, and evidence that established them." },
  decisions: { eyebrow: "Engineering · Decisions", title: "Alternatives converge into deliberate choices.", accent: "#566cc6", description: "Review the constraints, rejected paths, and consequences behind each accepted engineering direction." },
  incidents: { eyebrow: "Engineering · Incidents", title: "Failures become operating knowledge.", accent: "#d65d63", description: "Keep timelines, root causes, recovery evidence, and follow-up work together without smoothing the facts." },
  "case-studies": { eyebrow: "Engineering · Case Studies", title: "Delivered systems, examined layer by layer.", accent: "#c5872b", description: "Move from context through implementation and verification while preserving the exact source lineage." },
  statistics: { eyebrow: "Engineering · Statistics", title: "The record, measured without invention.", accent: "#49a6a8", description: "Explore deterministic coverage, chronology, repositories, and verification from the same normalized projection." },
};

function JournalNatureSketch() { return <svg viewBox="0 0 720 250" role="img" aria-label="An alpine route recording exact engineering revisions"><path d="M30 224 154 102l65 61 91-119 80 109 73-76 134 147" /><path d="M65 219c70-42 132-51 188-26 63 28 112 13 149-45 35-55 92-64 169-27" /><circle cx="184" cy="191" r="9" /><circle cx="401" cy="148" r="9" /><circle cx="567" cy="121" r="9" /></svg>; }
function CapabilitiesNatureSketch() { return <svg viewBox="0 0 720 250" role="img" aria-label="A cedar canopy representing reusable capabilities"><path d="M356 225c7-41 8-87 2-139M358 114l-70-55M357 135l87-70M354 159l-114-25M359 173l120-18" /><path d="M286 60c-42 2-72 20-91 55 47 4 82-10 105-42M445 64c42 2 73 20 92 54-48 5-83-9-106-41M238 132c-38 10-62 34-72 70 45-4 75-24 91-61M479 153c37 9 63 31 77 66-46-1-78-20-96-56" /></svg>; }
function DecisionsNatureSketch() { return <svg viewBox="0 0 720 250" role="img" aria-label="Three tributaries converging into a chosen river"><path d="M91 39c82 25 120 62 115 112-3 35 28 58 92 68M271 26c-20 33-20 67 1 102 21 34 59 64 113 91M500 33c-54 18-82 49-84 94-1 38-22 69-64 92M298 219h279" /><circle cx="298" cy="219" r="8" /><circle cx="386" cy="219" r="8" /><circle cx="475" cy="219" r="8" /></svg>; }
function IncidentsNatureSketch() { return <svg viewBox="0 0 720 250" role="img" aria-label="A storm breaking over a recovery beacon"><path d="M125 126c-8-44 23-75 67-72 17-31 52-45 84-28 31-35 86-25 105 15 45-2 73 29 67 70 37 4 59 27 57 62H113c-25-12-27-32-17-48 7-12 16-19 29-21" /><path d="m285 129-36 57h43l-20 44 73-72h-46l26-29M520 198h95M568 198v-50M548 148h40" /></svg>; }
function CaseStudiesNatureSketch() { return <svg viewBox="0 0 720 250" role="img" aria-label="Layered canyon strata representing examined systems"><path d="M55 57h190l35 32 62 9 49-41h271v168H55Z" /><path d="M55 101c88 18 162 18 223 0 57-17 118-13 183 13 54 21 121 20 201-4M55 147c72 14 142 11 210-10 69-21 137-17 204 12 57 24 121 24 193 1M55 191c79 15 154 11 224-12 63-20 128-17 195 9 56 21 119 22 188 3" /><circle cx="211" cy="91" r="8" /><circle cx="417" cy="149" r="8" /><circle cx="559" cy="191" r="8" /></svg>; }
function StatisticsNatureSketch() { return <svg viewBox="0 0 720 250" role="img" aria-label="A measured sun transect across a landscape"><path d="M65 211c89-86 179-114 270-85 77 24 133 12 170-34 36-44 86-46 150-6" /><path d="M80 219h574M132 210v19M229 196v33M326 178v51M423 158v71M520 127v102M617 94v135" /><path d="M475 70a55 55 0 0 1 110 0" /><circle cx="530" cy="70" r="17" /></svg>; }

const ENGINEERING_NATURE_SKETCHES: Record<EngineeringView, ComponentType> = {
  journal: JournalNatureSketch,
  capabilities: CapabilitiesNatureSketch,
  decisions: DecisionsNatureSketch,
  incidents: IncidentsNatureSketch,
  "case-studies": CaseStudiesNatureSketch,
  statistics: StatisticsNatureSketch,
};

function EngineeringNatureSketch({ view }: { view: EngineeringView }) {
  const Sketch = ENGINEERING_NATURE_SKETCHES[view];
  return <Sketch />;
}

function EngineeringDestinationHero({ index, view }: { index: EngineeringJournalIndex; view: EngineeringView }) {
  const copy = ENGINEERING_HERO_COPY[view];
  const aggregates = useMemo(() => {
    let eligible = 0;
    let verified = 0;
    const repositories = new Set<string>();
    for (const record of index.records) {
      if (!viewRecord(record, view)) continue;
      eligible += 1;
      if (record.verification.state === "verified") verified += 1;
      repositories.add(record.repository);
    }
    return { eligible, verified, repositories: repositories.size };
  }, [index.records, view]);
  const stats = view === "journal"
    ? [["Factual records", index.statistics.totalRecords], ["Merged pull requests", index.receiptStatistics.totalReceipts], ["Repositories", Object.keys(index.statistics.byRepository).length]]
    : view === "statistics"
      ? [["Factual records", index.statistics.totalRecords], ["Verified", index.statistics.verification.verified], ["PR receipts", index.receiptStatistics.totalReceipts]]
      : [["Eligible records", aggregates.eligible], ["Verified", aggregates.verified], ["Repositories", aggregates.repositories]];
  return <header key={view} className={`engineering-hero engineering-hero-${view}`} style={{ "--engineering-accent": copy.accent } as CSSProperties}>
    <div className="engineering-hero-copy"><span>{copy.eyebrow}</span><h1>{copy.title}</h1><p>{copy.description}</p></div>
    <div className="engineering-hero-sketch"><EngineeringNatureSketch view={view} /></div>
    <span className="engineering-hero-pulse" aria-hidden="true" />
    <span className="engineering-hero-light-band" aria-hidden="true" />
    <dl>{stats.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  </header>;
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
  onBack,
  onToggleEvidence,
  evidenceOpen,
  contentsSection,
  onContentsSectionChange,
}: {
  record: EngineeringJournalRecord;
  onBack: () => void;
  onToggleEvidence: () => void;
  evidenceOpen: boolean;
  contentsSection: EngineeringContentsSection;
  onContentsSectionChange: (section: EngineeringContentsSection) => void;
}) {
  const readerRef = useRef<HTMLElement>(null);
  const readerBody = record.body.startsWith(record.summary)
    ? record.body.slice(record.summary.length).trim()
    : record.body;
  const contents: Array<[EngineeringContentsSection, string]> = [
    ["overview", "Overview"],
    ...(record.diagrams.length > 0 ? [["architecture", "Architecture"] as [EngineeringContentsSection, string]] : []),
    ["record", "Record"],
    ...(record.interviewView ? [["interview", "Interview view"] as [EngineeringContentsSection, string]] : []),
  ];
  const visit = (section: EngineeringContentsSection) => {
    onContentsSectionChange(section);
    readerRef.current?.querySelector<HTMLElement>(`[data-engineering-section="${section}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  return <article ref={readerRef} className="engineering-reader engineering-record-panel" aria-labelledby="engineering-record-title">
    <nav className="engineering-contents-nav" aria-label="Record contents">
      <div>{contents.map(([id, label]) => <button type="button" key={id} className={contentsSection === id ? "active" : ""} aria-current={contentsSection === id ? "location" : undefined} onClick={() => visit(id)}>{label}</button>)}</div>
      <div className="engineering-reader-panel-actions"><button type="button" onClick={onBack}>Index</button><button type="button" onClick={onToggleEvidence} aria-pressed={evidenceOpen} aria-label={evidenceOpen ? "Hide evidence and lineage" : "Open evidence and lineage"}>Evidence</button></div>
    </nav>
    <header className="engineering-reader-header" data-engineering-section="overview">
      <div className="engineering-record-classification">
        <span>{TYPE_LABELS[record.type]}</span>
        <i data-status={record.effectiveStatus}>{STATUS_LABELS[record.effectiveStatus]}</i>
        {record.reconstructed ? <i data-status="reconstructed">Reconstructed</i> : null}
      </div>
      <h1 id="engineering-record-title">{record.title}</h1>
      <p>{record.summary}</p>
    </header>

    <div className="engineering-reader-body">
      <dl className="engineering-facts">
        <div><dt>Modules</dt><dd>{record.modules.join(", ") || "Not recorded"}</dd></div>
        <div><dt>Interfaces</dt><dd>{record.interfaces.join(", ") || "Not recorded"}</dd></div>
        <div><dt>Capabilities</dt><dd>{record.capabilityIds.join(", ") || "Not recorded"}</dd></div>
        <div><dt>Verification</dt><dd>{record.verification.state === "verified" ? "Explicit evidence recorded" : "Not recorded"}</dd></div>
      </dl>

      {record.diagrams.length > 0 ? <section className="engineering-diagrams" data-engineering-section="architecture" aria-labelledby="engineering-diagrams-title">
        <header><h2 id="engineering-diagrams-title">Architecture diagrams</h2><p>Evidence-backed assets bundled from this record&apos;s exact Git revision.</p></header>
        {record.diagrams.map((diagram) => <figure key={`${diagram.sourcePath}:${diagram.renderedPath}`}>
          <a className="engineering-diagram-preview" href={diagram.renderedPermalink} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element -- the Journal must serve the exact commit-pinned generated bytes without an image optimizer rewrite */}
            <img src={diagram.renderedUrl} alt={diagram.summary} loading="lazy" decoding="async" />
          </a>
          <figcaption><strong>{diagram.title}</strong><span>{diagram.summary}</span><div><a href={diagram.renderedPermalink} target="_blank" rel="noreferrer"><EngineeringIcon name="source" />Exact rendered asset</a><a href={diagram.sourcePermalink} target="_blank" rel="noreferrer"><EngineeringIcon name="source" />Editable draw.io source</a></div></figcaption>
        </figure>)}
      </section> : null}

      <div className="engineering-markdown" data-engineering-section="record">
        <Markdown remarkPlugins={[remarkGfm]}>{readerBody}</Markdown>
      </div>

      {record.interviewView ? <details className="engineering-interview-view" data-engineering-section="interview">
        <summary>Interview view</summary>
        <Markdown remarkPlugins={[remarkGfm]}>{record.interviewView.body}</Markdown>
      </details> : null}

      <div className="engineering-actions">
        <button type="button" disabled aria-disabled="true" title="Available after the Learn runtime contract is released">Learn this</button>
        <small>Pending the released Learn revision, commit, and symbol contract.</small>
      </div>
    </div>
  </article>;
}

function EngineeringEvidencePanel({ record, index, onSelect, onReturn }: { record: EngineeringJournalRecord; index: EngineeringJournalIndex; onSelect: (ref: string) => void; onReturn: () => void }) {
  const corrections = [...record.amendedBy, ...record.supersededBy];
  const outgoing = [...record.amends, ...record.supersedes, ...record.relatedRecords, ...record.decisions, ...record.incidents, ...record.features];
  const backlinks = index.backlinks[record.ref] ?? [];
  const lineageRefs = [...new Set([...corrections, ...outgoing, ...backlinks])];
  const receiptByRef = useMemo(() => new Map(index.pullRequestReceipts.map((receipt) => [receipt.ref, receipt])), [index.pullRequestReceipts]);
  const relatedReceipts = (index.receiptBacklinks[record.ref] ?? [])
    .map((ref) => receiptByRef.get(ref))
    .filter((receipt): receipt is EngineeringPullRequestReceipt => Boolean(receipt));
  return <aside className="engineering-evidence-panel" aria-label="Evidence and lineage">
    <header><div><span>Evidence desk</span><h2>Exact evidence</h2></div><button type="button" onClick={onReturn} aria-label="Return to Engineering record">Record</button></header>
    <dl className="engineering-evidence-ledger">
      <div><dt>Record ref</dt><dd><code>{record.ref}</code><CopyControl value={record.ref} label="record reference" /></dd></div>
      <div><dt>Commit</dt><dd><code>{record.source.commit}</code><CopyControl value={record.source.commit} label="full commit" /></dd></div>
      <div><dt>Source path</dt><dd><code>{record.source.path}</code><CopyControl value={record.source.path} label="source path" /></dd></div>
      <div><dt>Verification</dt><dd><strong>{record.verification.state === "verified" ? "Explicit evidence" : "Not recorded"}</strong></dd></div>
    </dl>
    <a className="engineering-exact-source" href={record.source.permalink} target="_blank" rel="noreferrer"><EngineeringIcon name="source" />Open exact source</a>
    <section className="engineering-evidence-facts" aria-label="Record scope">
      <div><span>Modules</span><p>{record.modules.join(", ") || "Not recorded"}</p></div>
      <div><span>Interfaces</span><p>{record.interfaces.join(", ") || "Not recorded"}</p></div>
      <div><span>Capabilities</span><p>{record.capabilityIds.join(", ") || "Not recorded"}</p></div>
    </section>
    <section className="engineering-lineage" aria-labelledby="engineering-lineage-title">
      <h2 id="engineering-lineage-title">Immutable lineage</h2>
      <div className="engineering-lineage-current"><span aria-hidden="true" /><strong>{record.ref}</strong><small>{STATUS_LABELS[record.effectiveStatus]}</small></div>
      {lineageRefs.length > 0 ? <div className="engineering-lineage-links">{lineageRefs.map((ref) => <button type="button" key={ref} onClick={() => onSelect(ref)}>{ref}</button>)}</div> : <small>No linked revisions or backlinks.</small>}
    </section>
    <section className="engineering-evidence" aria-labelledby="engineering-evidence-title"><h2 id="engineering-evidence-title">Sources</h2><ul>{record.sources.map((source) => <li key={`${source.kind}:${source.url}`}><a href={source.url} target="_blank" rel="noreferrer">{source.label}<EngineeringIcon name="source" /></a><span>{source.kind}</span></li>)}</ul></section>
    {relatedReceipts.length > 0 ? <section className="engineering-record-receipts" aria-labelledby="engineering-record-receipts-title"><h2 id="engineering-record-receipts-title">Pull requests</h2><ul>{relatedReceipts.map((receipt) => <li key={receipt.ref}><div><span>{receipt.repository} · PR #{receipt.pr}</span><strong>{receipt.title}</strong></div><a href={receipt.source.permalink} target="_blank" rel="noreferrer">Receipt<EngineeringIcon name="source" /></a></li>)}</ul></section> : null}
  </aside>;
}

function EngineeringEmptyEvidencePanel({ view, onReturn }: { view: EngineeringView; onReturn: () => void }) {
  return <aside className="engineering-evidence-panel engineering-evidence-empty" aria-label="Exact evidence">
    <header><div><span>Evidence desk</span><h2>Exact evidence</h2></div><button type="button" onClick={onReturn} aria-label="Return to Engineering record">Record</button></header>
    <div className="engineering-evidence-empty-copy" role="status">
      <strong>No eligible record selected.</strong>
      <p>{view === "case-studies" ? "A released Feature Retrospective will open here with its exact commit, source path, and lineage." : "Choose an eligible record to inspect its exact evidence and lineage."}</p>
    </div>
  </aside>;
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
    <h1 id="engineering-statistics-title" className="sr-only">Engineering statistics</h1>
    <aside className="engineering-stat-panel engineering-stat-overview" aria-labelledby="engineering-stat-overview-title">
      <header><span>Coverage summary</span><h2 id="engineering-stat-overview-title">Truth at a glance</h2><p>Only explicit facts in the normalized Journal projection are counted.</p></header>
      <dl className="engineering-stat-metrics">
        <div><dt>Eligible records</dt><dd>{statistics.totalRecords}</dd></div>
        <div><dt>Explicitly verified</dt><dd>{statistics.verification.verified}</dd></div>
        <div><dt>With release refs</dt><dd>{statistics.recordsWithReleaseRefs}</dd></div>
        <div><dt>With run refs</dt><dd>{statistics.recordsWithRunRefs}</dd></div>
      </dl>
      <section className="engineering-stat-table engineering-date-range"><h3>Record range</h3><p>{dateRange}</p></section>
      <section className="engineering-stat-table"><h3>Effective status</h3><table><tbody>{Object.entries(statistics.byStatus).map(([status, count]) => <tr key={status}><th>{STATUS_LABELS[status as EngineeringRecordEffectiveStatus]}</th><td>{count}</td></tr>)}</tbody></table></section>
      <p className="engineering-stat-note">Release and run references are lineage, not verification receipts.</p>
    </aside>

    <section className="engineering-stat-panel engineering-stat-landscape" aria-labelledby="engineering-record-statistics-title">
      <header><span>Record landscape</span><h2 id="engineering-record-statistics-title">What the Journal can prove</h2><p>Curated architecture, decision, incident, capability, and retrospective records—kept distinct from compact pull-request receipts.</p></header>
      <div className="engineering-stat-landscape-grid">
        <section className="engineering-stat-table"><h3>Record types</h3><table><tbody>{Object.entries(statistics.byType).map(([type, count]) => <tr key={type}><th>{TYPE_LABELS[type as EngineeringRecordType]}</th><td>{count}</td></tr>)}</tbody></table></section>
        <section className="engineering-stat-table"><h3>Repositories</h3>{Object.keys(statistics.byRepository).length > 0 ? <table><tbody>{Object.entries(statistics.byRepository).map(([repository, count]) => <tr key={repository}><th>{repository}</th><td>{count}</td></tr>)}</tbody></table> : <p>No eligible repositories.</p>}</section>
        <section className="engineering-stat-table engineering-stat-capabilities"><h3>Capabilities</h3>{Object.keys(statistics.byCapability).length > 0 ? <table><tbody>{Object.entries(statistics.byCapability).map(([capability, count]) => <tr key={capability}><th>{capability}</th><td>{count}</td></tr>)}</tbody></table> : <p>No capability tags recorded.</p>}</section>
      </div>
      <section className="engineering-chronology"><h3>Record chronology</h3>{statistics.chronology.length > 0 ? <ol>{statistics.chronology.map((entry) => <li key={entry.ref}><span>{entry.createdAt}</span><strong>{entry.ref}</strong><small>{TYPE_LABELS[entry.type]} · {STATUS_LABELS[entry.status]}</small></li>)}</ol> : <p>No eligible records.</p>}</section>
    </section>

    <aside className="engineering-stat-panel engineering-stat-receipts" aria-labelledby="engineering-receipt-statistics-title">
      <header><span>Release coverage</span><h2 id="engineering-receipt-statistics-title">Pull-request receipts</h2><p>Every ingested merged PR stays visible, even when it does not warrant a rich narrative.</p></header>
      <dl className="engineering-stat-metrics">
        <div><dt>Projected</dt><dd>{receiptStatistics.totalReceipts}</dd></div>
        <div><dt>Complete facts</dt><dd>{receiptStatistics.totalReceipts - receiptStatistics.withMissingFacts}</dd></div>
        <div><dt>Reconstructed</dt><dd>{receiptStatistics.reconstructed}</dd></div>
        <div><dt>Missing facts</dt><dd>{receiptStatistics.withMissingFacts}</dd></div>
      </dl>
      <section className="engineering-stat-table engineering-date-range"><h3>Timeline range</h3><p>{receiptDateRange}</p></section>
      <section className="engineering-stat-table"><h3>Classification</h3><table><tbody>{Object.entries(receiptStatistics.byClassification).map(([classification, count]) => <tr key={classification}><th>{RECEIPT_CLASSIFICATION_LABELS[classification as EngineeringPullRequestClassification]}</th><td>{count}</td></tr>)}</tbody></table></section>
      <section className="engineering-stat-table"><h3>Repositories</h3>{Object.keys(receiptStatistics.byRepository).length > 0 ? <table><tbody>{Object.entries(receiptStatistics.byRepository).map(([repository, count]) => <tr key={repository}><th>{repository}</th><td>{count}</td></tr>)}</tbody></table> : <p>No projected repositories.</p>}</section>
      <section className="engineering-chronology engineering-receipt-chronology"><h3>Complete receipt chronology</h3>{receiptStatistics.chronology.length > 0 ? <ol>{receiptStatistics.chronology.map((entry) => <li key={entry.ref}><time dateTime={entry.timelineAt}>{entry.timelineAt.slice(0, 10)}</time><strong>{entry.repository} · PR #{entry.pr}</strong><small>{RECEIPT_CLASSIFICATION_LABELS[entry.classification]}</small></li>)}</ol> : <p>No projected receipts.</p>}</section>
    </aside>
  </section>;
}

type EngineeringWorkspaceMemory = {
  journalLayer: EngineeringJournalLayer;
  query: string;
  types: EngineeringRecordType[];
  statuses: EngineeringRecordEffectiveStatus[];
  repositories: string[];
  receiptQuery: string;
  receiptClassifications: EngineeringPullRequestClassification[];
  receiptRepositories: string[];
  selectedRef: string;
  mobileReaderOpen: boolean;
  evidenceOpen: boolean;
  contentsSection: EngineeringContentsSection;
  indexScrollTop: number;
};

const ENGINEERING_MEMORY_KEY = "interview-arc-engineering-workspace-v1";

function toggleFacet<T extends string>(selected: T[], value: T, setSelected: (next: T[]) => void) {
  setSelected(selected.includes(value) ? selected.filter((entry) => entry !== value) : [...selected, value]);
}

function readEngineeringMemory(): Partial<EngineeringWorkspaceMemory> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(ENGINEERING_MEMORY_KEY) ?? "{}") as Record<string, unknown>;
    const stringArray = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
    const types = stringArray(parsed.types).filter((entry): entry is EngineeringRecordType => entry in TYPE_LABELS);
    const statuses = stringArray(parsed.statuses).filter((entry): entry is EngineeringRecordEffectiveStatus => entry in STATUS_LABELS);
    const receiptClassifications = stringArray(parsed.receiptClassifications).filter((entry): entry is EngineeringPullRequestClassification => entry in RECEIPT_CLASSIFICATION_LABELS);
    return {
      journalLayer: parsed.journalLayer === "receipts" ? "receipts" : "records",
      query: typeof parsed.query === "string" ? parsed.query : "",
      types,
      statuses,
      repositories: stringArray(parsed.repositories),
      receiptQuery: typeof parsed.receiptQuery === "string" ? parsed.receiptQuery : "",
      receiptClassifications,
      receiptRepositories: stringArray(parsed.receiptRepositories),
      selectedRef: typeof parsed.selectedRef === "string" ? parsed.selectedRef : "",
      mobileReaderOpen: parsed.mobileReaderOpen !== false,
      evidenceOpen: typeof parsed.evidenceOpen === "boolean" ? parsed.evidenceOpen : undefined,
      contentsSection: parsed.contentsSection === "architecture" || parsed.contentsSection === "record" || parsed.contentsSection === "interview" ? parsed.contentsSection : "overview",
      indexScrollTop: typeof parsed.indexScrollTop === "number" && Number.isFinite(parsed.indexScrollTop) ? Math.max(0, parsed.indexScrollTop) : 0,
    };
  } catch {
    return {};
  }
}

export default function EngineeringWorkspace({ index, view, onNavigateView }: { index: EngineeringJournalIndex; view: EngineeringView; onNavigateView: (view: EngineeringView) => void }) {
  const [journalLayer, setJournalLayer] = useState<EngineeringJournalLayer>("records");
  const [query, setQuery] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<EngineeringRecordType[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<EngineeringRecordEffectiveStatus[]>([]);
  const [selectedRepositories, setSelectedRepositories] = useState<string[]>([]);
  const [receiptQuery, setReceiptQuery] = useState("");
  const [selectedReceiptClassifications, setSelectedReceiptClassifications] = useState<EngineeringPullRequestClassification[]>([]);
  const [selectedReceiptRepositories, setSelectedReceiptRepositories] = useState<string[]>([]);
  const [selectedRef, setSelectedRef] = useState(index.records[0]?.ref ?? "");
  const [mobileReaderOpen, setMobileReaderOpen] = useState(true);
  const [evidenceOpen, setEvidenceOpen] = useState(true);
  const [contentsSection, setContentsSection] = useState<EngineeringContentsSection>("overview");
  const [memoryReady, setMemoryReady] = useState(false);
  const recordListRef = useRef<HTMLDivElement>(null);
  const indexScrollTopRef = useRef(0);
  const scrollPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchByRef = useMemo(() => new Map(index.search.map((entry) => [entry.ref, entry])), [index.search]);
  const repositories = useMemo(() => [...new Set(index.records.map((record) => record.repository))].sort(), [index.records]);
  const receiptSearchByRef = useMemo(() => new Map(index.receiptSearch.map((entry) => [entry.ref, entry])), [index.receiptSearch]);
  const receiptRepositories = useMemo(() => [...new Set(index.pullRequestReceipts.map((receipt) => receipt.repository))].sort(), [index.pullRequestReceipts]);
  const records = useMemo(() => index.records.filter((record) => {
    const search = searchByRef.get(record.ref);
    return viewRecord(record, view)
      && (view !== "journal" || selectedTypes.length === 0 || selectedTypes.includes(record.type))
      && (view !== "journal" || selectedStatuses.length === 0 || selectedStatuses.includes(record.effectiveStatus))
      && (view !== "journal" || selectedRepositories.length === 0 || selectedRepositories.includes(record.repository))
      && (view !== "journal" || !query.trim() || search?.text.includes(query.trim().toLowerCase()));
  }), [index.records, query, searchByRef, selectedRepositories, selectedStatuses, selectedTypes, view]);
  const receipts = useMemo(() => index.pullRequestReceipts.filter((receipt) => {
    const search = receiptSearchByRef.get(receipt.ref);
    return (selectedReceiptClassifications.length === 0 || selectedReceiptClassifications.includes(receipt.classification))
      && (selectedReceiptRepositories.length === 0 || selectedReceiptRepositories.includes(receipt.repository))
      && (!receiptQuery.trim() || search?.text.includes(receiptQuery.trim().toLowerCase()));
  }), [index.pullRequestReceipts, receiptQuery, receiptSearchByRef, selectedReceiptClassifications, selectedReceiptRepositories]);

  useLayoutEffect(() => {
    const memory = readEngineeringMemory();
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const rememberedLayer = memory.journalLayer ?? "records";
      setJournalLayer(rememberedLayer);
      setQuery(memory.query ?? "");
      setSelectedTypes(memory.types ?? []);
      setSelectedStatuses(memory.statuses ?? []);
      setSelectedRepositories(memory.repositories ?? []);
      setReceiptQuery(memory.receiptQuery ?? "");
      setSelectedReceiptClassifications(memory.receiptClassifications ?? []);
      setSelectedReceiptRepositories(memory.receiptRepositories ?? []);
      if (index.records.some((record) => record.ref === memory.selectedRef)) setSelectedRef(memory.selectedRef!);
      const narrowReader = window.matchMedia("(max-width: 760px)").matches;
      setMobileReaderOpen(rememberedLayer === "receipts" ? false : narrowReader ? true : memory.mobileReaderOpen ?? false);
      const narrowWorkbench = window.matchMedia("(max-width: 1320px)").matches;
      setEvidenceOpen(narrowWorkbench ? false : memory.evidenceOpen ?? true);
      setContentsSection(memory.contentsSection ?? "overview");
      indexScrollTopRef.current = memory.indexScrollTop ?? 0;
      setMemoryReady(true);
    });
    return () => { cancelled = true; };
  }, [index.records]);

  useLayoutEffect(() => {
    if (!memoryReady || !recordListRef.current) return;
    recordListRef.current.scrollTop = indexScrollTopRef.current;
  }, [journalLayer, memoryReady]);

  const writeMemory = useCallback(() => {
    if (!memoryReady) return;
    try {
      const next: EngineeringWorkspaceMemory = { journalLayer, query, types: selectedTypes, statuses: selectedStatuses, repositories: selectedRepositories, receiptQuery, receiptClassifications: selectedReceiptClassifications, receiptRepositories: selectedReceiptRepositories, selectedRef, mobileReaderOpen, evidenceOpen, contentsSection, indexScrollTop: indexScrollTopRef.current };
      window.sessionStorage.setItem(ENGINEERING_MEMORY_KEY, JSON.stringify(next));
    } catch {
      // Session storage can be unavailable in hardened browsing contexts; in-memory state remains active.
    }
  }, [contentsSection, evidenceOpen, journalLayer, memoryReady, mobileReaderOpen, query, receiptQuery, selectedReceiptClassifications, selectedReceiptRepositories, selectedRef, selectedRepositories, selectedStatuses, selectedTypes]);

  useEffect(() => {
    writeMemory();
  }, [writeMemory]);

  useEffect(() => () => {
    if (scrollPersistTimerRef.current) window.clearTimeout(scrollPersistTimerRef.current);
  }, []);

  const rememberIndexScroll = (scrollTop: number) => {
    indexScrollTopRef.current = scrollTop;
    if (scrollPersistTimerRef.current) window.clearTimeout(scrollPersistTimerRef.current);
    scrollPersistTimerRef.current = window.setTimeout(() => {
      scrollPersistTimerRef.current = null;
      writeMemory();
    }, 160);
  };

  if (view === "statistics") return <div className="engineering-destination engineering-destination-statistics"><EngineeringDestinationHero index={index} view={view} /><EngineeringStatistics index={index} /></div>;
  const activeSelectedRef = records.some((record) => record.ref === selectedRef) ? selectedRef : records[0]?.ref;
  const selected = index.records.find((record) => record.ref === activeSelectedRef) ?? null;
  const select = (ref: string) => { setSelectedRef(ref); setContentsSection("overview"); setMobileReaderOpen(true); };
  const openRelation = (ref: string) => {
    setJournalLayer("records");
    setQuery("");
    setSelectedTypes([]);
    setSelectedStatuses([]);
    setSelectedRepositories([]);
    setSelectedRef(ref);
    setContentsSection("overview");
    setMobileReaderOpen(true);
    if (view !== "journal") onNavigateView("journal");
  };
  const showReceipts = view === "journal" && journalLayer === "receipts";
  const chooseJournalLayer = (next: EngineeringJournalLayer) => {
    setJournalLayer(next);
    if (next === "receipts") setMobileReaderOpen(false);
  };

  const displayEvidence = evidenceOpen;

  return <div className={`engineering-destination engineering-destination-${view}`}><EngineeringDestinationHero index={index} view={view} /><section className={`engineering-workspace ${mobileReaderOpen ? "mobile-reader-open" : ""} ${displayEvidence ? "evidence-open" : "evidence-closed"}`}>
    <aside className="engineering-index-panel engineering-records" aria-label={`${ENGINEERING_VIEW_TITLES[view]} ${showReceipts ? "pull-request receipts" : "rich records"}`}>
      <header><div><h1>{ENGINEERING_VIEW_TITLES[view].replace("Engineering · ", "")}</h1><p>{showReceipts ? `${receipts.length} of ${index.receiptStatistics.totalReceipts} pull-request receipts` : `${records.length} factual ${records.length === 1 ? "record" : "records"}`}</p></div></header>
      {view === "journal" ? <div className="engineering-journal-layers" role="group" aria-label="Journal evidence layer">
        <button type="button" aria-pressed={journalLayer === "records"} onClick={() => chooseJournalLayer("records")}><span>Rich records</span><strong>{index.statistics.totalRecords}</strong></button>
        <button type="button" aria-pressed={journalLayer === "receipts"} onClick={() => chooseJournalLayer("receipts")}><span>All merged PRs</span><strong>{index.receiptStatistics.totalReceipts}</strong></button>
      </div> : null}
      {view === "journal" && !showReceipts ? <div className="engineering-filters">
        <div className="engineering-filter-rail">
          <label className="engineering-search"><EngineeringIcon name="search" /><span className="sr-only">Search Engineering records</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search records, modules, issues…" /></label>
          <details className="engineering-filter-menu">
            <summary aria-label="Filter Engineering records"><EngineeringIcon name="filter" /><span>{selectedTypes.length + selectedStatuses.length + selectedRepositories.length || "Filter"}</span></summary>
            <div className="engineering-filter-popover">
              <fieldset><legend>Type</legend>{Object.entries(TYPE_LABELS).map(([value, label]) => <button type="button" key={value} aria-pressed={selectedTypes.includes(value as EngineeringRecordType)} onClick={() => toggleFacet(selectedTypes, value as EngineeringRecordType, setSelectedTypes)}>{label}</button>)}</fieldset>
              <fieldset><legend>Status</legend>{Object.entries(STATUS_LABELS).map(([value, label]) => <button type="button" key={value} aria-pressed={selectedStatuses.includes(value as EngineeringRecordEffectiveStatus)} onClick={() => toggleFacet(selectedStatuses, value as EngineeringRecordEffectiveStatus, setSelectedStatuses)}>{label}</button>)}</fieldset>
              <fieldset><legend>Repository</legend>{repositories.map((value) => <button type="button" key={value} aria-pressed={selectedRepositories.includes(value)} onClick={() => toggleFacet(selectedRepositories, value, setSelectedRepositories)}>{value}</button>)}</fieldset>
              <button type="button" className="engineering-filter-reset" onClick={() => { setSelectedTypes([]); setSelectedStatuses([]); setSelectedRepositories([]); }}>Reset filters</button>
            </div>
          </details>
        </div>
      </div> : null}
      {showReceipts ? <div className="engineering-filters engineering-receipt-filters">
        <div className="engineering-filter-rail">
          <label className="engineering-search"><EngineeringIcon name="search" /><span className="sr-only">Search pull-request receipts</span><input value={receiptQuery} onChange={(event) => setReceiptQuery(event.target.value)} placeholder="Search PR, title, source…" /></label>
          <details className="engineering-filter-menu">
            <summary aria-label="Filter pull-request receipts"><EngineeringIcon name="filter" /><span>{selectedReceiptClassifications.length + selectedReceiptRepositories.length || "Filter"}</span></summary>
            <div className="engineering-filter-popover">
              <fieldset><legend>Classification</legend>{Object.entries(RECEIPT_CLASSIFICATION_LABELS).map(([value, label]) => <button type="button" key={value} aria-pressed={selectedReceiptClassifications.includes(value as EngineeringPullRequestClassification)} onClick={() => toggleFacet(selectedReceiptClassifications, value as EngineeringPullRequestClassification, setSelectedReceiptClassifications)}>{label}</button>)}</fieldset>
              <fieldset><legend>Repository</legend>{receiptRepositories.map((value) => <button type="button" key={value} aria-pressed={selectedReceiptRepositories.includes(value)} onClick={() => toggleFacet(selectedReceiptRepositories, value, setSelectedReceiptRepositories)}>{value}</button>)}</fieldset>
              <button type="button" className="engineering-filter-reset" onClick={() => { setSelectedReceiptClassifications([]); setSelectedReceiptRepositories([]); }}>Reset filters</button>
            </div>
          </details>
        </div>
      </div> : null}
      {showReceipts ? <ReceiptTimeline receipts={receipts} onOpenRecord={openRelation} /> : <div ref={recordListRef} className="engineering-record-list" onScroll={(event) => rememberIndexScroll(event.currentTarget.scrollTop)}>
        {records.map((record) => <button type="button" key={record.ref} className={record.ref === selected?.ref ? "active" : ""} aria-current={record.ref === selected?.ref ? "true" : undefined} onClick={() => select(record.ref)}>
          <span><i>{TYPE_LABELS[record.type]}</i><time>{record.createdAt}</time></span>
          <strong>{record.title}</strong>
          <small>{record.repository} · {record.ref}</small>
          <em data-status={record.effectiveStatus}>{STATUS_LABELS[record.effectiveStatus]}</em>
        </button>)}
        {records.length === 0 ? <EmptyEngineeringView view={view} /> : null}
      </div>}
    </aside>
    {selected ? <RecordReader record={selected} onBack={() => setMobileReaderOpen(false)} onToggleEvidence={() => setEvidenceOpen((open) => !open)} evidenceOpen={evidenceOpen} contentsSection={contentsSection} onContentsSectionChange={setContentsSection} /> : <div className="engineering-reader engineering-record-panel engineering-reader-empty"><EmptyEngineeringView view={view} /></div>}
    {selected ? <EngineeringEvidencePanel record={selected} index={index} onSelect={openRelation} onReturn={() => setEvidenceOpen(false)} /> : <EngineeringEmptyEvidencePanel view={view} onReturn={() => setEvidenceOpen(false)} />}
  </section></div>;
}
