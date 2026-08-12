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
  const [reviewingEvidenceId, setReviewingEvidenceId] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

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

  const reviewCandidate = async (
    evidenceId: string,
    expectedRevision: number,
    decision: "accept" | "reject",
  ) => {
    setReviewError(null);
    setReviewingEvidenceId(evidenceId);
    try {
      const response = await fetch("/api/behavioral-foundation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operationId: `foundation-review-${crypto.randomUUID()}`,
          decisions: [{ evidenceId, expectedRevision, decision }],
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The evidence decision could not be saved.");
      setStatus(undefined);
      setRequestKey((value) => value + 1);
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "The evidence decision could not be saved.");
    } finally {
      setReviewingEvidenceId(null);
    }
  };

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
            <strong>{status.sources.total}</strong>
            <h3>Registered private sources</h3>
            <p>{status.sources.available} available · {status.sources.changed} changed · {status.sources.blocked} blocked</p>
            <small>{status.sources.revisions} immutable revision{status.sources.revisions === 1 ? "" : "s"}. Only display-safe metadata leaves the local connector.</small>
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

        <section className="foundation-source-register" aria-labelledby="foundation-source-register-title">
          <header>
            <div>
              <span className="foundation-index">SOURCE REGISTER</span>
              <h3 id="foundation-source-register-title">What the evidence specialist can inspect</h3>
            </div>
            <small>{status.sources.active} active · {status.sources.revisions} revisions</small>
          </header>
          {status.sources.recent.length ? <ol>
            {status.sources.recent.map((source) => <li key={`${source.sourceId}:${source.revision}`}>
              <div>
                <strong>{source.label}</strong>
                <span>{source.safeHint}</span>
              </div>
              <dl>
                <div><dt>Project</dt><dd>{source.projectKey}</dd></div>
                <div><dt>Availability</dt><dd data-state={source.availability}>{source.availability.replaceAll("_", " ")}</dd></div>
                <div><dt>Refresh</dt><dd data-state={source.refreshStatus}>{source.refreshStatus.replaceAll("_", " ")}</dd></div>
                <div><dt>Revision</dt><dd>v{source.revision}</dd></div>
              </dl>
            </li>)}
          </ol> : <div className="foundation-subempty"><strong>No sources registered yet.</strong><span>Run the bounded local evidence refresh to publish sanitized source metadata—never raw files or locators.</span></div>}
          {status.sources.truncated && <small className="foundation-more">More sources are available through the Behavioral specialist registry.</small>}
        </section>

        <section className="foundation-review-desk" aria-labelledby="foundation-review-desk-title">
          <header>
            <div>
              <span className="foundation-index">OWNER REVIEW</span>
              <h3 id="foundation-review-desk-title">Evidence waiting for your decision</h3>
            </div>
            <strong>{status.candidates.pending}</strong>
          </header>
          <p className="foundation-review-intro">Accept only factual, correctly scoped observations. Acceptance does not prove personal ownership; A3 attribution still requires your exact confirmation.</p>
          {reviewError && <div className="foundation-review-error" role="alert">{reviewError}</div>}
          {status.candidates.items.length ? <ol className="foundation-candidate-list">
            {status.candidates.items.map((candidate) => {
              const busy = reviewingEvidenceId === candidate.evidenceId;
              return <li key={`${candidate.evidenceId}:${candidate.reviewRevision}`}>
                <div className="foundation-candidate-meta">
                  <span>{candidate.projectKey}</span>
                  <span>{candidate.origin.replaceAll("_", " ")}</span>
                  <span>{candidate.evidenceGrade} · {candidate.attributionGrade}</span>
                  <span>review v{candidate.reviewRevision}</span>
                </div>
                <p>{candidate.statement}</p>
                <div className="foundation-candidate-context">
                  <span><strong>Supports</strong>{candidate.supports[0] ?? "No supporting scope recorded."}</span>
                  <span><strong>Limit</strong>{candidate.limitations[0] ?? "No limitation recorded."}</span>
                </div>
                <div className="foundation-candidate-actions">
                  <small>{candidate.questionLinks.length} linked prompt{candidate.questionLinks.length === 1 ? "" : "s"}</small>
                  <div>
                    <button type="button" className="reject" disabled={reviewingEvidenceId !== null} onClick={() => void reviewCandidate(candidate.evidenceId, candidate.reviewRevision, "reject")}>{busy ? "Saving…" : "Reject"}</button>
                    <button type="button" className="accept" disabled={reviewingEvidenceId !== null} onClick={() => void reviewCandidate(candidate.evidenceId, candidate.reviewRevision, "accept")}>{busy ? "Saving…" : "Accept evidence"}</button>
                  </div>
                </div>
              </li>;
            })}
          </ol> : <div className="foundation-subempty"><strong>The review queue is clear.</strong><span>New sanitized candidates appear here after a local specialist refresh.</span></div>}
          {status.candidates.truncated && <small className="foundation-more">Review this bounded page, then refresh for the remaining candidates.</small>}
        </section>

        {status.evidence.total === 0 && status.claims.total === 0 && <div className="foundation-empty"><strong>Your evidence desk is ready.</strong><span>Run a résumé-foundation drill with the Behavioral specialist to add the first sanitized evidence checkpoint.</span></div>}
      </>}
      <ResumeLibrary enabled={enabled} />
    </section>
  );
}
