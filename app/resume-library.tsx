"use client";

import { useEffect, useState } from "react";
import { resumeLibrarySchema, type ResumeLibrary as ResumeLibraryValue } from "./resume-library-contract";

function readableDate(value: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(new Date(value));
}

function readableSize(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ResumeLibrary({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [library, setLibrary] = useState<ResumeLibraryValue | null>();
  const [requestKey, setRequestKey] = useState(0);

  useEffect(() => {
    if (!enabled || !open || library !== undefined) return;
    const controller = new AbortController();
    void fetch("/api/resume-library", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Resume Library could not load.");
        return resumeLibrarySchema.parse(await response.json());
      })
      .then(setLibrary)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLibrary(null);
      });
    return () => controller.abort();
  }, [enabled, library, open, requestKey]);

  return (
    <section className={`resume-library ${open ? "open" : ""}`} aria-labelledby="resume-library-title">
      <button
        type="button"
        className="resume-library-toggle"
        aria-expanded={open}
        aria-controls="resume-library-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="resume-library-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="M6.5 3.5h8l3 3v14h-11z" stroke="currentColor" strokeWidth="1.5"/><path d="M14.5 3.5v3h3M9 11h6M9 15h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </span>
        <span><strong id="resume-library-title">Resume Library</strong><small>Immutable private DOCX and PDF revisions</small></span>
        <span className="resume-library-count">{library?.sources.reduce((total, source) => total + source.revisions.length, 0) ?? "—"}</span>
        <svg className="resume-library-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
      <div className="resume-library-panel" id="resume-library-panel" aria-hidden={!open} inert={open ? undefined : true}>
        <div>
          {library === undefined && <div className="resume-library-state" role="status">Reading immutable revisions…</div>}
          {library === null && <div className="resume-library-state error" role="alert"><span><strong>Resume Library is unavailable.</strong><small>No file or revision was inferred.</small></span><button type="button" onClick={() => { setLibrary(undefined); setRequestKey((value) => value + 1); }}>Retry</button></div>}
          {library?.sources.length === 0 && <div className="resume-library-state empty"><strong>No resume revisions yet.</strong><span>The first authorized import will appear here after both private files are durable.</span></div>}
          {library && library.sources.length > 0 && <div className="resume-library-sources">
            {library.sources.map((source) => <section className="resume-source" key={source.resumeId}>
              <header><span><strong>{source.sourceLabel}</strong><small>{source.revisions.length} revision{source.revisions.length === 1 ? "" : "s"}</small></span><small>Updated {readableDate(source.updatedAt)}</small></header>
              <ol>{source.revisions.map((revision) => <li key={revision.revisionId}>
                <div className="resume-revision-identity"><strong>{readableDate(revision.importedAt)}</strong><code>{revision.revisionId}</code>{revision.current && <span>Current</span>}</div>
                <div className="resume-revision-lineage"><small>{revision.parentRevisionId ? `Follows ${revision.parentRevisionId}` : "Initial revision"}</small></div>
                <div className="resume-file-actions">{revision.files.map((file) => <a href={file.downloadPath} download key={file.format}><strong>{file.format.toUpperCase()}</strong><span>{readableSize(file.byteSize)}</span></a>)}</div>
              </li>)}</ol>
            </section>)}
            {(library.truncated.sources || library.truncated.revisions) && <p className="resume-library-limit">The newest bounded revision history is shown.</p>}
          </div>}
        </div>
      </div>
    </section>
  );
}
