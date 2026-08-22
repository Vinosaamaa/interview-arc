"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";

import { acquireDocumentScrollLock } from "./document-scroll-policy";

type DraftStage = {
  key: string;
  label: string;
  status: "planned" | "scheduled";
  scheduledOn: string;
  format: string;
};

type LoopReceipt = {
  loopId: string;
  loopRevision: number;
  roleBriefRevision: number;
  receiptId: string;
  duplicate: boolean;
};

const steps = ["Role basics", "Known stages", "Review"] as const;

function freshStage(): DraftStage {
  return { key: crypto.randomUUID(), label: "", status: "planned", scheduledOn: "", format: "" };
}

function firstError(step: number, input: {
  company: string;
  roleTitle: string;
  location: string;
  locationUnknown: boolean;
  openedOn: string;
  openedOnUnknown: boolean;
  jobText: string;
  sourceUrl: string;
  jobTextUnknown: boolean;
  stages: DraftStage[];
  stagesUnknown: boolean;
}) {
  if (step === 0) {
    if (!input.company.trim()) return "Enter the company.";
    if (!input.roleTitle.trim()) return "Enter the role.";
    if (!input.location.trim() && !input.locationUnknown) return "Enter the location or mark it unknown.";
    if (!input.openedOn && !input.openedOnUnknown) return "Enter the opened date or mark it unknown.";
    if (!input.jobText.trim() && !input.sourceUrl.trim()) return "Paste job-description text or add its HTTPS source URL.";
    if (!input.jobText.trim() && !input.jobTextUnknown) return "Paste job-description text or explicitly mark the text unknown.";
    if (input.sourceUrl.trim()) {
      try {
        const source = new URL(input.sourceUrl.trim());
        if (source.protocol !== "https:" || source.username || source.password) throw new Error("unsafe");
      } catch {
        return "Use a credential-free HTTPS job source URL.";
      }
    }
  }
  if (step === 1) {
    if (!input.stages.length && !input.stagesUnknown) return "Add a known stage or mark the stages unknown.";
    for (const stage of input.stages) {
      if (!stage.label.trim()) return "Give every stage a label.";
      if (stage.status === "scheduled" && !stage.scheduledOn) return "Give every scheduled stage its known date.";
    }
  }
  return "";
}

export default function LoopCreateDialog({
  opener,
  onClose,
  onCreated,
  inline = false,
}: {
  opener: HTMLButtonElement | null;
  onClose: () => void;
  onCreated: (receipt: LoopReceipt) => void;
  inline?: boolean;
}) {
  const [step, setStep] = useState(0);
  const [company, setCompany] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [location, setLocation] = useState("");
  const [locationUnknown, setLocationUnknown] = useState(false);
  const [openedOn, setOpenedOn] = useState("");
  const [openedOnUnknown, setOpenedOnUnknown] = useState(false);
  const [jobText, setJobText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [jobTextUnknown, setJobTextUnknown] = useState(false);
  const [stages, setStages] = useState<DraftStage[]>([]);
  const [stagesUnknown, setStagesUnknown] = useState(false);
  const [operationId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);
  const [receipt, setReceipt] = useState<LoopReceipt | null>(null);
  const applyingRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstControlRef = useRef<HTMLInputElement | HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    applyingRef.current = applying;
  }, [applying]);

  const formState = useMemo(() => ({
    company,
    roleTitle,
    location,
    locationUnknown,
    openedOn,
    openedOnUnknown,
    jobText,
    sourceUrl,
    jobTextUnknown,
    stages,
    stagesUnknown,
  }), [company, jobText, jobTextUnknown, location, locationUnknown, openedOn, openedOnUnknown, roleTitle, sourceUrl, stages, stagesUnknown]);

  useEffect(() => {
    if (inline) {
      const frame = window.requestAnimationFrame(() => firstControlRef.current?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
    const workspace = document.querySelector<HTMLElement>("[data-loop-workspace-root]");
    const releaseScrollLock = acquireDocumentScrollLock();
    const previousInert = workspace?.inert ?? false;
    if (workspace) workspace.inert = true;
    const frame = window.requestAnimationFrame(() => firstControlRef.current?.focus() ?? closeRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !applyingRef.current) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])') ?? [])]
        .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
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
  }, [inline, onClose, opener]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => firstControlRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  function advance() {
    const message = firstError(step, formState);
    if (message) { setError(message); return; }
    setError("");
    setStep((current) => Math.min(2, current + 1));
  }

  async function createLoop() {
    const message = firstError(0, formState) || firstError(1, formState);
    if (message) { setError(message); return; }
    setApplying(true);
    setError("");
    try {
      const unknowns = [
        locationUnknown ? "location" : "",
        openedOnUnknown ? "openedOn" : "",
        stagesUnknown ? "stages" : "",
        jobTextUnknown ? "jobDescriptionText" : "",
      ].filter(Boolean);
      const response = await fetch("/api/loops", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": operationId },
        body: JSON.stringify({
          schemaVersion: 1,
          operationId,
          company: company.trim(),
          roleTitle: roleTitle.trim(),
          ...(location.trim() ? { location: location.trim() } : {}),
          ...(openedOn ? { openedOn } : {}),
          jobDescription: {
            ...(jobText.trim() ? { text: jobText.trim() } : {}),
            ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}),
          },
          stages: stages.map(({ label, status, scheduledOn, format }) => ({
            label: label.trim(),
            status,
            ...(scheduledOn ? { scheduledOn } : {}),
            ...(format.trim() ? { format: format.trim() } : {}),
          })),
          unknowns,
        }),
      });
      const body = await response.json() as LoopReceipt & { error?: string };
      if (!response.ok) throw new Error(body.error || "The Loop could not be created.");
      setReceipt(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Loop could not be created.");
    } finally {
      setApplying(false);
    }
  }

  const composer = <div className={`loop-create-dialog ${inline ? "inline" : ""}`} role={inline ? undefined : "dialog"} aria-modal={inline ? undefined : true} aria-labelledby="loop-create-title" ref={dialogRef}>
      <header className="loop-create-header">
        <div><span>Private hiring record</span><h2 id="loop-create-title">{inline ? "Add another Loop" : "Add a Loop"}</h2><p>Record only what you know. Unknown facts stay unknown.</p></div>
        <button type="button" className="loop-jd-close" onClick={onClose} disabled={applying} ref={closeRef} aria-label="Close Add Loop"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button>
      </header>
      {!receipt ? <>
        <nav className="loop-create-steps" aria-label="Loop creation steps">{steps.map((label, index) => <button type="button" key={label} className={index === step ? "current" : index < step ? "complete" : ""} aria-label={`${index + 1}. ${label}`} aria-current={index === step ? "step" : undefined} onClick={() => { if (index < step) { setStep(index); setError(""); } }} disabled={index > step || applying}><b aria-hidden="true">{index + 1}</b><span>{label}</span></button>)}</nav>
        <div className="loop-create-body">
          {step === 0 ? <section className="loop-create-panel" aria-labelledby="loop-create-basics">
            <div className="loop-create-section-heading"><span>01 · Identity</span><h3 id="loop-create-basics">The company-and-role truth</h3><p>This identity never changes. A different company or role becomes a different Loop.</p></div>
            <div className="loop-create-grid two"><label><span>Company <b>Required</b></span><input ref={(node) => { firstControlRef.current = node; }} value={company} onChange={(event) => setCompany(event.target.value)} autoComplete="organization" maxLength={240} /></label><label><span>Role <b>Required</b></span><input value={roleTitle} onChange={(event) => setRoleTitle(event.target.value)} autoComplete="organization-title" maxLength={240} /></label></div>
            <div className="loop-create-grid two"><fieldset><legend>Location</legend><input value={location} onChange={(event) => setLocation(event.target.value)} disabled={locationUnknown} maxLength={240} placeholder="City, region, or remote" /><label className="loop-unknown"><input type="checkbox" checked={locationUnknown} onChange={(event) => { setLocationUnknown(event.target.checked); if (event.target.checked) setLocation(""); }} /> Unknown</label></fieldset><fieldset><legend>Process opened</legend><input type="date" value={openedOn} onChange={(event) => setOpenedOn(event.target.value)} disabled={openedOnUnknown} /><label className="loop-unknown"><input type="checkbox" checked={openedOnUnknown} onChange={(event) => { setOpenedOnUnknown(event.target.checked); if (event.target.checked) setOpenedOn(""); }} /> Unknown</label></fieldset></div>
            <div className="loop-create-source"><div className="loop-create-section-heading"><span>02 · Source</span><h3>Initial Role Brief source</h3><p>Interview Arc stores the exact text you paste or the link you provide. It does not crawl, summarize, or infer.</p></div><label><span>Job-description text</span><textarea value={jobText} onChange={(event) => setJobText(event.target.value)} disabled={jobTextUnknown} rows={8} maxLength={100000} placeholder="Paste the original job description…" /></label><label className="loop-unknown"><input type="checkbox" checked={jobTextUnknown} onChange={(event) => { setJobTextUnknown(event.target.checked); if (event.target.checked) setJobText(""); }} /> Text not supplied</label><label><span>Source URL <small>Optional when text is pasted</small></span><input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://…" maxLength={240} /></label></div>
          </section> : null}
          {step === 1 ? <section className="loop-create-panel" aria-labelledby="loop-create-stages">
            <div className="loop-create-section-heading"><span>03 · Process</span><h3 id="loop-create-stages">Known interview stages</h3><p>Add only stages you actually know. You can revise the Loop later.</p></div>
            <label className="loop-unknown prominent"><input ref={(node) => { firstControlRef.current = node; }} type="checkbox" checked={stagesUnknown} onChange={(event) => { setStagesUnknown(event.target.checked); if (event.target.checked) setStages([]); }} /> The interview stages are not known yet</label>
            {!stagesUnknown ? <div className="loop-stage-editor">{stages.map((stage, index) => <article key={stage.key}><b>{String(index + 1).padStart(2, "0")}</b><div><label><span>Stage label</span><input value={stage.label} onChange={(event) => setStages((current) => current.map((item) => item.key === stage.key ? { ...item, label: event.target.value } : item))} maxLength={240} placeholder="Recruiter screen" /></label><div className="loop-create-grid three"><label><span>Status</span><select value={stage.status} onChange={(event) => setStages((current) => current.map((item) => item.key === stage.key ? { ...item, status: event.target.value as DraftStage["status"], scheduledOn: event.target.value === "planned" ? "" : item.scheduledOn } : item))}><option value="planned">Planned</option><option value="scheduled">Scheduled</option></select></label><label><span>Date</span><input type="date" value={stage.scheduledOn} disabled={stage.status !== "scheduled"} onChange={(event) => setStages((current) => current.map((item) => item.key === stage.key ? { ...item, scheduledOn: event.target.value } : item))} /></label><label><span>Format <small>Optional</small></span><input value={stage.format} onChange={(event) => setStages((current) => current.map((item) => item.key === stage.key ? { ...item, format: event.target.value } : item))} maxLength={240} placeholder="Video · 45 min" /></label></div></div><button type="button" onClick={() => setStages((current) => current.filter((item) => item.key !== stage.key))} aria-label={`Remove stage ${index + 1}`}>Remove</button></article>)}<button ref={(node) => { firstControlRef.current = node; }} type="button" className="loop-add-stage" onClick={() => setStages((current) => [...current, freshStage()])}>+ Add known stage</button></div> : null}
          </section> : null}
          {step === 2 ? <section className="loop-create-panel loop-create-review" aria-labelledby="loop-create-review">
            <div className="loop-create-section-heading"><span>04 · Commit</span><h3 id="loop-create-review">Review the immutable first revision</h3><p>One command creates the Loop and Role Brief revision 1 together—or creates neither.</p></div>
            <article className="loop-review-identity"><span>Active Loop</span><h4>{company} · {roleTitle}</h4><p>{[location || "Location unknown", openedOn ? `Opened ${openedOn}` : "Opened date unknown"].join(" · ")}</p></article>
            <div className="loop-review-columns"><article><span>Role Brief · revision 1</span><strong>{jobText ? "Exact pasted text" : "Source link only"}</strong><p>{sourceUrl || "Pasted source"}</p><small>Structured responsibilities and signals remain empty until explicitly revised.</small></article><article><span>Interview stages</span><strong>{stagesUnknown ? "Unknown" : `${stages.length} recorded`}</strong>{stages.length ? <ol>{stages.map((stage) => <li key={stage.key}>{stage.label} · {stage.status}</li>)}</ol> : <p>No stage facts will be invented.</p>}</article></div>
            <aside><strong>No AI or provider call</strong><p>This is a deterministic, owner-authenticated D1 command with one idempotent receipt.</p></aside>
          </section> : null}
          {error ? <p className="loop-create-error" role="alert">{error}</p> : null}
        </div>
        <footer className="loop-create-footer"><button type="button" className="secondary" onClick={step ? () => { setStep((current) => current - 1); setError(""); } : onClose} disabled={applying}>{step ? "Back" : "Cancel"}</button>{step < 2 ? <button type="button" className="primary" onClick={advance}>Continue</button> : <button type="button" className="primary" onClick={() => void createLoop()} disabled={applying}>{applying ? "Creating Loop…" : "Create Loop"}</button>}</footer>
      </> : <section className="loop-create-success" aria-live="polite"><span aria-hidden="true">✓</span><div><small>Atomic command complete</small><h3>Loop and Role Brief created.</h3><p>Loop revision {receipt.loopRevision} and Role Brief revision {receipt.roleBriefRevision} share one durable receipt.</p><code>{receipt.receiptId}</code></div><button type="button" onClick={() => onCreated(receipt)}>Open new Loop</button></section>}
    </div>;
  if (inline) return <div className="loop-create-inline tone-loops">{composer}</div>;
  return createPortal(<div className="loop-create-overlay tone-loops" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !applying) onClose();
  }}>{composer}</div>, document.body);
}
