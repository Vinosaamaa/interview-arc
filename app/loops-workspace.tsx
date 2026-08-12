"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchRoleBriefSource,
  parseJobDescription,
  type RoleBriefSourcePayload,
} from "./loop-role-brief-source";
import { loopWorkspaceHref, readLoopWorkspaceState } from "./journey-insights";

type Specialty = "leetcode" | "system_design" | "behavioral";
type MemoryConfidence = "exact" | "reconstructed";

type LoopQuestion = {
  memoryId: string;
  specialty: Specialty;
  canonicalQuestionId?: string;
  promptMemory?: string;
  promptConfidence: MemoryConfidence;
  answerMemory?: string;
  answerConfidence?: MemoryConfidence;
};

type LoopStage = {
  stageId: string;
  label: string;
  groupId?: string;
  groupLabel?: string;
  order: number;
  status: "planned" | "scheduled" | "completed" | "cancelled" | "skipped";
  scheduledAt?: number;
  startedAt?: number;
  completedAt?: number;
  cancelledAt?: number;
  outcome?: string;
  debrief?: {
    capturedAt: number;
    questions: LoopQuestion[];
    selfAssessment?: string;
    nextStep?: string;
  };
};

type LoopInterviewMaterial = {
  materialId: string;
  loopId: string;
  stageId?: string;
  kind: "interview_prep";
  state: "active" | "archived";
  label: string;
  summary?: string;
  sections: Array<{
    sectionId: string;
    title: string;
    body?: string;
    bullets: string[];
  }>;
  provenance: {
    kind: "owner_authorized_synthesis";
    roleBriefRevision: number;
    activityIds: string[];
    sourceLabel: string;
    preparedAt: number;
  };
  revision: number;
  createdAt: number;
  revisionCreatedAt: number;
  updatedAt: number;
};

type LoopProjection = {
  loop: {
    loopId: string;
    company: string;
    roleTitle: string;
    jobReference?: string;
    location?: string;
    state: "active" | "archived";
    status: "active" | "paused" | "completed" | "withdrawn";
    outcome: "offer" | "rejected" | "withdrawn" | "closed" | null;
    openedAt: number;
    revision: number;
    stages: LoopStage[];
  };
  roleBrief: {
    revision: number;
    label: string;
    company?: string;
    roleTitle?: string;
    targetLevel?: string;
    location?: string;
    responsibilities: string[];
    requiredQualifications: string[];
    preferredQualifications: string[];
    competencySignals: string[];
    seniorityIndicators: string[];
    domainVocabulary: string[];
    verifiedCompanySignals: Array<{ signal: string; sourceLabel: string; verifiedAt: number }>;
    unresolvedAmbiguities: string[];
    source: {
      kind: "pasted_jd" | "public_posting";
      displayLocator: string;
      capturedAt: number;
      fingerprint: string;
    };
  };
  activityBindings: Array<{
    activityId: string;
    stageId: string | null;
    roleBriefRevision: number;
    specialty: Specialty;
    questionId: string;
    title: string;
    completed: boolean;
  }>;
  activityHistory: Array<{
    activityId: string;
    stageId: string | null;
    roleBriefRevision: number;
    specialty: Specialty;
    questionId: string;
    result: "solved" | "solved_after_reviewing_approach" | "failed";
    completedAt: number;
  }>;
  interviewMaterials: LoopInterviewMaterial[];
};

export type LoopJourneyFacts = {
  loopCount: number;
  activeLoopCount: number;
  stageCount: number;
  completedStageCount: number;
  scheduledStageCount: number;
  interviewDateCount: number;
  outcomes: {
    offer: number;
    rejected: number;
    withdrawn: number;
    closed: number;
    unresolved: number;
  };
};

type LoopPayload = {
  loops: LoopProjection[];
  truncated: boolean;
  facts: LoopJourneyFacts;
  migrationInbox: unknown[];
};

async function fetchLoopPayload(includeArchived: boolean, signal?: AbortSignal) {
  const response = await fetch(`/api/loops?includeArchived=${includeArchived}`, { cache: "no-store", signal });
  const body = await response.json() as LoopPayload & { error?: string };
  if (!response.ok) throw new Error(body.error || "Loop state is unavailable.");
  return body;
}

function formatDate(value?: number) {
  if (!value) return "Not dated";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(new Date(value));
}

function sentenceId(value: string) {
  return value.replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stageDate(stage: LoopStage) {
  return stage.completedAt ?? stage.startedAt ?? stage.scheduledAt ?? stage.cancelledAt;
}

function useLoopPayload(includeArchived = false) {
  const [reloadKey, setReloadKey] = useState(0);
  const requestKey = `${includeArchived}:${reloadKey}`;
  const [result, setResult] = useState<{
    requestKey: string;
    includeArchived: boolean;
    payload: LoopPayload | null;
    error: string;
  }>({ requestKey: "", includeArchived, payload: null, error: "" });
  useEffect(() => {
    const controller = new AbortController();
    void fetchLoopPayload(includeArchived, controller.signal).then(
      (payload) => setResult({ requestKey, includeArchived, payload, error: "" }),
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          requestKey,
          includeArchived,
          payload: null,
          error: cause instanceof Error ? cause.message : "Loop state is unavailable.",
        });
      },
    );
    return () => controller.abort();
  }, [includeArchived, requestKey]);
  return {
    payload: result.includeArchived === includeArchived ? result.payload : null,
    error: result.requestKey === requestKey ? result.error : "",
    loading: result.requestKey !== requestKey,
    reload: useCallback(() => setReloadKey((current) => current + 1), []),
  };
}

function StatusMark({ status }: { status: LoopStage["status"] }) {
  return <span className={`loop-stage-mark ${status}`} aria-hidden="true">{status === "completed" ? <svg viewBox="0 0 20 20"><path d="m5 10 3.2 3.2L15 6.8" /></svg> : null}</span>;
}

function StageTimeline({ stages, selected, onSelect }: {
  stages: LoopStage[];
  selected: string;
  onSelect: (stageId: string) => void;
}) {
  if (!stages.length) return <div className="loop-no-stages"><strong>No rounds recorded yet.</strong><span>The Loop Recorder can add any ordered process without forcing a template.</span></div>;
  return <ol className="loop-stage-track" aria-label="Interview stages">{stages.map((stage) => <li className={`${stage.status} ${selected === stage.stageId ? "selected" : ""}`} key={stage.stageId}>
    <button type="button" onClick={() => onSelect(stage.stageId)} aria-current={selected === stage.stageId ? "step" : undefined}>
      <StatusMark status={stage.status} />
      <strong>{stage.label}</strong>
      <span>{formatDate(stageDate(stage))}</span>
      {stage.groupLabel || stage.outcome ? <small>{[stage.groupLabel, stage.outcome ? sentenceId(stage.outcome) : ""].filter(Boolean).join(" · ")}</small> : null}
    </button>
  </li>)}</ol>;
}

function PreparationLedger({ loop }: { loop: LoopProjection }) {
  const questions = useMemo(() => {
    const rows = new Map<string, {
      key: string;
      specialty: Specialty;
      questionId?: string;
      title: string;
      confidence?: MemoryConfidence;
      state: "asked" | "completed" | "planned";
    }>();
    loop.activityBindings.forEach((binding) => {
      const key = `question:${binding.specialty}:${binding.questionId}`;
      const prior = rows.get(key);
      rows.set(key, {
        key,
        specialty: binding.specialty,
        questionId: binding.questionId,
        title: binding.title,
        state: prior?.state === "completed" || binding.completed ? "completed" : "planned",
      });
    });
    loop.loop.stages.forEach((stage) => stage.debrief?.questions.forEach((question) => {
      const questionId = question.canonicalQuestionId ?? question.memoryId;
      const canonicalKey = question.canonicalQuestionId
        ? `question:${question.specialty}:${question.canonicalQuestionId}`
        : `memory:${stage.stageId}:${question.memoryId}`;
      const existing = rows.get(canonicalKey);
      const row = {
        key: canonicalKey,
        specialty: question.specialty,
        questionId,
        title: question.promptMemory ?? sentenceId(questionId),
        confidence: question.promptConfidence,
        state: "asked" as const,
      };
      if (existing) rows.set(existing.key, { ...existing, confidence: row.confidence, state: "asked" });
      else rows.set(row.key, row);
    }));
    return [...rows.values()];
  }, [loop]);
  const groups = (["leetcode", "system_design", "behavioral"] as Specialty[]).map((specialty) => ({
    specialty,
    rows: questions.filter((question) => question.specialty === specialty),
  }));
  return <section className="loop-preparation" aria-labelledby="loop-preparation-title">
    <header><h2 id="loop-preparation-title">Linked preparation</h2><p>Canonical Bank questions can serve many Loops; context stays on this process.</p></header>
    <div className="loop-preparation-ledger">{groups.map(({ specialty, rows }) => <section key={specialty}>
      <header><span className={`loop-specialty-mark ${specialty}`} aria-hidden="true" /><strong>{specialty === "leetcode" ? "Coding" : sentenceId(specialty)}</strong><small>{rows.filter((row) => row.state !== "planned").length} / {rows.length}</small></header>
      {rows.length ? <ul>{rows.map((row) => <li key={row.key}><span>{row.title}</span>{row.confidence ? <small className={`memory-confidence ${row.confidence}`}>{sentenceId(row.confidence)}</small> : <small>{sentenceId(row.state)}</small>}</li>)}</ul> : <p>No linked questions.</p>}
    </section>)}</div>
  </section>;
}

function InterviewMaterials({ loop, stage }: { loop: LoopProjection; stage?: LoopStage }) {
  const materials = loop.interviewMaterials.filter((material) => (
    !material.stageId || material.stageId === stage?.stageId
  ));
  return <section className="loop-materials" aria-labelledby="loop-materials-title">
    <header>
      <div>
        <span>Confirmed-process preparation</span>
        <h2 id="loop-materials-title">Interview materials</h2>
        <p>{stage ? stage.label : "Loop-wide preparation"} · Separate from Career Materials, the Role Brief, and the raw job description.</p>
      </div>
      <small>{materials.length ? `${materials.length} current` : "None attached"}</small>
    </header>
    {materials.length ? <div className="loop-material-list">{materials.map((material, index) => <article key={material.materialId}>
      <details open={index === 0}>
        <summary>
          <span><strong>{material.label}</strong><small>{material.stageId ? "Round-specific" : "Loop-wide"} · Revision {material.revision}</small></span>
          <span className="loop-material-summary-mark" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="m5 8 5 5 5-5" /></svg></span>
        </summary>
        <div className="loop-material-content">
          {material.summary ? <p className="loop-material-intro">{material.summary}</p> : null}
          <div className="loop-material-sections">{material.sections.map((section) => <section key={section.sectionId}>
            <h3>{section.title}</h3>
            {section.body ? <p>{section.body}</p> : null}
            {section.bullets.length ? <ul>{section.bullets.map((bullet, bulletIndex) => <li key={`${section.sectionId}-${bulletIndex}`}>{bullet}</li>)}</ul> : null}
          </section>)}</div>
          <footer>
            <span>{material.provenance.sourceLabel}</span>
            <span>Role Brief r{material.provenance.roleBriefRevision} · {material.provenance.activityIds.length} linked {material.provenance.activityIds.length === 1 ? "activity" : "activities"} · Prepared {formatDate(material.provenance.preparedAt)}</span>
          </footer>
        </div>
      </details>
    </article>)}</div> : <div className="loop-materials-empty">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h7l4 4V20.5H7z" /><path d="M14 3.5v4h4M9.5 12h6M9.5 15.5h5" /></svg>
      <div><strong>No interview material is attached to this {stage ? "Round" : "Loop"}.</strong><p>Ask the Loop Recorder to create or revise one source-backed prep document. It will remain separate from resumes, cover letters, the Role Brief, and the raw JD.</p></div>
    </div>}
  </section>;
}

function JobDescriptionDocument({ source }: { source: RoleBriefSourcePayload }) {
  const blocks = useMemo(() => parseJobDescription(source.source.jdText), [source.source.jdText]);
  return <article className="loop-jd-document" aria-label={`Full job description for ${source.roleTitle}`}>
    {blocks.map((block, index) => {
      if (block.type === "list") return <ul key={`list-${index}`}>{block.items.map((item, itemIndex) => <li key={`${index}-${itemIndex}`}>{item}</li>)}</ul>;
      if (block.type === "paragraph") return <p key={`paragraph-${index}`}>{block.text}</p>;
      if (block.level <= 1) return <h3 key={`heading-${index}`}>{block.text}</h3>;
      if (block.level === 2) return <h4 key={`heading-${index}`}>{block.text}</h4>;
      return <h5 key={`heading-${index}`}>{block.text}</h5>;
    })}
  </article>;
}

function JobDescriptionDialog({ loop, opener, onClose }: {
  loop: LoopProjection;
  opener: HTMLButtonElement | null;
  onClose: () => void;
}) {
  const [sourceAttempt, setSourceAttempt] = useState(0);
  const [source, setSource] = useState<RoleBriefSourcePayload | null>(null);
  const [sourceError, setSourceError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchRoleBriefSource(
      loop.loop.loopId,
      loop.roleBrief.revision,
      loop.loop.state === "archived",
      controller.signal,
    ).then(
      setSource,
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        setSourceError(cause instanceof Error ? cause.message : "The full job description is unavailable.");
      },
    );
    return () => controller.abort();
  }, [loop.loop.loopId, loop.loop.state, loop.roleBrief.revision, sourceAttempt]);

  useEffect(() => {
    const workspace = document.querySelector<HTMLElement>("[data-loop-workspace-root]");
    const previousOverflow = document.body.style.overflow;
    const previousInert = workspace?.inert ?? false;
    if (workspace) workspace.inert = true;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [])].filter((element) => !element.hidden);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      if (workspace) workspace.inert = previousInert;
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, [onClose, opener]);

  return createPortal(<div className="loop-jd-overlay" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <div className="loop-jd-dialog" role="dialog" aria-modal="true" aria-labelledby="loop-jd-dialog-title" ref={dialogRef}>
      <header className="loop-jd-dialog-header">
        <div>
          <span>Private source · Role Brief revision {loop.roleBrief.revision}</span>
          <h2 id="loop-jd-dialog-title">Full job description</h2>
          <p>{loop.loop.company} · {loop.loop.roleTitle}</p>
        </div>
        <button type="button" className="loop-jd-close" onClick={onClose} ref={closeRef} aria-label="Close full job description">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
        </button>
      </header>
      <div className="loop-jd-dialog-body" aria-live="polite">
        {!source && !sourceError ? <p className="loop-jd-state">Opening the immutable job description…</p> : null}
        {sourceError ? <div className="loop-jd-state error" role="alert"><p>{sourceError}</p><button type="button" onClick={() => {
          setSource(null);
          setSourceError("");
          setSourceAttempt((current) => current + 1);
        }}>Try again</button></div> : null}
        {source ? <>
          <div className="loop-jd-provenance">
            <div><strong>{source.company} · {source.roleTitle}</strong><span>Captured {formatDate(source.source.capturedAt)}</span></div>
            {/^https:\/\//.test(source.source.displayLocator) ? <a href={source.source.displayLocator} target="_blank" rel="noreferrer">Open original posting</a> : <span>{source.source.displayLocator}</span>}
          </div>
          <JobDescriptionDocument source={source} />
        </> : null}
      </div>
    </div>
  </div>, document.body);
}

function RoleBriefPanel({ loop, onOpenSource }: {
  loop: LoopProjection;
  onOpenSource: (opener: HTMLButtonElement) => void;
}) {
  const signals = loop.roleBrief.competencySignals.length
    ? loop.roleBrief.competencySignals
    : loop.roleBrief.responsibilities;
  return <section className="loop-role-brief" aria-labelledby="loop-role-brief-title">
    <header><div><h2 id="loop-role-brief-title">Loop-owned Role Brief</h2><span>Revision {loop.roleBrief.revision}</span></div><small>Structured summary · immutable source</small></header>
    {signals.length ? <ul>{signals.slice(0, 7).map((signal) => <li key={signal}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="m6.5 10 2.2 2.2 4.8-4.8" /></svg><span>{signal}</span></li>)}</ul> : <p>No display-safe competency signals are recorded in this revision.</p>}
    {loop.roleBrief.unresolvedAmbiguities.length ? <details><summary>{loop.roleBrief.unresolvedAmbiguities.length} unresolved {loop.roleBrief.unresolvedAmbiguities.length === 1 ? "detail" : "details"}</summary><ul>{loop.roleBrief.unresolvedAmbiguities.map((item) => <li key={item}>{item}</li>)}</ul></details> : null}
    <div className="loop-jd-access">
      <button type="button" onClick={(event) => onOpenSource(event.currentTarget)} aria-haspopup="dialog">View full job description</button>
      <span>Private · Role Brief revision {loop.roleBrief.revision}</span>
    </div>
  </section>;
}

function DebriefPanel({ stage }: { stage?: LoopStage }) {
  const debrief = stage?.debrief;
  return <section className="loop-debrief" aria-labelledby="loop-debrief-title">
    <header><div><h2 id="loop-debrief-title">Round debrief</h2><span>{stage ? `${stage.label}${stage.outcome ? ` · ${sentenceId(stage.outcome)}` : ""}` : "No round selected"}</span></div><small>{debrief ? `Captured ${formatDate(debrief.capturedAt)}` : "No debrief recorded"}</small></header>
    {debrief ? <dl>
      <div><dt>Questions asked</dt><dd>{debrief.questions.length ? debrief.questions.map((question) => question.promptMemory ?? sentenceId(question.canonicalQuestionId ?? question.memoryId)).join(" · ") : "None recorded"}</dd></div>
      <div><dt>What I remember</dt><dd>{debrief.questions.find((question) => question.answerMemory)?.answerMemory ?? "No remembered answer recorded."}{debrief.questions.find((question) => question.answerConfidence) ? <small className={`memory-confidence ${debrief.questions.find((question) => question.answerConfidence)?.answerConfidence}`}>{sentenceId(debrief.questions.find((question) => question.answerConfidence)?.answerConfidence ?? "")}</small> : null}</dd></div>
      <div><dt>Self-assessment</dt><dd>{debrief.selfAssessment ?? "Not recorded"}</dd></div>
      <div><dt>Next step</dt><dd>{debrief.nextStep ?? "Not recorded"}</dd></div>
    </dl> : <div className="loop-debrief-empty"><p>The Loop Recorder captures concise owner memory without inferring interviewer feedback.</p></div>}
  </section>;
}

function ActivityHistory({ loop, onOpenActivity }: {
  loop: LoopProjection;
  onOpenActivity: (activityId: string) => void;
}) {
  return <section className="loop-history" aria-labelledby="loop-history-title">
    <header><div><h2 id="loop-history-title">Activity history</h2><p>Completed linked activities are projected automatically from authoritative timer receipts.</p></div><small>{loop.activityHistory.length} recorded</small></header>
    {loop.activityHistory.length ? <ol>{loop.activityHistory.map((activity) => <li key={activity.activityId}>
      <a href={`?view=past&attempt=${encodeURIComponent(activity.activityId)}`} data-loop-activity-id={activity.activityId} onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onOpenActivity(activity.activityId);
      }}>
        <time dateTime={new Date(activity.completedAt).toISOString()}>{formatDate(activity.completedAt)}</time>
        <strong>{loop.activityBindings.find((binding) => binding.activityId === activity.activityId)?.title ?? sentenceId(activity.questionId)}</strong>
        <span className={`loop-specialty-label ${activity.specialty}`}>{activity.specialty === "leetcode" ? "Coding" : sentenceId(activity.specialty)}</span>
        <small>{sentenceId(activity.result)} · Role Brief r{activity.roleBriefRevision}</small>
        <svg className="loop-history-arrow" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11m-4-4 4 4-4 4" /></svg>
      </a>
    </li>)}</ol> : <p>No linked activity has finished yet. Planned bindings remain visible under Linked preparation.</p>}
  </section>;
}

export function LoopsWorkspace({ onOpenActivity }: { onOpenActivity: (activityId: string) => void }) {
  const [includeArchived, setIncludeArchived] = useState(false);
  const { payload, error, loading, reload } = useLoopPayload(includeArchived);
  const [selectedLoopId, setSelectedLoopId] = useState(() => (
    typeof window === "undefined" ? "" : readLoopWorkspaceState(window.location.href)?.loopId ?? ""
  ));
  const [selectedStageId, setSelectedStageId] = useState(() => (
    typeof window === "undefined" ? "" : readLoopWorkspaceState(window.location.href)?.stageId ?? ""
  ));
  const [sourceDialog, setSourceDialog] = useState<{ loop: LoopProjection; opener: HTMLButtonElement } | null>(null);
  const loops = payload?.loops ?? [];
  const selectedLoop = loops.find((loop) => loop.loop.loopId === selectedLoopId) ?? loops[0];
  const preferredStage = selectedLoop?.loop.stages.find((stage) => stage.status === "scheduled")
    ?? [...(selectedLoop?.loop.stages ?? [])].reverse().find((stage) => stage.status === "completed")
    ?? selectedLoop?.loop.stages[0];
  const selectedStage = selectedLoop?.loop.stages.find((stage) => stage.stageId === selectedStageId) ?? preferredStage;
  const effectiveStageId = selectedStage?.stageId ?? "";

  useEffect(() => {
    if (!selectedLoop) return;
    const href = loopWorkspaceHref(window.location.href, {
      loopId: selectedLoop.loop.loopId,
      stageId: effectiveStageId,
    });
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== href) {
      window.history.replaceState({ ...window.history.state, interviewArcWorkspaceView: "loops" }, "", href);
    }
  }, [effectiveStageId, selectedLoop]);

  useEffect(() => {
    const activityId = window.history.state?.interviewArcLoopFocusActivity;
    if (typeof activityId !== "string" || !activityId) return;
    const frame = window.requestAnimationFrame(() => {
      const links = document.querySelectorAll<HTMLAnchorElement>("[data-loop-activity-id]");
      [...links].find((link) => link.dataset.loopActivityId === activityId)?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedLoop]);

  if (loading && !payload) return <section className="loops-state" aria-live="polite"><span className="loops-loader" /><strong>Reading owner-private Loops…</strong></section>;
  if (error) return <section className="loops-state error" role="alert"><strong>Loops could not be loaded.</strong><span>{error}</span><button type="button" onClick={() => void reload()}>Try again</button></section>;
  if (!selectedLoop) return <section className="loops-empty">
    <div><h1>Your first Loop starts with a real role.</h1><p>Ask <strong>Interview Arc — Loop Recorder</strong> to record a company, role, job description, and the hiring stages you actually know. It will create the Loop and immutable Role Brief revision 1 together.</p></div>
    <aside><strong>{payload?.migrationInbox.length ?? 0} standalone Target Profiles await a decision</strong><p>Create a Loop, attach to an existing Loop, or archive each one explicitly. Nothing is guessed or deleted.</p></aside>
  </section>;

  return <><section className="loops-workspace" data-loop-workspace-root>
    <header className="loops-command-bar">
      <label><span>Hiring Loop</span><select value={selectedLoop.loop.loopId} onChange={(event) => { setSelectedLoopId(event.target.value); setSelectedStageId(""); }}>{loops.map((loop) => <option value={loop.loop.loopId} key={loop.loop.loopId}>{loop.loop.company} · {loop.loop.roleTitle}</option>)}</select></label>
      <label className="loops-archive-toggle"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} /><span>Show archived</span></label>
      <button type="button" onClick={() => void reload()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
    </header>
    <div className="loop-identity">
      <div><span className={`loop-status ${selectedLoop.loop.status}`}><i />{sentenceId(selectedLoop.loop.status)} Loop</span><h1>{selectedLoop.loop.company} <em>·</em> {selectedLoop.loop.roleTitle}</h1><p>{[selectedLoop.loop.jobReference, selectedLoop.loop.location, selectedLoop.roleBrief.targetLevel].filter(Boolean).join(" · ") || "Company-and-role hiring process"}</p></div>
      <aside><span>Current truth</span><strong>Loop r{selectedLoop.loop.revision}</strong><small>Role Brief r{selectedLoop.roleBrief.revision}</small></aside>
    </div>
    <StageTimeline stages={selectedLoop.loop.stages} selected={effectiveStageId} onSelect={setSelectedStageId} />
    <InterviewMaterials loop={selectedLoop} stage={selectedStage} />
    <div className="loop-detail-grid">
      <PreparationLedger loop={selectedLoop} />
      <div className="loop-context-column"><RoleBriefPanel loop={selectedLoop} onOpenSource={(opener) => setSourceDialog({ loop: selectedLoop, opener })} /><DebriefPanel stage={selectedStage} /></div>
    </div>
    <ActivityHistory loop={selectedLoop} onOpenActivity={onOpenActivity} />
  </section>{sourceDialog ? <JobDescriptionDialog loop={sourceDialog.loop} opener={sourceDialog.opener} onClose={() => setSourceDialog(null)} /> : null}</>;
}

export function LoopJourneyFactsPanel() {
  const { payload, error, loading, reload } = useLoopPayload(true);
  if (loading && !payload) return <section className="loop-journey-facts loading" aria-live="polite">Reading factual Loop history…</section>;
  if (error || !payload) return <section className="loop-journey-facts error" role="alert"><span>{error || "Loop facts are unavailable."}</span><button type="button" onClick={() => void reload()}>Try again</button></section>;
  const facts = payload.facts;
  const resolvedOutcomes = facts.outcomes.offer + facts.outcomes.rejected + facts.outcomes.withdrawn + facts.outcomes.closed;
  return <section className="loop-journey-facts" aria-labelledby="loop-journey-facts-title">
    <header><h2 id="loop-journey-facts-title">Hiring Loop facts</h2><p>Explicit Loop, stage, date, and outcome records only. Scheduled time never becomes a result.</p></header>
    <div>
      <article><span>Hiring Loops</span><strong>{facts.loopCount}</strong><small>{facts.activeLoopCount} active</small></article>
      <article><span>Interview stages</span><strong>{facts.stageCount}</strong><small>{facts.completedStageCount} completed · {facts.scheduledStageCount} scheduled</small></article>
      <article><span>Dated stages</span><strong>{facts.interviewDateCount}</strong><small>explicit dates</small></article>
      <article><span>Resolved outcomes</span><strong>{resolvedOutcomes}</strong><small>{facts.outcomes.offer} offers · {facts.outcomes.unresolved} unresolved</small></article>
    </div>
  </section>;
}
