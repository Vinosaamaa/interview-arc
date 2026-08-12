"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchRoleBriefSource,
  parseJobDescription,
  type RoleBriefSourcePayload,
} from "./loop-role-brief-source";
import { loopWorkspaceHref, readLoopWorkspaceState } from "./journey-insights";
import { acquireDocumentScrollLock } from "./document-scroll-policy";
import {
  groupLoopPreparation,
  indexStageMaterials,
  loopStageRecords,
  stageMaterials,
  type LoopPreparationSource,
  type LoopSpecialty,
} from "./loops-view-model";
import InterviewPageHero from "./interview-page-hero";

type Specialty = LoopSpecialty;
type MemoryConfidence = "exact" | "reconstructed";
type OwnerAssessment = "strong" | "mixed" | "needs_work";

type LoopQuestion = {
  memoryId: string;
  specialty: Specialty;
  canonicalQuestionId?: string;
  promptMemory?: string;
  promptConfidence: MemoryConfidence;
  answerMemory?: string;
  answerConfidence?: MemoryConfidence;
  ownerReview?: { assessment?: OwnerAssessment; approach?: string; summary?: string };
};

type LoopStage = {
  stageId: string;
  label: string;
  groupId?: string;
  groupLabel?: string;
  order: number;
  status: "planned" | "scheduled" | "completed" | "cancelled" | "skipped";
  format?: string;
  interviewers?: string[];
  scheduledAt?: number;
  startedAt?: number;
  completedAt?: number;
  cancelledAt?: number;
  outcome?: string;
  debrief?: {
    capturedAt: number;
    questions: LoopQuestion[];
    selfAssessment?: string;
    interviewerFeedback?: string;
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
  sections: Array<{ sectionId: string; title: string; body?: string; bullets: string[] }>;
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

type LoopProjection = LoopPreparationSource & {
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
  interviewMaterials: LoopInterviewMaterial[];
};

export type LoopJourneyFacts = {
  loopCount: number;
  activeLoopCount: number;
  stageCount: number;
  completedStageCount: number;
  scheduledStageCount: number;
  interviewDateCount: number;
  outcomes: { offer: number; rejected: number; withdrawn: number; closed: number; unresolved: number };
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

function specialtyLabel(specialty: Specialty) {
  return specialty === "leetcode" ? "Coding" : sentenceId(specialty);
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
        setResult({ requestKey, includeArchived, payload: null, error: cause instanceof Error ? cause.message : "Loop state is unavailable." });
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

function PreparationLedger({ loop, onOpenActivity }: {
  loop: LoopProjection;
  onOpenActivity: (activityId: string) => void;
}) {
  const groups = useMemo(() => groupLoopPreparation(loop), [loop]);
  return <section className="loop-preparation" aria-labelledby="loop-preparation-title">
    <header>
      <div><h2 id="loop-preparation-title">Linked preparation</h2><p>Completed work first. Each finished attempt opens its exact Past record.</p></div>
      <small>{loop.activityBindings.length} linked</small>
    </header>
    <div className="loop-preparation-columns">{groups.map((group) => <section className={`loop-preparation-column ${group.specialty}`} key={group.specialty}>
      <header><span className={`loop-specialty-mark ${group.specialty}`} aria-hidden="true" /><strong>{specialtyLabel(group.specialty)}</strong><small>{group.questions.filter((question) => question.completed).length}/{group.questions.length}</small></header>
      <div className="loop-preparation-list" tabIndex={group.questions.length > 4 ? 0 : undefined} aria-label={`${specialtyLabel(group.specialty)} preparation`}>
        {group.questions.length ? group.questions.map((question) => {
          const exactAttempts = question.attempts.filter((attempt) => attempt.history);
          if (question.attempts.length > 1) return <details className="loop-preparation-question" key={question.questionId}>
            <summary><span className={`loop-preparation-check ${question.completed ? "completed" : "planned"}`} aria-hidden="true">{question.completed ? <svg viewBox="0 0 20 20"><path d="m5 10 3.2 3.2L15 6.8" /></svg> : null}</span><strong>{question.title}</strong><small>{question.attempts.length} attempts</small><svg className="loop-disclosure" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg></summary>
            <div>{question.attempts.map((attempt, index) => attempt.history ? <button type="button" key={attempt.activityId} data-loop-activity-id={attempt.activityId} onClick={() => onOpenActivity(attempt.activityId)}><span>Attempt {question.attempts.length - index}</span><strong>{sentenceId(attempt.history.result)}</strong><time>{formatDate(attempt.history.completedAt)}</time></button> : <span className="loop-planned-attempt" key={attempt.activityId}>Planned · no Past record yet</span>)}</div>
          </details>;
          const attempt = exactAttempts[0];
          return attempt ? <button type="button" className="loop-preparation-question single" key={question.questionId} data-loop-activity-id={attempt.activityId} onClick={() => onOpenActivity(attempt.activityId)}><span className="loop-preparation-check completed" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="m5 10 3.2 3.2L15 6.8" /></svg></span><strong>{question.title}</strong><small>{formatDate(attempt.history?.completedAt)}</small><svg className="loop-row-arrow" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11m-4-4 4 4-4 4" /></svg></button>
            : <div className="loop-preparation-question single planned" key={question.questionId}><span className="loop-preparation-check planned" aria-hidden="true" /><strong>{question.title}</strong><small>Planned</small></div>;
        }) : <p>No linked preparation.</p>}
      </div>
    </section>)}</div>
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
    void fetchRoleBriefSource(loop.loop.loopId, loop.roleBrief.revision, loop.loop.state === "archived", controller.signal).then(
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
    const releaseScrollLock = acquireDocumentScrollLock();
    const previousInert = workspace?.inert ?? false;
    if (workspace) workspace.inert = true;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])].filter((element) => !element.hidden);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      if (workspace) workspace.inert = previousInert;
      releaseScrollLock();
      opener?.focus();
    };
  }, [onClose, opener]);

  return createPortal(<div className="loop-jd-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="loop-jd-dialog" role="dialog" aria-modal="true" aria-labelledby="loop-jd-dialog-title" ref={dialogRef}>
      <header className="loop-jd-dialog-header"><div><span>Private source · Role Brief revision {loop.roleBrief.revision}</span><h2 id="loop-jd-dialog-title">Full job description</h2><p>{loop.loop.company} · {loop.loop.roleTitle}</p></div><button type="button" className="loop-jd-close" onClick={onClose} ref={closeRef} aria-label="Close full job description"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button></header>
      <div className="loop-jd-dialog-body" aria-live="polite">
        {!source && !sourceError ? <p className="loop-jd-state">Opening the immutable job description…</p> : null}
        {sourceError ? <div className="loop-jd-state error" role="alert"><p>{sourceError}</p><button type="button" onClick={() => { setSource(null); setSourceError(""); setSourceAttempt((current) => current + 1); }}>Try again</button></div> : null}
        {source ? <><div className="loop-jd-provenance"><div><strong>{source.company} · {source.roleTitle}</strong><span>Captured {formatDate(source.source.capturedAt)}</span></div>{/^https:\/\//.test(source.source.displayLocator) ? <a href={source.source.displayLocator} target="_blank" rel="noreferrer">Open original posting</a> : <span>{source.source.displayLocator}</span>}</div><JobDescriptionDocument source={source} /></> : null}
      </div>
    </div>
  </div>, document.body);
}

function RoleBriefPanel({ loop, onOpenSource }: {
  loop: LoopProjection;
  onOpenSource: (opener: HTMLButtonElement) => void;
}) {
  const signals = loop.roleBrief.competencySignals.length ? loop.roleBrief.competencySignals : loop.roleBrief.responsibilities;
  return <section className="loop-role-brief" aria-labelledby="loop-role-brief-title">
    <header><div><h2 id="loop-role-brief-title">Role context</h2><span>Role Brief revision {loop.roleBrief.revision}</span></div><small>Display-safe summary</small></header>
    <p className="loop-role-summary">{signals[0] ?? "No display-safe role summary is recorded in this revision."}</p>
    {signals.length > 1 ? <ul>{signals.slice(1, 5).map((signal) => <li key={signal}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="m6.5 10 2.2 2.2 4.8-4.8" /></svg><span>{signal}</span></li>)}</ul> : null}
    <div className="loop-jd-access"><button type="button" onClick={(event) => onOpenSource(event.currentTarget)} aria-haspopup="dialog">View job description</button><span>Private source · revision {loop.roleBrief.revision}</span></div>
  </section>;
}

function InterviewMaterial({ material }: { material: LoopInterviewMaterial }) {
  return <details className={`loop-stage-card loop-stage-material ${material.stageId ? "stage-bound" : "legacy-wide"}`}>
    <summary><span><strong>{material.label}</strong><small>{material.stageId ? "Stage material" : "Legacy Loop-wide material"} · revision {material.revision}</small></span><svg className="loop-disclosure" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg></summary>
    <div>{material.summary ? <p>{material.summary}</p> : null}{material.sections.map((section) => <section key={section.sectionId}><h4>{section.title}</h4>{section.body ? <p>{section.body}</p> : null}{section.bullets.length ? <ul>{section.bullets.map((bullet, index) => <li key={`${section.sectionId}-${index}`}>{bullet}</li>)}</ul> : null}</section>)}<footer>{material.provenance.sourceLabel} · Prepared {formatDate(material.provenance.preparedAt)}</footer></div>
  </details>;
}

function QuestionCard({ question, index, stageId, expanded, onToggle }: {
  question: LoopQuestion;
  index: number;
  stageId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const title = question.promptMemory ?? sentenceId(question.canonicalQuestionId ?? question.memoryId);
  const review = question.ownerReview;
  const assessment = review?.assessment ? sentenceId(review.assessment) : "Not assessed";
  const bodyId = `loop-question-${stageId}-${question.memoryId}`;
  return <article className={`loop-stage-card loop-question-card ${expanded ? "expanded" : "compact"}`}>
    <button type="button" className="loop-question-trigger" aria-expanded={expanded} aria-controls={bodyId} onClick={onToggle}>
      <span className="loop-question-number">{String(index + 1).padStart(2, "0")}</span><strong>{title}</strong><i className={review?.assessment ?? "unassessed"}>{assessment}</i><svg className="loop-disclosure" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
    </button>
    <div className="loop-question-body" id={bodyId} inert={!expanded} aria-hidden={!expanded}>
      <section><h3>Question context</h3><p>{question.canonicalQuestionId ? `Linked to ${sentenceId(question.canonicalQuestionId)} in ${specialtyLabel(question.specialty)}.` : `Owner-recorded ${specialtyLabel(question.specialty)} interview question.`}</p>{question.canonicalQuestionId ? <a href={`?view=banks&specialty=${encodeURIComponent(question.specialty)}&problem=${encodeURIComponent(question.canonicalQuestionId)}`}>Open in Banks</a> : null}</section>
      <section><h3>My approach</h3><p>{review?.approach ?? "No approach note was recorded for this question."}</p></section>
      <section><h3>My review</h3><p>{review?.summary ?? "No owner review was recorded for this question."}</p></section>
    </div>
  </article>;
}

function StageRecord({ stage, materials }: {
  stage: LoopStage;
  materials: LoopInterviewMaterial[];
}) {
  const [openQuestionId, setOpenQuestionId] = useState(stage.debrief?.questions[0]?.memoryId ?? "");
  const debrief = stage.debrief;
  const datedAt = stageDate(stage);
  const hasMetadata = Boolean(datedAt || stage.status === "completed" || stage.format || stage.interviewers?.length || stage.outcome);
  const hasRecord = Boolean(debrief || stage.status === "completed" || stage.status === "cancelled" || stage.status === "skipped");
  const [stageOpen, setStageOpen] = useState(hasRecord);
  return <li className={`loop-stage-record ${stage.status} ${hasRecord ? "recorded" : "compact"}`} id={`loop-stage-${stage.stageId}`}>
    <span className={`loop-stage-node ${stage.status}`} aria-hidden="true">{stage.status === "completed" ? <svg viewBox="0 0 20 20"><path d="m5 10 3.2 3.2L15 6.8" /></svg> : null}</span>
    <article>
      <header className="loop-stage-record-header">
        <div><span>{[stage.groupLabel, sentenceId(stage.status)].filter(Boolean).join(" · ")}</span><h2>{stage.label}</h2></div>
        {hasMetadata ? <dl>{datedAt || stage.status === "completed" ? <div><dt>Date</dt><dd>{formatDate(datedAt)}</dd></div> : null}{stage.format ? <div><dt>Format</dt><dd>{stage.format}</dd></div> : null}{stage.interviewers?.length ? <div><dt>Interviewers</dt><dd>{stage.interviewers.join(" · ")}</dd></div> : null}{stage.outcome ? <div><dt>Outcome</dt><dd>{sentenceId(stage.outcome)}</dd></div> : null}</dl> : null}
        {(debrief || materials.length) ? <button type="button" className="loop-stage-toggle" aria-expanded={stageOpen} aria-controls={`loop-stage-${stage.stageId}-body`} onClick={() => setStageOpen((current) => !current)}><span>{stageOpen ? "Collapse" : "Expand"}</span><svg className="loop-disclosure" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg></button> : null}
      </header>
      {debrief ? <div className={`loop-stage-body-shell ${stageOpen ? "open" : "closed"}`} id={`loop-stage-${stage.stageId}-body`} inert={!stageOpen} aria-hidden={!stageOpen}><div className="loop-stage-record-body">
        {materials.map((material) => <InterviewMaterial material={material} key={material.materialId} />)}
        {debrief.questions.length ? <section className="loop-stage-questions" aria-labelledby={`loop-stage-${stage.stageId}-questions`}><h3 className="sr-only" id={`loop-stage-${stage.stageId}-questions`}>Questions asked</h3><div>{debrief.questions.map((question, index) => <QuestionCard question={question} index={index} stageId={stage.stageId} expanded={openQuestionId === question.memoryId} onToggle={() => setOpenQuestionId((current) => current === question.memoryId ? "" : question.memoryId)} key={question.memoryId} />)}</div></section> : null}
        {stage.outcome ? <p className="loop-stage-result"><span>Stage result</span><strong>{sentenceId(stage.outcome)}</strong></p> : null}
      </div></div> : materials.length ? <div className={`loop-stage-body-shell ${stageOpen ? "open" : "closed"}`} id={`loop-stage-${stage.stageId}-body`} inert={!stageOpen} aria-hidden={!stageOpen}><div className="loop-stage-record-body materials-only">{materials.map((material) => <InterviewMaterial material={material} key={material.materialId} />)}</div></div> : null}
    </article>
  </li>;
}

function StageChronology({ loop }: { loop: LoopProjection }) {
  const stages = loopStageRecords(loop.loop.stages);
  const materialIndex = useMemo(() => indexStageMaterials(loop.interviewMaterials), [loop.interviewMaterials]);
  if (!stages.length) {
    const loopWideMaterials = stageMaterials(materialIndex, "");
    return <div className="loop-no-stages"><strong>No stages recorded yet.</strong><span>The Loop Recorder can add the real hiring stages without forcing a template.</span>{loopWideMaterials.map((material) => <InterviewMaterial material={material} key={material.materialId} />)}</div>;
  }
  const terminal = loop.loop.outcome ?? (loop.loop.status === "completed" ? "closed" : "open");
  return <ol className={`loop-stage-chronology outcome-${terminal}`} aria-label="Interview stage chronology">{stages.map((stage, index) => <StageRecord stage={stage} materials={stageMaterials(materialIndex, stage.stageId, index === 0)} key={stage.stageId} />)}<li className={`loop-stage-terminal ${terminal}`}><span aria-hidden="true">{terminal === "rejected" || terminal === "withdrawn" || terminal === "closed" ? "×" : ""}</span><strong>{terminal === "open" ? "To be continued" : sentenceId(terminal)}</strong></li></ol>;
}

export function LoopsWorkspace({ onOpenActivity }: { onOpenActivity: (activityId: string) => void }) {
  const [includeArchived, setIncludeArchived] = useState(false);
  const { payload, error, loading, reload } = useLoopPayload(includeArchived);
  const [selectedLoopId, setSelectedLoopId] = useState(() => (typeof window === "undefined" ? "" : readLoopWorkspaceState(window.location.href)?.loopId ?? ""));
  const [loopSwitcherOpen, setLoopSwitcherOpen] = useState(false);
  const [sourceDialog, setSourceDialog] = useState<{ loop: LoopProjection; opener: HTMLButtonElement } | null>(null);
  const closeSourceDialog = useCallback(() => setSourceDialog(null), []);
  const loops = payload?.loops ?? [];
  const selectedLoop = loops.find((loop) => loop.loop.loopId === selectedLoopId) ?? loops[0];

  useEffect(() => {
    if (!selectedLoop) return;
    const href = loopWorkspaceHref(window.location.href, { loopId: selectedLoop.loop.loopId, stageId: "" });
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== href) window.history.replaceState({ ...window.history.state, interviewArcWorkspaceView: "loops" }, "", href);
  }, [selectedLoop]);

  useEffect(() => {
    const activityId = window.history.state?.interviewArcLoopFocusActivity;
    if (typeof activityId !== "string" || !activityId) return;
    const frame = window.requestAnimationFrame(() => {
      const links = document.querySelectorAll<HTMLElement>("[data-loop-activity-id]");
      [...links].find((link) => link.dataset.loopActivityId === activityId)?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedLoop]);

  if (loading && !payload) return <section className="loops-state" aria-live="polite"><span className="loops-loader" /><strong>Reading owner-private Loops…</strong></section>;
  if (error) return <section className="loops-state error" role="alert"><strong>Loops could not be loaded.</strong><span>{error}</span><button type="button" onClick={() => void reload()}>Try again</button></section>;
  if (!selectedLoop) return <section className="loops-empty"><div><h1>Your first Loop starts with a real role.</h1><p>Ask <strong>Interview Arc — Loop Recorder</strong> to record the company, role, job description, and hiring stages you actually know.</p></div><aside><strong>{payload?.migrationInbox.length ?? 0} standalone Target Profiles await a decision</strong><p>Nothing is guessed or deleted.</p></aside></section>;

  const completedStages = selectedLoop.loop.stages.filter((stage) => stage.status === "completed").length;
  const linkedPractices = selectedLoop.activityHistory.length;
  return <><section className="loops-workspace" data-loop-workspace-root>
    <InterviewPageHero tone="loops" eyebrow="INTERVIEW · LOOPS" title={<>Every conversation<br />becomes a <em>clearer record.</em></>} description="Role context, linked preparation, and every interview stage stay together without rewriting history." metrics={[
      { value: loops.filter((loop) => loop.loop.status === "active").length, label: "active loop" },
      { value: completedStages, label: "completed stage" },
      { value: linkedPractices, label: "linked practices" },
    ]} />
    <section className={`loop-identity-switcher ${loopSwitcherOpen ? "open" : ""}`}>
      <button type="button" className="loop-current-identity" aria-expanded={loopSwitcherOpen} aria-controls="loop-switcher-list" onClick={() => setLoopSwitcherOpen((current) => !current)}><span><i className={`loop-status ${selectedLoop.loop.status}`}>{sentenceId(selectedLoop.loop.status)}</i><strong>{selectedLoop.loop.company} · {selectedLoop.loop.roleTitle}</strong><small>{[selectedLoop.loop.jobReference, selectedLoop.loop.location, selectedLoop.roleBrief.targetLevel].filter(Boolean).join(" · ") || "Company-and-role hiring process"}</small></span><b>Switch Loop</b><svg className="loop-disclosure" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg></button>
      <div className="loop-switcher-list" id="loop-switcher-list" inert={!loopSwitcherOpen} aria-hidden={!loopSwitcherOpen}><div>{loops.filter((loop) => loop.loop.loopId !== selectedLoop.loop.loopId).map((loop) => <button type="button" onClick={() => { setSelectedLoopId(loop.loop.loopId); setLoopSwitcherOpen(false); }} key={loop.loop.loopId}><strong>{loop.loop.company}</strong><span>{loop.loop.roleTitle}</span><small>{sentenceId(loop.loop.status)}</small></button>)}</div>{loops.length <= 1 ? <p>No other Loop is recorded.</p> : null}<label><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} /> Include archived Loops</label></div>
    </section>
    <div className="loop-support-band"><RoleBriefPanel loop={selectedLoop} onOpenSource={(opener) => setSourceDialog({ loop: selectedLoop, opener })} /><PreparationLedger loop={selectedLoop} onOpenActivity={onOpenActivity} /></div>
    <StageChronology loop={selectedLoop} />
  </section>{sourceDialog ? <JobDescriptionDialog loop={sourceDialog.loop} opener={sourceDialog.opener} onClose={closeSourceDialog} /> : null}</>;
}

export function LoopJourneyFactsPanel() {
  const { payload, error, loading, reload } = useLoopPayload(true);
  if (loading && !payload) return <section className="loop-journey-facts loading" aria-live="polite"><header><span className="eyebrow">LOOP OUTCOMES</span><h2>Hiring Loop facts</h2><p>Explicit Loop, stage, date, and outcome records only. Scheduled time never becomes a result.</p></header><div>{["Hiring Loops", "Interview stages", "Dated stages", "Resolved outcomes"].map((label) => <article key={label}><span>{label}</span><strong className="loop-fact-skeleton" aria-hidden="true" /><small>Reading saved facts…</small></article>)}</div></section>;
  if (error || !payload) return <section className="loop-journey-facts error" role="alert"><header><span className="eyebrow">LOOP OUTCOMES</span><h2>Hiring Loop facts</h2><p>{error || "Loop facts are unavailable."}</p></header><button type="button" onClick={() => void reload()}>Try again</button></section>;
  const facts = payload.facts;
  const resolvedOutcomes = facts.outcomes.offer + facts.outcomes.rejected + facts.outcomes.withdrawn + facts.outcomes.closed;
  return <section className="loop-journey-facts" aria-labelledby="loop-journey-facts-title"><header><span className="eyebrow">LOOP OUTCOMES</span><h2 id="loop-journey-facts-title">Hiring Loop facts</h2><p>Explicit Loop, stage, date, and outcome records only. Scheduled time never becomes a result.</p></header><div><article><span>Hiring Loops</span><strong>{facts.loopCount}</strong><small>{facts.activeLoopCount} active</small></article><article><span>Interview stages</span><strong>{facts.stageCount}</strong><small>{facts.completedStageCount} completed · {facts.scheduledStageCount} scheduled</small></article><article><span>Dated stages</span><strong>{facts.interviewDateCount}</strong><small>explicit dates</small></article><article><span>Resolved outcomes</span><strong>{resolvedOutcomes}</strong><small>{facts.outcomes.offer} offers · {facts.outcomes.unresolved} unresolved</small></article></div></section>;
}
