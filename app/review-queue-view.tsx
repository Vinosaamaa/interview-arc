"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  filterReviewQueue,
  type ReviewQueueHorizon,
  type ReviewQueueItem,
  type ReviewQueueSpecialty,
} from "../db/review-queue-policy";
import {
  EMPTY_REVIEW_QUEUE_UI_STATE,
  parseReviewQueueUiState,
  REVIEW_QUEUE_UI_STORAGE_KEY,
  type ReviewQueueUiState,
} from "./review-queue-state";

type ReviewQueueViewProps = {
  items: ReviewQueueItem[];
  loading: boolean;
  stale: boolean;
  errorMessage: string | null;
  reviewStreak: number;
  blockedQuestionIds: Set<string>;
  blockedTitles: Set<string>;
  pendingReviewKeys: Set<string>;
  canAddToToday: boolean;
  onAddToToday: (items: ReviewQueueItem[]) => void;
  onDefer: (item: ReviewQueueItem) => void;
  onOpenAttempt: (item: ReviewQueueItem) => void;
  onDismissError: () => void;
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
  errorMessage,
  reviewStreak,
  blockedQuestionIds,
  blockedTitles,
  pendingReviewKeys,
  canAddToToday,
  onAddToToday,
  onDefer,
  onOpenAttempt,
  onDismissError,
}: ReviewQueueViewProps) {
  const [uiState, setUiState] = useState<ReviewQueueUiState>(() => (
    typeof window === "undefined"
      ? EMPTY_REVIEW_QUEUE_UI_STATE
      : parseReviewQueueUiState(window.sessionStorage.getItem(REVIEW_QUEUE_UI_STORAGE_KEY))
  ));
  const { search, specialties, due, sort, selectedKeys } = uiState;
  const folioRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; scrollLeft: number } | null>(null);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(REVIEW_QUEUE_UI_STORAGE_KEY, JSON.stringify(uiState));
    } catch {
      // Browsers may disable session storage; the in-memory state still works.
    }
  }, [uiState]);

  const itemsByKey = useMemo(() => new Map(items.map((item) => [item.reviewKey, item])), [items]);
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  useEffect(() => {
    if (loading) return;
    const frame = window.requestAnimationFrame(() => setUiState((current) => ({
      ...current,
      selectedKeys: current.selectedKeys.filter((key) => itemsByKey.has(key)),
    })));
    return () => window.cancelAnimationFrame(frame);
  }, [itemsByKey, loading]);

  const visibleItems = useMemo(() => filterReviewQueue(items, {
    search,
    specialties: new Set(specialties),
    due,
    sort,
  }), [due, items, search, sort, specialties]);
  const selectedItems = selectedKeys.flatMap((key) => itemsByKey.get(key) ?? []);
  const selectedMinutes = selectedItems.reduce((total, item) => total + item.estimatedMinutes, 0);
  const totalMinutes = items.reduce((total, item) => total + item.estimatedMinutes, 0);
  const dueNowCount = items.filter((item) => item.horizon === "now").length;
  const activeFilterCount = specialties.length + (due === "all" ? 0 : 1) + (sort === "priority" ? 0 : 1) + (search ? 1 : 0);
  const isBlocked = (item: ReviewQueueItem) => (
    Boolean(item.questionId && blockedQuestionIds.has(item.questionId))
    || blockedTitles.has(identity(item.title))
  );
  const addableSelected = selectedItems.filter((item) => !isBlocked(item) && !pendingReviewKeys.has(item.reviewKey));

  const updateUiState = <Key extends keyof ReviewQueueUiState,>(key: Key, value: ReviewQueueUiState[Key]) => {
    setUiState((current) => ({ ...current, [key]: value }));
  };
  const toggleSpecialty = (specialty: ReviewQueueSpecialty) => setUiState((current) => ({
    ...current,
    specialties: current.specialties.includes(specialty)
      ? current.specialties.filter((candidate) => candidate !== specialty)
      : [...current.specialties, specialty],
  }));
  const toggleSelection = (reviewKey: string) => setUiState((current) => ({
    ...current,
    selectedKeys: current.selectedKeys.includes(reviewKey)
      ? current.selectedKeys.filter((candidate) => candidate !== reviewKey)
      : [...current.selectedKeys, reviewKey],
  }));
  const resetFilters = () => {
    setUiState((current) => ({
      ...current,
      search: "",
      specialties: [],
      due: "all",
      sort: "priority",
    }));
  };
  const moveFolio = (direction: -1 | 1) => folioRef.current?.scrollBy({
    left: direction * Math.max(220, folioRef.current.clientWidth * .7),
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });

  return (
    <div className="review-queue-container"><section className="review-queue-page">
      <header className="review-queue-masthead">
        <div className="review-hero-copy">
          <span className="eyebrow">INTERVIEW · REVIEW QUEUE</span>
          <h1>Strengthen what you practiced.</h1>
          <p>A focused second pass turns finished work into recall you can trust.</p>
        </div>
        <dl className="review-summary-strip" aria-label="Review queue summary">
          <div><dt>due now</dt><dd>{dueNowCount}</dd></div>
          <div><dt>estimated review</dt><dd>{totalMinutes < 60 ? `${totalMinutes}m` : `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`}</dd></div>
          <div><dt>review streak</dt><dd>{reviewStreak} day{reviewStreak === 1 ? "" : "s"}</dd></div>
        </dl>
      </header>

      <div className="review-queue-controls">
        <div className="review-filter-rail" role="group" aria-label="Filter reviews by specialty">
          <button type="button" aria-pressed={specialties.length === 0} onClick={() => setUiState((current) => ({ ...current, specialties: [] }))}>All</button>
          {SPECIALTIES.map((specialty) => <button type="button" key={specialty.value} aria-pressed={specialties.includes(specialty.value)} onClick={() => toggleSpecialty(specialty.value)}>{specialty.label}</button>)}
          <details className="review-expanded-controls control-menu">
            <summary aria-label={`More review filters, ${activeFilterCount} active`} title="More filters"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4" /></svg>{activeFilterCount > 0 && <i>{activeFilterCount}</i>}</summary>
            <div>
            <fieldset><legend>Due date</legend>{([['now', 'Due now'], ['week', '7 days'], ['month', '30 days'], ['all', 'Any']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={due === value} onClick={() => updateUiState("due", value)}>{label}</button>)}</fieldset>
            <fieldset><legend>Sort by</legend>{([['priority', 'Priority'], ['due', 'Due date'], ['review_time', 'Review time'], ['last_attempt', 'Last attempt']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={sort === value} onClick={() => updateUiState("sort", value)}>{label}</button>)}</fieldset>
            <footer><button type="button" onClick={resetFilters} disabled={activeFilterCount === 0}>Reset</button><span>{visibleItems.length} item{visibleItems.length === 1 ? "" : "s"}</span></footer>
            </div>
          </details>
        </div>
        <label className="review-search-bar">
          <svg aria-hidden="true" viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m12.8 12.8 4.2 4.2" /></svg>
          <input type="search" value={search} onChange={(event) => updateUiState("search", event.target.value)} placeholder="Search reviews" aria-label="Search review queue" />
          <span aria-live="polite">{visibleItems.length} items</span>
        </label>
      </div>

      <div className="review-status-stack">
        {errorMessage && <div className="review-queue-error" role="alert"><div><strong>That queue change was not saved.</strong><span>{errorMessage} The queue has been refreshed from D1.</span></div><button type="button" onClick={onDismissError}>Dismiss</button></div>}
        {stale && <div className="review-queue-stale" role="status"><strong>Showing the last saved queue.</strong><span>Interview Arc will reconcile with D1 when the connection returns. Add and defer actions stay in the retry queue.</span></div>}
      </div>

      <div className="review-queue-sheet" aria-busy={loading}>
        {loading ? <div className="review-queue-loading" aria-label="Loading review queue">{Array.from({ length: 4 }, (_, index) => <span key={index} />)}</div> : items.length === 0 ? <div className="review-queue-empty"><i aria-hidden="true">✓</i><div><strong>Nothing needs another pass.</strong><span>Completed attempts return here when their next recall window opens.</span></div></div> : visibleItems.length === 0 ? <div className="review-queue-empty filtered"><div><strong>No reviews match these filters.</strong><button type="button" onClick={resetFilters}>Reset filters</button></div></div> : <div className="recall-spine">
          {HORIZONS.map((horizon) => {
            const groupItems = visibleItems.filter((item) => item.horizon === horizon.value);
            if (!groupItems.length) return null;
            return <section className={`recall-group ${horizon.value}`} key={horizon.value} aria-labelledby={`review-${horizon.value}`}>
              <header><div><h2 id={`review-${horizon.value}`}>{horizon.label}</h2><p>{horizon.note}</p></div></header>
              <div className="recall-rows">{groupItems.map((item) => {
                const selected = selectedKeySet.has(item.reviewKey);
                const blocked = isBlocked(item);
                const pending = pendingReviewKeys.has(item.reviewKey);
                const specialtyInitial = item.specialty === "leetcode" ? "C" : item.specialty === "system_design" ? "S" : "B";
                return <article className={`review-row ${item.specialty} ${selected ? "selected" : ""}`} key={item.reviewKey}>
                  <button type="button" className="review-select" aria-pressed={selected} aria-label={`${selected ? "Remove" : "Select"} ${item.title}`} onClick={() => toggleSelection(item.reviewKey)}><span aria-hidden="true">{selected ? "✓" : specialtyInitial}</span></button>
                  <span className="review-select-slot" aria-hidden="true" />
                  <div className="review-row-copy review-row-static"><small>{specialtyLabel(item.specialty)} · {horizon.label}</small><strong>{item.title}</strong><p>{item.reasonLabel}</p></div>
                  <div className="review-row-meta review-row-static"><span className={`review-outcome-chip ${item.previousResult}`}>{resultLabel(item.previousResult)}</span><span>Due {compactDate(item.dueDate)}</span><span>{item.estimatedMinutes} min</span></div>
                  <div className="review-actions review-icon-actions">
                    <button type="button" className="review-add" title={pending ? "Adding to Today" : blocked ? "Already on Today" : "Add to Today"} aria-label={pending ? `Adding ${item.title} to Today` : blocked ? `${item.title} is already on Today` : `Add ${item.title} to Today`} disabled={!canAddToToday || blocked || pending} onClick={() => onAddToToday([item])}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg></button>
                    <button type="button" title="Open previous attempt" aria-label={`Open previous attempt for ${item.title}`} onClick={() => onOpenAttempt(item)}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 4h9l3 3v13H6z" /><path d="M15 4v4h4M9 12h6M9 16h6" /></svg></button>
                    <button type="button" title="Review next week" aria-label={`Defer ${item.title} until next week`} disabled={pending} onClick={() => onDefer(item)}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 3v3M18 3v3M4 9h16M5 5h14v15H5z" /><path d="m10 14 2 2 4-4" /></svg></button>
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
        <div className="folio-bookmarks" ref={folioRef} tabIndex={0} aria-label="Selected review bookmarks" onWheel={(event) => { if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && folioRef.current) { folioRef.current.scrollLeft += event.deltaY; event.preventDefault(); } }} onKeyDown={(event) => { if (event.key === "ArrowLeft") moveFolio(-1); if (event.key === "ArrowRight") moveFolio(1); }} onPointerDown={(event) => { const target = event.target as Element; if (!folioRef.current || event.button !== 0 || target.closest("button, a, input, select, textarea, summary")) return; dragRef.current = { x: event.clientX, scrollLeft: folioRef.current.scrollLeft }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!dragRef.current || !folioRef.current) return; folioRef.current.scrollLeft = dragRef.current.scrollLeft - (event.clientX - dragRef.current.x); }} onPointerUp={(event) => { dragRef.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { dragRef.current = null; }} onLostPointerCapture={() => { dragRef.current = null; }}>
          {selectedItems.length ? selectedItems.map((item) => <div className={`folio-bookmark ${item.specialty}`} key={item.reviewKey}><span aria-hidden="true">{item.specialty === "leetcode" ? "C" : item.specialty === "system_design" ? "S" : "B"}</span><div><strong>{item.title}</strong><small>{item.estimatedMinutes} min</small></div><button type="button" onClick={() => toggleSelection(item.reviewKey)} aria-label={`Remove ${item.title} from selection`}>×</button></div>) : <span className="folio-empty">Choose reviews above. The queue will not move.</span>}
        </div>
        <button type="button" className="folio-arrow" onClick={() => moveFolio(1)} aria-label="Scroll selected reviews right">→</button>
        <button type="button" className="folio-add" disabled={!canAddToToday || addableSelected.length === 0} onClick={() => { onAddToToday(addableSelected); setUiState((current) => ({ ...current, selectedKeys: current.selectedKeys.filter((key) => !addableSelected.some((item) => item.reviewKey === key)) })); }}>Add selected to Today <span aria-hidden="true">→</span></button>
      </aside>
    </section></div>
  );
}
