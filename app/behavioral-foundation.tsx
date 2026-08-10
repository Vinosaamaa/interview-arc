"use client";

import { useEffect, useMemo, useState } from "react";
import {
  behavioralFoundationStatusSchema,
  type BehavioralFoundationStatus,
} from "./behavioral-foundation-contract";
import ResumeLibrary from "./resume-library";

type Props = {
  enabled?: boolean;
  curriculumQuestionIds: string[];
  completedCurriculumQuestionIds: string[];
};

function readableUpdatedAt(value: number | null) {
  if (!value) return "No evidence saved yet";
  return `Updated ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
    timeZoneName: "short",
  }).format(new Date(value))}`;
}

export default function BehavioralFoundation({
  enabled = true,
  curriculumQuestionIds,
  completedCurriculumQuestionIds,
}: Props) {
  const [status, setStatus] = useState<BehavioralFoundationStatus | null>();
  const [requestKey, setRequestKey] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void fetch("/api/behavioral-foundation", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Behavioral Foundation could not load.");
        return behavioralFoundationStatusSchema.parse(await response.json());
      })
      .then(setStatus)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus(null);
      });
    return () => controller.abort();
  }, [enabled, requestKey]);

  const curriculumQuestionSet = useMemo(() => new Set(curriculumQuestionIds), [curriculumQuestionIds]);
  const evidenceLinkedCurriculum = status?.questionCoverage.filter((item) => curriculumQuestionSet.has(item.questionId)).length ?? 0;
  const curriculumCompleted = new Set(completedCurriculumQuestionIds).size;

  return (
    <section className="behavioral-foundation" aria-labelledby="behavioral-foundation-title">
      <header className="foundation-heading">
        <div>
          <span className="eyebrow">BEHAVIORAL FOUNDATION · OWNER PRIVATE</span>
          <h2 id="behavioral-foundation-title">Build answers on a truthful record.</h2>
          <p>Accepted evidence, unresolved claims, and résumé drills stay distinct. Raw files, local paths, and private source locators never appear here.</p>
        </div>
        <small>{status === undefined ? "Reading private evidence…" : status === null ? "Evidence read unavailable" : readableUpdatedAt(status.lastUpdatedAt)}</small>
      </header>

      {status === undefined && <div className="foundation-state" role="status"><span aria-hidden="true" /><strong>Opening the evidence desk…</strong></div>}
      {status === null && <div className="foundation-state error" role="alert"><div><strong>The evidence desk could not load.</strong><span>No private data was inferred. Retry the owner-scoped read.</span></div><button type="button" onClick={() => { setStatus(undefined); setRequestKey((value) => value + 1); }}>Retry</button></div>}
      {status && <>
        <div className="foundation-truth-line" aria-label="Behavioral claim status">
          {([
            ["Verified", status.claims.verified, "verified"],
            ["Partial", status.claims.partial, "partial"],
            ["Unverified", status.claims.unverified, "unverified"],
            ["Contradicted", status.claims.contradicted, "contradicted"],
          ] as const).map(([label, value, tone]) => <div className={tone} key={tone}><span aria-hidden="true" /><strong>{value}</strong><small>{label}</small></div>)}
        </div>

        <div className="foundation-ledger">
          <article>
            <span className="foundation-index">SOURCE DOCKET</span>
            <strong>{status.evidence.sourceRevisions}</strong>
            <h3>Sanitized revisions</h3>
            <p>{status.evidence.projects} project scope{status.evidence.projects === 1 ? "" : "s"} · {status.evidence.accepted} accepted evidence item{status.evidence.accepted === 1 ? "" : "s"}</p>
            <small>Source registration is not shipped yet. This desk never guesses availability from stale evidence.</small>
          </article>
          <article>
            <span className="foundation-index">RÉSUMÉ COVERAGE</span>
            <strong>{curriculumCompleted}<i>/{curriculumQuestionIds.length}</i></strong>
            <h3>Foundation drills finished</h3>
            <p>{evidenceLinkedCurriculum} curriculum prompt{evidenceLinkedCurriculum === 1 ? "" : "s"} linked to claim checkpoints</p>
            <small>Question completion and evidence verification are separate measures.</small>
          </article>
          <article>
            <span className="foundation-index">CLAIMS &amp; GAPS</span>
            <strong>{status.gaps.length}</strong>
            <h3>Visible open questions</h3>
            {status.gaps.length ? <ul>{status.gaps.slice(0, 3).map((gap) => <li key={`${gap.claimId}:${gap.text}`}>{gap.text}</li>)}</ul> : <p>No open gaps are recorded in the current bounded read.</p>}
            {status.truncated.gaps && <small>More gaps exist; use the specialist evidence preflight for the complete question-scoped view.</small>}
          </article>
          <article>
            <span className="foundation-index">STORY SHELF</span>
            <strong>{status.stories.active}</strong>
            <h3>{status.stories.active ? "Reusable stories" : "No durable stories yet"}</h3>
            {status.stories.recent.length
              ? <ol className="foundation-story-list">{status.stories.recent.slice(0, 3).map((story) => <li key={`${story.storyId}:${story.revision}`}>
                  <span>{story.title}</span>
                  <small>v{story.revision} · {story.questionCount} prompt{story.questionCount === 1 ? "" : "s"}</small>
                </li>)}</ol>
              : <p>Compose the first evidence-backed STARL story with the Behavioral specialist.</p>}
            <small>{status.stories.truncated ? "More stories are available through the question-scoped preflight." : "Transcripts are never copied into this reusable layer."}</small>
          </article>
        </div>

        {status.evidence.total === 0 && status.claims.total === 0 && <div className="foundation-empty"><strong>Your evidence desk is ready.</strong><span>Run a résumé-foundation drill with the Behavioral specialist to add the first sanitized evidence checkpoint.</span></div>}
      </>}
      <ResumeLibrary enabled={enabled} />
    </section>
  );
}
