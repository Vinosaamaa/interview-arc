"use client";

import { useEffect, useMemo, useState } from "react";
import {
  careerMaterialsCoverLetterResponseSchema,
  type CareerMaterialsCoverLetterArtifact,
  type CareerMaterialsCoverLetterResponse,
} from "./cover-letter-contract";
import { resumeLibrarySchema, type ResumeLibrary } from "./resume-library-contract";
import {
  recentResumeImportsSchema,
  type RecentResumeImport,
  type RecentResumeImports,
} from "./resume-import-status-contract";
import {
  resumeRevisionComparisonSchema,
  resumeRevisionResponseSchema,
  type ResumeRevisionComparison,
  type ResumeRevisionResponse,
} from "./resume-revision-contract";
import { resumeFileDeletionReceiptSchema } from "../db/resume-file-deletion-contract";

type Selection = { resumeId: string; revisionId: string };

function readableDate(value: number | string, includeTime = false) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit", timeZoneName: "short" } : {}),
    timeZone: "America/Los_Angeles",
  }).format(new Date(value));
}

function coverLetterStateLabel(state: CareerMaterialsCoverLetterArtifact["state"]) {
  if (state === "ready") return "Ready";
  return "Superseded";
}

function readableSize(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function providerLabel(value: "google_drive" | "local_file" | null) {
  if (value === "google_drive") return "Authenticated Google Doc";
  if (value === "local_file") return "Authorized local import";
  return "Legacy private import";
}

function importStatusCopy(value: RecentResumeImport) {
  if (value.status === "saved") return {
    label: "Saved",
    title: "Immutable revision saved",
    detail: "Both private files and the D1 revision receipt are durable.",
  };
  if (value.status === "staging") return {
    label: "Staging",
    title: "Import is still staging",
    detail: "This is not a saved revision yet. Refresh after the specialist completes authoritative readback.",
  };
  if (value.status === "retryable_failure") return {
    label: "Retry available",
    title: "The exact import can be retried",
    detail: "Return to the specialist and retry the same import receipt. Changed bytes or identities must use a new operation.",
  };
  return {
    label: "Stopped",
    title: "The import did not create a revision",
    detail: "This exact operation cannot be retried. Correct the reported source or request conflict, then start a new import.",
  };
}

async function responseJson(response: Response) {
  const value = await response.json() as unknown;
  if (!response.ok) {
    const error = value && typeof value === "object" && "error" in value && typeof value.error === "string"
      ? value.error
      : "Career Materials could not load.";
    throw new Error(error);
  }
  return value;
}

function RevisionDelta({ comparison }: { comparison: ResumeRevisionComparison | null | undefined }) {
  if (comparison === undefined) return <div className="materials-detail-state" role="status">Comparing immutable revisions…</div>;
  if (comparison === null) return <div className="materials-detail-state error"><strong>Comparison unavailable.</strong><span>The selected revision remains unchanged and readable.</span></div>;
  return <section className="materials-delta" aria-labelledby="materials-delta-title">
    <header>
      <div><h3 id="materials-delta-title">What changed from the parent</h3><p>Text and evidence links are compared by stable bullet occurrence—not semantic guesswork.</p></div>
      <span>{comparison.summary.changed + comparison.summary.added + comparison.summary.removed} changes</span>
    </header>
    <div className="materials-delta-counts" aria-label="Revision comparison totals">
      <span><strong>{comparison.summary.added}</strong>Added</span>
      <span><strong>{comparison.summary.changed}</strong>Changed</span>
      <span><strong>{comparison.summary.removed}</strong>Removed</span>
      <span><strong>{comparison.summary.unchanged}</strong>Unchanged</span>
    </div>
    {(comparison.added.length || comparison.changed.length || comparison.removed.length) ? <ol className="materials-change-list">
      {comparison.added.map((bullet) => <li className="added" key={`added-${bullet.occurrenceId}`}><span>Added</span><p>{bullet.text}</p></li>)}
      {comparison.changed.map((item) => <li className="changed" key={`changed-${item.occurrenceId}`}><span>Changed</span><div><p>{item.after.text}</p><small>{[
        item.changes.contentChanged ? "wording" : "",
        item.changes.positionChanged ? "position" : "",
        item.changes.claimDelta.added.length || item.changes.claimDelta.removed.length ? "claim links" : "",
        item.changes.evidenceDelta.added.length || item.changes.evidenceDelta.removed.length ? "evidence links" : "",
      ].filter(Boolean).join(" · ")}</small></div></li>)}
      {comparison.removed.map((bullet) => <li className="removed" key={`removed-${bullet.occurrenceId}`}><span>Removed</span><p>{bullet.text}</p></li>)}
    </ol> : <p className="materials-no-change">The extracted wording and semantic links are unchanged.</p>}
  </section>;
}

function RevisionDetail({
  selection,
  onLibraryChanged,
}: {
  selection: Selection;
  onLibraryChanged: () => void;
}) {
  const [detail, setDetail] = useState<ResumeRevisionResponse | null>();
  const [comparison, setComparison] = useState<ResumeRevisionComparison | null>();
  const [requestKey, setRequestKey] = useState(0);
  const [confirmingDeletion, setConfirmingDeletion] = useState(false);
  const [deletionMessage, setDeletionMessage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/resume-revisions/${encodeURIComponent(selection.resumeId)}/${encodeURIComponent(selection.revisionId)}`, {
      cache: "no-store",
      signal: controller.signal,
    }).then(responseJson).then((value) => resumeRevisionResponseSchema.parse(value)).then(setDetail).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setDetail(null);
    });
    return () => controller.abort();
  }, [requestKey, selection.resumeId, selection.revisionId]);

  useEffect(() => {
    const parentRevisionId = detail?.revision.parentRevisionId;
    if (!detail || !parentRevisionId) return;
    const controller = new AbortController();
    const parameters = new URLSearchParams({ from: parentRevisionId, to: detail.revision.revisionId });
    void fetch(`/api/resume-revisions/${encodeURIComponent(detail.source.resumeId)}/compare?${parameters}`, {
      cache: "no-store",
      signal: controller.signal,
    }).then(responseJson).then((value) => resumeRevisionComparisonSchema.parse(value)).then(setComparison).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setComparison(null);
    });
    return () => controller.abort();
  }, [detail]);

  if (detail === undefined) return <section className="materials-detail-state loading" role="status"><span aria-hidden="true" /><strong>Opening immutable revision…</strong></section>;
  if (detail === null) return <section className="materials-detail-state error" role="alert"><strong>This revision could not be opened.</strong><span>No newer or neighboring revision was substituted.</span><button type="button" onClick={() => { setDetail(undefined); setComparison(undefined); setRequestKey((value) => value + 1); }}>Retry exact revision</button></section>;

  const revision = detail.revision;
  const retention = revision.files[0]?.retention ?? {
    state: "deleted" as const,
    operationId: null,
    errorCode: null,
    updatedAt: null,
    deletedAt: null,
  };
  const claimCount = new Set(revision.bullets.flatMap((bullet) => bullet.claimIds)).size;
  const evidenceCount = new Set(revision.bullets.flatMap((bullet) => bullet.evidenceIds)).size;

  async function removePrivateFiles(operationId?: string | null) {
    const storageKey = `interview-arc-resume-file-deletion:${selection.resumeId}:${selection.revisionId}`;
    const exactOperationId = operationId
      ?? window.sessionStorage.getItem(storageKey)
      ?? `resume-file-delete-${crypto.randomUUID()}`;
    window.sessionStorage.setItem(storageKey, exactOperationId);
    setDeleting(true);
    setDeletionMessage(null);
    try {
      const response = await fetch(`/api/resume-revisions/${encodeURIComponent(selection.resumeId)}/${encodeURIComponent(selection.revisionId)}/files`, {
        method: "DELETE",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operationId: exactOperationId,
          authorization: "explicit_user_instruction",
          reason: "Owner requested permanent removal from Career Materials.",
        }),
      });
      const value = await response.json() as unknown;
      if (!response.ok) {
        const message = value && typeof value === "object" && "error" in value && typeof value.error === "string"
          ? value.error
          : "The private files were not fully removed. Retry this exact operation.";
        setConfirmingDeletion(false);
        setDeletionMessage(message);
        return;
      }
      resumeFileDeletionReceiptSchema.parse(value);
      window.sessionStorage.removeItem(storageKey);
      setConfirmingDeletion(false);
      setDetail(undefined);
      setComparison(undefined);
      setRequestKey((value) => value + 1);
      onLibraryChanged();
    } catch {
      setConfirmingDeletion(false);
      setDeletionMessage("The deletion receipt is uncertain. Retry this exact operation; do not start a different deletion.");
    } finally {
      setDeleting(false);
    }
  }

  return <article className="materials-revision" aria-labelledby="materials-revision-title">
    <header className="materials-revision-heading">
      <div>
        <span className={revision.current ? "current" : "historical"}>{revision.current ? "Current résumé" : "Historical revision"}</span>
        <h2 id="materials-revision-title">{detail.source.sourceLabel}</h2>
        <p>{providerLabel(revision.sourceProvider)} · Imported {readableDate(revision.importedAt, true)}</p>
      </div>
      <div className="materials-downloads" aria-label="Private resume downloads">
        {revision.files.filter((file) => file.downloadPath !== null).map((file) => <a href={file.downloadPath!} download key={file.format}><strong>{file.format.toUpperCase()}</strong><span>{readableSize(file.byteSize)}</span></a>)}
        {retention.state !== "retained" && <span className="materials-files-unavailable">Private files unavailable</span>}
      </div>
    </header>

    <dl className="materials-provenance">
      <div><dt>Revision</dt><dd>{revision.revisionId}</dd></div>
      <div><dt>Lineage</dt><dd>{revision.parentRevisionId ? `Follows ${revision.parentRevisionId}` : "Initial revision"}</dd></div>
      <div><dt>Extraction</dt><dd>{revision.extractionVersion ?? "Legacy · no semantic manifest"}</dd></div>
      <div><dt>Grounding</dt><dd>{claimCount} claims · {evidenceCount} evidence links</dd></div>
    </dl>

    <section className={`materials-retention ${retention.state}`} aria-labelledby="materials-retention-title">
      <div>
        <h3 id="materials-retention-title">Private-file retention</h3>
        {retention.state === "retained" && <p>{revision.current ? "Current revision files are retained and protected from deletion." : "DOCX and PDF are retained indefinitely until you explicitly remove this historical pair."}</p>}
        {retention.state === "deleting" && <p>The pair is being removed. Retry the exact operation if this state remains after refresh.</p>}
        {retention.state === "retryable_failure" && <p>The prior removal did not settle. The same operation must be retried; a new operation would be rejected.</p>}
        {retention.state === "deleted" && <p>DOCX and PDF were permanently removed{retention.deletedAt ? ` on ${readableDate(retention.deletedAt, true)}` : ""}. Integrity metadata, wording, semantic links, and activity provenance remain immutable.</p>}
        {deletionMessage && <span role="alert">{deletionMessage}</span>}
      </div>
      {retention.state === "retained" && !revision.current && !confirmingDeletion && <button type="button" className="danger" onClick={() => setConfirmingDeletion(true)}>Remove private files</button>}
      {(retention.state === "deleting" || retention.state === "retryable_failure") && retention.operationId && <button type="button" className="danger" disabled={deleting} onClick={() => void removePrivateFiles(retention.operationId)}>{deleting ? "Retrying exact removal…" : "Retry exact removal"}</button>}
      {deletionMessage && retention.state === "retained" && <button type="button" className="danger" disabled={deleting} onClick={() => void removePrivateFiles()}>{deleting ? "Retrying exact removal…" : "Retry exact removal"}</button>}
      {confirmingDeletion && retention.state === "retained" && <div className="materials-delete-confirm" role="group" aria-label="Confirm permanent private file removal">
        <strong>This cannot be undone.</strong><span>The immutable revision record stays, but its DOCX and PDF can never be downloaded or silently re-imported.</span><div><button type="button" onClick={() => setConfirmingDeletion(false)} disabled={deleting}>Keep files</button><button type="button" className="danger" onClick={() => void removePrivateFiles()} disabled={deleting}>{deleting ? "Removing exact pair…" : "Permanently remove files"}</button></div>
      </div>}
    </section>

    <section className="materials-bullets" aria-labelledby="materials-bullets-title">
      <header><div><h3 id="materials-bullets-title">Extracted résumé wording</h3><p>Private, revision-specific text. Links identify accepted evidence; wording never verifies itself.</p></div><span>{revision.bullets.length} bullets</span></header>
      {revision.bullets.length ? <ol>{revision.bullets.map((bullet) => <li key={bullet.occurrenceId}>
        <span>{bullet.sectionLabel}</span>
        <p>{bullet.text}</p>
        <small>{bullet.claimIds.length} claim{bullet.claimIds.length === 1 ? "" : "s"} · {bullet.evidenceIds.length} evidence link{bullet.evidenceIds.length === 1 ? "" : "s"}</small>
      </li>)}</ol> : <div className="materials-inline-empty"><strong>No semantic extraction for this legacy revision.</strong><span>The private DOCX and PDF remain intact and downloadable.</span></div>}
      {(revision.truncated.bullets || revision.truncated.links) && <p className="materials-bounded-note">This owner-private read reached its safety bound. Use the specialist for the exact remaining slice.</p>}
    </section>

    {revision.parentRevisionId ? <RevisionDelta comparison={comparison} /> : <section className="materials-origin"><h3>Initial immutable revision</h3><p>There is no parent to compare. Later imports append to this history; they never rewrite it.</p></section>}

    <section className="materials-review-impact" aria-labelledby="materials-impact-title">
      <header><div><h3 id="materials-impact-title">Behavioral review impact</h3><p>Only materially changed claim relationships can flag an exact Solution Profile revision.</p></div><span>{revision.reviewImpacts.length}</span></header>
      {revision.reviewImpacts.length ? <ol>{revision.reviewImpacts.map((impact) => <li key={impact.questionId}><strong>{impact.questionId}</strong><span>Solution Profile r{impact.solutionProfileRevision}</span><small>{impact.changedClaimIds.length} changed claim{impact.changedClaimIds.length === 1 ? "" : "s"} · {impact.status.replaceAll("_", " ")}</small></li>)}</ol> : <p className="materials-no-impact">No behavioral Solution Profile requires review from this revision.</p>}
    </section>
  </article>;
}

function CoverLetterHistory() {
  const [projection, setProjection] = useState<CareerMaterialsCoverLetterResponse | null>();
  const [requestKey, setRequestKey] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [paginationError, setPaginationError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/career-materials/cover-letters", { cache: "no-store", signal: controller.signal })
      .then(responseJson)
      .then((value) => careerMaterialsCoverLetterResponseSchema.parse(value))
      .then(setProjection)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setProjection(null);
      });
    return () => controller.abort();
  }, [requestKey]);

  async function loadOlder() {
    if (!projection?.page.nextCursor) return;
    setLoadingOlder(true);
    setPaginationError(null);
    try {
      const parameters = new URLSearchParams({ cursor: projection.page.nextCursor });
      const next = careerMaterialsCoverLetterResponseSchema.parse(await responseJson(
        await fetch(`/api/career-materials/cover-letters?${parameters}`, { cache: "no-store" }),
      ));
      setProjection((current) => {
        if (!current) return next;
        const existing = new Set(current.artifacts.map((artifact) => artifact.id));
        return {
          ...next,
          artifacts: [...current.artifacts, ...next.artifacts.filter((artifact) => !existing.has(artifact.id))],
        };
      });
    } catch {
      setPaginationError("Older cover letters could not be loaded. The records already shown remain authoritative.");
    } finally {
      setLoadingOlder(false);
    }
  }

  if (projection === undefined) return <section className="materials-cover-letter-state loading" aria-labelledby="materials-cover-letters-title" role="status">
    <span aria-hidden="true" />
    <div><h2 id="materials-cover-letters-title">Cover letters</h2><p>Reading your owner-private Interview Arc document library…</p></div>
  </section>;

  if (projection === null) return <section className="materials-cover-letter-state error" aria-labelledby="materials-cover-letters-title" role="alert">
    <div><h2 id="materials-cover-letters-title">Cover-letter history could not load.</h2><p>No empty history was inferred. Your résumé library above remains available.</p></div>
    <button type="button" onClick={() => { setPaginationError(null); setProjection(undefined); setRequestKey((value) => value + 1); }}>Retry history</button>
  </section>;

  return <section className="materials-cover-letters" aria-labelledby="materials-cover-letters-title">
    <header>
      <div><span className="materials-kicker">Private document library</span><h2 id="materials-cover-letters-title">Cover letters</h2><p>Immutable DOCX/PDF pairs with exact résumé, evidence, and job-description provenance. Creation stays with the specialist.</p></div>
      <div className="materials-provider-state connected"><i aria-hidden="true" />Interview Arc private storage</div>
    </header>
    {projection.artifacts.length === 0 ? <div className="materials-cover-letter-empty">
      <strong>No cover letter has been saved yet.</strong>
      <span>Give the Resume &amp; Cover Letter specialist a complete job description. After content and visual QA, both private formats appear here.</span>
    </div> : <ol className="materials-cover-letter-list">{projection.artifacts.map((artifact) => <li key={artifact.id}>
      <article>
        <header>
          <div><span className={`materials-cover-letter-state-label ${artifact.state}`}><i aria-hidden="true" />{coverLetterStateLabel(artifact.state)}</span><h3>{artifact.company}</h3><p>{artifact.role}</p></div>
          <time dateTime={artifact.createdAt}>{readableDate(artifact.createdAt, true)}</time>
        </header>
        <dl>
          <div><dt>Résumé revision</dt><dd>{artifact.resumeLabel ?? "Private résumé"} · <code>{artifact.resumeRevisionId}</code>{!artifact.resumeRevisionKnown && <small>Revision is outside this bounded library read</small>}</dd></div>
          <div><dt>Lineage</dt><dd>{artifact.parentRevisionId ? <>Follows <code>{artifact.parentRevisionId}</code></> : "Initial artifact"}</dd></div>
          <div><dt>Job description</dt><dd><code title={artifact.jobDescriptionSha256}>{artifact.jobDescriptionSha256.slice(0, 12)}…</code><small>Exact source fingerprint</small></dd></div>
          <div><dt>Private files</dt><dd>{artifact.files.map((file) => `${file.format.toUpperCase()} · ${readableSize(file.byteSize)}`).join(" · ")}</dd></div>
        </dl>
        <footer>
          <code title={artifact.id}>{artifact.id}</code>
          <div>{artifact.sourceUrl && <a href={artifact.sourceUrl} target="_blank" rel="noreferrer">Original posting</a>}{artifact.files.map((file) => <a key={file.format} className={file.format === "pdf" ? "primary" : undefined} href={file.downloadPath} aria-label={`Download ${artifact.company} ${artifact.role} cover letter as ${file.format.toUpperCase()}`}>Download {file.format.toUpperCase()}</a>)}</div>
        </footer>
      </article>
    </li>)}</ol>}
    {paginationError && <p className="materials-cover-letter-page-error" role="alert">{paginationError}</p>}
    {projection.page.hasMore && projection.page.nextCursor && <button className="materials-cover-letter-more" type="button" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? "Loading older artifacts…" : "Load older artifacts"}</button>}
  </section>;
}

export default function CareerMaterialsWorkspace() {
  const [library, setLibrary] = useState<ResumeLibrary | null>();
  const [imports, setImports] = useState<RecentResumeImports | null>();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [requestKey, setRequestKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/resume-library", { cache: "no-store", signal: controller.signal })
      .then(responseJson)
      .then((value) => resumeLibrarySchema.parse(value))
      .then(setLibrary)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLibrary(null);
      });
    return () => controller.abort();
  }, [requestKey]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/resume-imports", { cache: "no-store", signal: controller.signal })
      .then(responseJson)
      .then((value) => recentResumeImportsSchema.parse(value))
      .then(setImports)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setImports(null);
      });
    return () => controller.abort();
  }, [requestKey]);

  const revisionCount = useMemo(() => library?.sources.reduce((total, source) => total + source.revisions.length, 0) ?? 0, [library]);
  const currentSelection = useMemo(() => {
    if (!library?.sources.length) return null;
    if (selection && library.sources.some((source) => source.resumeId === selection.resumeId && source.revisions.some((revision) => revision.revisionId === selection.revisionId))) return selection;
    const firstSource = library.sources[0];
    const selectedRevision = firstSource.revisions.find((revision) => revision.current) ?? firstSource.revisions[0];
    return selectedRevision ? { resumeId: firstSource.resumeId, revisionId: selectedRevision.revisionId } : null;
  }, [library, selection]);

  return <section className="career-materials-workspace">
    <header className="materials-masthead">
      <div><h1>Your résumé,<br /><em>with its history intact.</em></h1><p>Every import is one owner-private DOCX/PDF pair with exact lineage. Career Materials shows what changed and what evidence it uses—without turning résumé wording into truth.</p></div>
      <aside className="materials-pair-seal"><span>One source revision</span><div><strong>DOCX</strong><i>matches</i><strong>PDF</strong></div><small>{revisionCount} immutable revision{revisionCount === 1 ? "" : "s"} stored</small></aside>
    </header>

    <div className="materials-trust-strip">
      <span><i aria-hidden="true" />Authenticated owner read</span>
      <span>Raw files stay in private object storage</span>
      <span>Google Drive and local locators stay off this page</span>
    </div>

    {imports === undefined && <div className="materials-import-state loading" role="status"><span aria-hidden="true" />Reading recent import receipts…</div>}
    {imports === null && <div className="materials-import-state error" role="alert"><div><strong>Import receipts are temporarily unavailable.</strong><span>The immutable library below remains authoritative.</span></div><button type="button" onClick={() => setRequestKey((value) => value + 1)}>Retry receipts</button></div>}
    {imports && imports.imports.length > 0 && <section className="materials-import-register" aria-labelledby="materials-import-title">
      <header><h2 id="materials-import-title">Recent import receipts</h2><small>{imports.imports.length}{imports.truncated ? "+" : ""} shown</small></header>
      <ol>{imports.imports.map((entry) => {
        const copy = importStatusCopy(entry);
        const sourceLabel = library?.sources.find((source) => source.resumeId === entry.resumeId)?.sourceLabel ?? entry.resumeId;
        return <li className={entry.status} key={entry.operationId}>
          <span>{copy.label}</span>
          <div><strong>{copy.title}</strong><p>{copy.detail}</p><small>{sourceLabel} · {entry.revisionId} · Updated {readableDate(entry.updatedAt, true)}</small></div>
          {entry.errorCode && <code>{entry.errorCode}</code>}
        </li>;
      })}</ol>
    </section>}

    {library === undefined && <div className="materials-library-state loading" role="status"><span aria-hidden="true" /><strong>Reading Career Materials…</strong></div>}
    {library === null && <div className="materials-library-state error" role="alert"><div><strong>Career Materials could not load.</strong><span>No résumé, current pointer, or import state was inferred.</span></div><button type="button" onClick={() => setRequestKey((value) => value + 1)}>Retry owner-private read</button></div>}
    {library?.sources.length === 0 && <div className="materials-library-empty">
      <div><h2>No résumé revision is stored yet.</h2><p>Give the Resume &amp; Cover Letter specialist a Google Doc URL and say “Import this resume.” It exports matching DOCX/PDF snapshots and confirms the durable revision here.</p></div>
      <ol><li><span>1</span><strong>Authorize one source</strong><small>The connector reads a native Google Doc; no public scraping.</small></li><li><span>2</span><strong>Freeze both formats</strong><small>DOCX and PDF must come from the same unchanged source revision.</small></li><li><span>3</span><strong>Read the receipt</strong><small>This page updates only after private files and D1 metadata are durable.</small></li></ol>
    </div>}

    {library && library.sources.length > 0 && currentSelection && <div className="materials-library-layout">
      <aside className="materials-revision-rail" aria-label="Resume revision history">
        <header><div><h2>Revision history</h2><p>Newest source activity first</p></div><button type="button" onClick={() => setRequestKey((value) => value + 1)}>Refresh</button></header>
        {library.sources.map((source) => <section key={source.resumeId}>
          <header><strong>{source.sourceLabel}</strong><small>Updated {readableDate(source.updatedAt)}</small></header>
          <ol>{source.revisions.map((revision) => {
            const selected = currentSelection.resumeId === source.resumeId && currentSelection.revisionId === revision.revisionId;
            return <li key={revision.revisionId}><button type="button" className={selected ? "selected" : ""} aria-current={selected ? "true" : undefined} onClick={() => setSelection({ resumeId: source.resumeId, revisionId: revision.revisionId })}>
              <span><strong>{readableDate(revision.importedAt)}</strong>{revision.current && <i>Current</i>}</span>
              <small>{revision.parentRevisionId ? "Revision update" : "Initial revision"}</small>
              <code>{revision.revisionId}</code>
            </button></li>;
          })}</ol>
        </section>)}
        {(library.truncated.sources || library.truncated.revisions) && <p className="materials-bounded-note">The newest bounded history is shown. The specialist can retrieve an exact older revision.</p>}
      </aside>
      <RevisionDetail key={`${currentSelection.resumeId}:${currentSelection.revisionId}`} selection={currentSelection} onLibraryChanged={() => setRequestKey((value) => value + 1)} />
    </div>}

    <CoverLetterHistory />

    <section className="materials-specialist-handoff" aria-labelledby="materials-specialist-title">
      <div><h2 id="materials-specialist-title">Create with the specialist; verify here.</h2><p>The Resume &amp; Cover Letter specialist imports résumés and drafts evidence-grounded cover letters from a complete job description. A Loop and Job Journey record are not required. Interview Arc stores the final private DOCX/PDF pair directly.</p></div>
      <ul><li>Use the exact current résumé revision</li><li>Keep unsupported claims out</li><li>Never rewrite old submissions</li></ul>
    </section>
  </section>;
}
