"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  filterReviewQueue,
  type ReviewQueueHorizon,
  type ReviewQueueItem,
  type ReviewQueueSpecialty,
} from "../db/review-queue-policy";

type ReviewQueueViewProps = {
  items: ReviewQueueItem[];
  loading: boolean;
  stale: boolean;
  reviewStreak: number;
  blockedQuestionIds: Set<string>;
  blockedTitles: Set<string>;
  pendingReviewKeys: Set<string>;
  canAddToToday: boolean;
  onAddToToday: (items: ReviewQueueItem[]) => void;
  onDefer: (item: ReviewQueueItem) => void;
  onOpenAttempt: (item: ReviewQueueItem) => void;
};

const SPECIALTIES: Array<{ value: ReviewQueueSpecialty; label: string }> = [
  { value: "leetcode", label: "Coding" },
  { value: "system_design", label: "System design" },
  { value: "behavioral", label: "Behavioral" },
];

const HORIZONS: Array<{ value: ReviewQueueHorizon; label: string; note: string }> = [
  { value: "now", label: "Review now", note: "The recall window is open." },
  { value: "soon", label: "Review soon", note: "The next window is approaching." },
  { value: "later", label: "Later", note: "Keep the next repetition visible." },
];

function specialtyLabel(value: ReviewQueueSpecialty) {
  return SPECIALTIES.find((item) => item.value === value)?.label ?? value;
}

function resultLabel(value: ReviewQueueItem["previousResult"]) {
  if (value === "solved") return "Solved";
  if (value === "solved_after_reviewing_approach") return "Solved with help";
  if (value === "failed") return "Failed";
  return "Result not recorded";
}

function compactDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T12:00:00Z`));
}

function identity(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export default function ReviewQueueView({
  items,
  loading,
  stale,
  reviewStreak,
  blockedQuestionIds,
  blockedTitles,
  pendingReviewKeys,
  canAddToToday,
  onAddToToday,
  onDefer,
  onOpenAttempt,
}: ReviewQueueViewProps) {
  const [search, setSearch] = useState("");
  const [specialties, setSpecialties] = useState<ReviewQueueSpecialty[]>([]);
  const [due, setDue] = useState<"all" | "now" | "week" | "month">("all");
  const [sort, setSort] = useState<"priority" | "due" | "review_time" | "last_attempt">("priority");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const folioRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; scrollLeft: number } | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setSelectedKeys((current) => (
      current.filter((key) => items.some((item) => item.reviewKey === key))
    )));
    return () => window.cancelAnimationFrame(frame);
  }, [items]);

  const visibleItems = useMemo(() => filterReviewQueue(items, {
    search,
    specialties: new Set(specialties),
    due,
    sort,
  }), [due, items, search, sort, specialties]);
  const selectedItems = selectedKeys.flatMap((key) => items.find((item) => item.reviewKey === key) ?? []);
  const selectedMinutes = selectedItems.reduce((total, item) => total + item.estimatedMinutes, 0);
  const totalMinutes = items.reduce((total, item) => total + item.estimatedMinutes, 0);
  const dueNowCount = items.filter((item) => item.horizon === "now").length;
  const activeFilterCount = specialties.length + (due === "all" ? 0 : 1) + (sort === "priority" ? 0 : 1) + (search ? 1 : 0);
  const isBlocked = (item: ReviewQueueItem) => (
    Boolean(item.questionId && blockedQuestionIds.has(item.questionId))
    || blockedTitles.has(identity(item.title))
  );
  const addableSelected = selectedItems.filter((item) => !isBlocked(item) && !pendingReviewKeys.has(item.reviewKey));

  const toggleSpecialty = (specialty: ReviewQueueSpecialty) => setSpecialties((current) => (
    current.includes(specialty)
      ? current.filter((candidate) => candidate !== specialty)
      : [...current, specialty]
  ));
  const toggleSelection = (reviewKey: string) => setSelectedKeys((current) => (
    current.includes(reviewKey)
      ? current.filter((candidate) => candidate !== reviewKey)
      : [...current, reviewKey]
  ));
  const resetFilters = () => {
    setSearch("");
    setSpecialties([]);
    setDue("all");
    setSort("priority");
  };
  const moveFolio = (direction: -1 | 1) => folioRef.current?.scrollBy({
    left: direction * Math.max(220, folioRef.current.clientWidth * .7),
    behavior: "smooth",
  });

  return (
    <section className="review-queue-page">
      <header className="review-queue-masthead">
        <div>
          <span className="eyebrow">PAST · REVIEW QUEUE</span>
          <h1>Review Queue</h1>
          <p>Return to completed work at the moment another pass can strengthen recall.</p>
        </div>
        <dl aria-label="Review queue summary">
          <div><dt>due now</dt><dd>{dueNowCount}</dd></div>
          <div><dt>estimated review</dt><dd>{totalMinutes < 60 ? `${totalMinutes}m` : `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`}</dd></div>
          <div><dt>review streak</dt><dd>{reviewStreak} day{reviewStreak === 1 ? "" : "s"}</dd></div>
        </dl>
      </header>

      <div className="review-queue-controls">
        <label className="review-search">
          <span aria-hidden="true">⌕</span>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search past attempts" aria-label="Search review queue" />
        </label>
        <select value={due} onChange={(event) => setDue(event.target.value as typeof due)} aria-label="Filter review queue by due date">
          <option value="all">Due: any</option><option value="now">Due now</option><option value="week">Within 7 days</option><option value="month">Within 30 days</option>
        </select>
        <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="Sort review queue">
          <option value="priority">Priority</option><option value="due">Due date</option><option value="review_time">Review time</option><option value="last_attempt">Last attempt</option>
        </select>
        <details className="review-expanded-controls">
          <summary aria-label={`Expanded review filters, ${activeFilterCount} active`}><span aria-hidden="true">☷</span>{activeFilterCount > 0 && <i>{activeFilterCount}</i>}</summary>
          <div>
            <fieldset><legend>Specialty</legend>{SPECIALTIES.map((specialty) => <button type="button" key={specialty.value} aria-pressed={specialties.includes(specialty.value)} onClick={() => toggleSpecialty(specialty.value)}>{specialty.label}</button>)}</fieldset>
            <fieldset><legend>Due date</legend>{([['now', 'Due now'], ['week', '7 days'], ['month', '30 days'], ['all', 'Any']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={due === value} onClick={() => setDue(value)}>{label}</button>)}</fieldset>
            <fieldset><legend>Sort by</legend>{([['priority', 'Priority'], ['due', 'Due date'], ['review_time', 'Review time'], ['last_attempt', 'Last attempt']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={sort === value} onClick={() => setSort(value)}>{label}</button>)}</fieldset>
            <footer><button type="button" onClick={resetFilters} disabled={activeFilterCount === 0}>Reset</button><span>{visibleItems.length} item{visibleItems.length === 1 ? "" : "s"}</span></footer>
          </div>
        </details>
      </div>

      <div className="review-specialty-rail" role="group" aria-label="Filter by specialty">
        {SPECIALTIES.map((specialty) => <button type="button" key={specialty.value} aria-pressed={specialties.includes(specialty.value)} onClick={() => toggleSpecialty(specialty.value)}>{specialty.label}</button>)}
        {activeFilterCount > 0 && <button type="button" className="review-reset" onClick={resetFilters}>Reset {activeFilterCount}</button>}
      </div>

      {stale && <div className="review-queue-stale" role="status"><strong>Showing the last saved queue.</strong><span>Interview Arc will reconcile with D1 when the connection returns. Add and defer actions stay in the retry queue.</span></div>}

      <div className="review-queue-sheet" aria-busy={loading}>
        {loading ? <div className="review-queue-loading" aria-label="Loading review queue">{Array.from({ length: 4 }, (_, index) => <span key={index} />)}</div> : items.length === 0 ? <div className="review-queue-empty"><i aria-hidden="true">✓</i><div><strong>Nothing needs another pass.</strong><span>Completed attempts return here when their next recall window opens.</span></div></div> : visibleItems.length === 0 ? <div className="review-queue-empty filtered"><div><strong>No reviews match these filters.</strong><button type="button" onClick={resetFilters}>Reset filters</button></div></div> : <div className="recall-spine">
          {HORIZONS.map((horizon) => {
            const groupItems = visibleItems.filter((item) => item.horizon === horizon.value);
            if (!groupItems.length) return null;
            return <section className={`recall-group ${horizon.value}`} key={horizon.value} aria-labelledby={`review-${horizon.value}`}>
              <header><span aria-hidden="true" /><div><h2 id={`review-${horizon.value}`}>{horizon.label}</h2><p>{horizon.note}</p></div></header>
              <div className="recall-rows">{groupItems.map((item) => {
                const selected = selectedKeys.includes(item.reviewKey);
                const blocked = isBlocked(item);
                const pending = pendingReviewKeys.has(item.reviewKey);
                return <article className={`review-row ${item.specialty} ${selected ? "selected" : ""}`} key={item.reviewKey}>
                  <button type="button" className="review-select" aria-pressed={selected} aria-label={`${selected ? "Remove" : "Select"} ${item.title}`} onClick={() => toggleSelection(item.reviewKey)}><span aria-hidden="true">{selected ? "✓" : ""}</span></button>
                  <span className="review-specialty-mark" aria-hidden="true">{item.specialty === "leetcode" ? "C" : item.specialty === "system_design" ? "S" : "B"}</span>
                  <div className="review-title"><small>{specialtyLabel(item.specialty)}</small><strong>{item.title}</strong></div>
                  <div className="review-result"><small>Previous result</small><strong>{resultLabel(item.previousResult)}</strong></div>
                  <div className="review-date"><small>Last attempt</small><strong>{compactDate(item.lastAttemptDate)}</strong><span>Due {compactDate(item.dueDate)}</span></div>
                  <div className="review-reason"><small>Why due</small><strong>{item.reasonLabel}</strong></div>
                  <div className="review-estimate"><small>Est. time</small><strong>{item.estimatedMinutes} min</strong></div>
                  <div className="review-actions">
                    <button type="button" className="review-add" disabled={!canAddToToday || blocked || pending} onClick={() => onAddToToday([item])}>{pending ? "Adding…" : blocked ? "On Today" : "Add to Today"}</button>
                    <button type="button" onClick={() => onOpenAttempt(item)}>Open previous attempt</button>
                    <button type="button" disabled={pending} onClick={() => onDefer(item)}>Review next week</button>
                  </div>
                </article>;
              })}</div>
            </section>;
          })}
        </div>}
      </div>

      <aside className="review-selection-folio" aria-label="Selected reviews for Today">
        <div className="folio-summary"><strong>Selected for Today</strong><span>{selectedItems.length} item{selectedItems.length === 1 ? "" : "s"} · {selectedMinutes} min</span></div>
        <button type="button" className="folio-arrow" onClick={() => moveFolio(-1)} aria-label="Scroll selected reviews left">←</button>
        <div className="folio-bookmarks" ref={folioRef} tabIndex={0} aria-label="Selected review bookmarks" onWheel={(event) => { if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && folioRef.current) { folioRef.current.scrollLeft += event.deltaY; event.preventDefault(); } }} onKeyDown={(event) => { if (event.key === "ArrowLeft") moveFolio(-1); if (event.key === "ArrowRight") moveFolio(1); }} onPointerDown={(event) => { if (!folioRef.current) return; dragRef.current = { x: event.clientX, scrollLeft: folioRef.current.scrollLeft }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!dragRef.current || !folioRef.current) return; folioRef.current.scrollLeft = dragRef.current.scrollLeft - (event.clientX - dragRef.current.x); }} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}>
          {selectedItems.length ? selectedItems.map((item) => <div className={`folio-bookmark ${item.specialty}`} key={item.reviewKey}><span aria-hidden="true">{item.specialty === "leetcode" ? "C" : item.specialty === "system_design" ? "S" : "B"}</span><div><strong>{item.title}</strong><small>{item.estimatedMinutes} min</small></div><button type="button" onClick={() => toggleSelection(item.reviewKey)} aria-label={`Remove ${item.title} from selection`}>×</button></div>) : <span className="folio-empty">Choose reviews above. The queue will not move.</span>}
        </div>
        <button type="button" className="folio-arrow" onClick={() => moveFolio(1)} aria-label="Scroll selected reviews right">→</button>
        <button type="button" className="folio-add" disabled={!canAddToToday || addableSelected.length === 0} onClick={() => { onAddToToday(addableSelected); setSelectedKeys((current) => current.filter((key) => !addableSelected.some((item) => item.reviewKey === key))); }}>Add selected to Today <span aria-hidden="true">→</span></button>
      </aside>
    </section>
  );
}
