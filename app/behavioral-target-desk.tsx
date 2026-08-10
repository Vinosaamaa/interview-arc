"use client";

import { type FormEvent, useMemo, useState } from "react";

import {
  behavioralTargetProfileListSchema,
  behavioralTargetPublicPreviewSchema,
  type BehavioralTargetPublicPreview,
  type DisplaySafeBehavioralTargetRevision,
} from "./behavioral-target-contract";
import { behavioralTargetRequest, useBehavioralTargetProfiles } from "./behavioral-target-client";

type SourceMode = "pasted_jd" | "public_posting";
type FormDraft = {
  label: string;
  company: string;
  roleTitle: string;
  targetLevel: string;
  location: string;
  team: string;
  sourceMode: SourceMode;
  publicUrl: string;
  jdText: string;
  signals: string;
};

const EMPTY_FORM: FormDraft = {
  label: "",
  company: "",
  roleTitle: "",
  targetLevel: "",
  location: "",
  team: "",
  sourceMode: "pasted_jd",
  publicUrl: "",
  jdText: "",
  signals: "",
};

const lines = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);
const optional = (value: string) => value.trim() || undefined;
const operationId = (prefix: string) => `${prefix}-${crypto.randomUUID().toLowerCase()}`;
const stableSlug = (value: string) => value.toLowerCase().normalize("NFKD")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "target";

function sourceAgeState(target: DisplaySafeBehavioralTargetRevision) {
  return Date.now() - target.source.capturedAt > 7 * 86_400_000 ? "stale" : "current";
}

function TargetRevision({ target }: { target: DisplaySafeBehavioralTargetRevision }) {
  return <div className="target-revision-detail">
    <div><span>Company</span><strong>{target.company}</strong></div>
    <div><span>Role</span><strong>{target.roleTitle}</strong></div>
    {target.targetLevel && <div><span>Level</span><strong>{target.targetLevel}</strong></div>}
    {target.location && <div><span>Location</span><strong>{target.location}</strong></div>}
    {target.team && <div><span>Team</span><strong>{target.team}</strong></div>}
    <div className="target-source-summary"><span>Source</span><strong>{target.source.kind === "public_posting" ? "Public posting" : "Owner paste"}</strong><small>{target.source.displayLocator}</small><code>{target.source.fingerprint.slice(0, 12)}</code></div>
    {target.competencySignals.length > 0 && <div className="target-signal-list"><span>Competency signals</span><ul>{target.competencySignals.map((signal) => <li key={signal}>{signal}</li>)}</ul></div>}
  </div>;
}

export default function BehavioralTargetDesk({ enabled = true }: { enabled?: boolean }) {
  const { targets, error, refresh } = useBehavioralTargetProfiles(enabled);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DisplaySafeBehavioralTargetRevision | null>(null);
  const [draft, setDraft] = useState<FormDraft>(EMPTY_FORM);
  const [preview, setPreview] = useState<BehavioralTargetPublicPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [inspected, setInspected] = useState<Record<string, DisplaySafeBehavioralTargetRevision>>({});
  const activeCount = useMemo(() => targets?.filter((target) => target.state === "active").length ?? 0, [targets]);

  const update = (field: keyof FormDraft, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  const openCreate = () => {
    setEditing(null);
    setDraft(EMPTY_FORM);
    setPreview(null);
    setNotice(null);
    setFormOpen(true);
  };
  const openRevision = (target: DisplaySafeBehavioralTargetRevision) => {
    setEditing(target);
    setDraft({
      label: target.label,
      company: target.company,
      roleTitle: target.roleTitle,
      targetLevel: target.targetLevel ?? "",
      location: target.location ?? "",
      team: target.team ?? "",
      sourceMode: target.source.kind,
      publicUrl: target.source.kind === "public_posting" ? target.source.displayLocator : "",
      jdText: "",
      signals: target.competencySignals.join("\n"),
    });
    setPreview(null);
    setNotice("Provide the current job description again. Historical raw text never returns to the browser.");
    setFormOpen(true);
  };
  const importPublicPosting = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = behavioralTargetPublicPreviewSchema.parse(await behavioralTargetRequest("/api/behavioral-target-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: draft.publicUrl,
          ...(editing?.source.kind === "public_posting" ? { expectedFingerprint: editing.source.fingerprint } : {}),
        }),
      }));
      const { jdText, ...displaySource } = result.source;
      setPreview(result);
      setDraft((current) => ({ ...current, publicUrl: displaySource.displayLocator, jdText }));
      setNotice(result.change === "changed" ? "Available · the posting changed since the saved revision." : result.change === "unchanged" ? "Available · content matches the saved revision." : "Available · ready for owner review.");
    } catch (reason) {
      setPreview(null);
      setNotice(reason instanceof Error ? reason.message : "The public posting is unavailable. Paste the description instead.");
    } finally {
      setBusy(false);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if ((draft.sourceMode === "pasted_jd" && !draft.jdText.trim()) || (draft.sourceMode === "public_posting" && !preview)) {
      setNotice(draft.sourceMode === "public_posting" ? "Import the public posting before saving." : "Paste the job description before saving.");
      return;
    }
    setBusy(true);
    setNotice(null);
    const targetId = editing?.targetId
      ?? `target-${stableSlug(draft.company)}-${stableSlug(draft.roleTitle)}-${crypto.randomUUID().slice(0, 8).toLowerCase()}`;
    try {
      await behavioralTargetRequest("/api/behavioral-targets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "upsert", input: {
          operationId: operationId("website-target-save"),
          expectedRevision: editing?.revision ?? 0,
          target: {
            targetId,
            label: draft.label,
            state: "active",
            company: draft.company,
            roleTitle: draft.roleTitle,
            targetLevel: optional(draft.targetLevel),
            location: optional(draft.location),
            team: optional(draft.team),
            source: draft.sourceMode === "public_posting"
              ? {
                  kind: "public_posting",
                  displayLocator: preview!.source.displayLocator,
                  expectedFingerprint: preview!.source.fingerprint,
                }
              : {
                  kind: "pasted_jd",
                  displayLocator: "Owner-provided job description",
                  capturedAt: Date.now(),
                  jdText: draft.jdText,
                },
            responsibilities: [],
            requiredQualifications: [],
            preferredQualifications: [],
            competencySignals: lines(draft.signals),
            seniorityIndicators: [],
            domainVocabulary: [],
            verifiedCompanySignals: [],
            unresolvedAmbiguities: [],
            ownerNotes: [],
          },
        } }),
      });
      await refresh();
      setDraft(EMPTY_FORM);
      setPreview(null);
      setEditing(null);
      setFormOpen(false);
      setNotice("Target Profile saved as a new immutable revision.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "The Target Profile was not saved.");
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const setState = async (target: DisplaySafeBehavioralTargetRevision) => {
    setBusy(true);
    setNotice(null);
    try {
      await behavioralTargetRequest("/api/behavioral-targets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "set_state", input: {
          operationId: operationId(`website-target-${target.state === "active" ? "archive" : "reactivate"}`),
          targetId: target.targetId,
          expectedRevision: target.revision,
          state: target.state === "active" ? "archived" : "active",
        } }),
      });
      await refresh();
      setNotice(target.state === "active" ? "Target archived. Historical bindings remain exact." : "Target reactivated as a new revision.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "The target state did not change.");
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const inspectRevision = async (target: DisplaySafeBehavioralTargetRevision, revision: number) => {
    try {
      const payload = behavioralTargetProfileListSchema.parse(await behavioralTargetRequest(`/api/behavioral-targets?includeArchived=true&targetId=${encodeURIComponent(target.targetId)}&revision=${revision}`));
      if (payload.targets[0]) setInspected((current) => ({ ...current, [target.targetId]: payload.targets[0] }));
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "That historical revision is unavailable.");
    }
  };

  return <section className="behavioral-target-desk" aria-labelledby="behavioral-target-desk-title">
    <header><div><span className="eyebrow">TARGET PROFILES · OWNER PRIVATE</span><h2 id="behavioral-target-desk-title">Aim each answer at an exact role.</h2><p>Job descriptions are stored privately. Cards expose only the sanitized revision used by practice.</p></div><div><strong>{activeCount}</strong><span>active target{activeCount === 1 ? "" : "s"}</span><button type="button" onClick={openCreate}>Create Target Profile</button></div></header>
    {error && <div className="target-notice error" role="alert"><span>{error}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}
    {notice && <div className="target-notice" role="status">{notice}</div>}
    {targets === undefined && <div className="target-loading" role="status">Reading owner-private targets…</div>}
    {targets?.length === 0 && <div className="target-empty"><strong>No Target Profiles yet.</strong><span>Create one from an owner paste or import a public posting.</span></div>}
    {targets && targets.length > 0 && <div className="target-card-grid">{targets.map((target) => {
      const shown = inspected[target.targetId] ?? target;
      return <article className={`target-card ${target.state}`} key={target.targetId}>
        <header><div><span>{target.state === "active" ? "Active" : "Archived"}</span>{target.source.kind === "public_posting" && <i className={sourceAgeState(target)}>{sourceAgeState(target)}</i>}</div><small>Revision {shown.revision} of {target.revision}</small></header>
        <h3>{target.label}</h3>
        <TargetRevision target={shown} />
        {target.revision > 1 && <label className="target-revision-picker"><span>Inspect immutable revision</span><select value={shown.revision} onChange={(event) => void inspectRevision(target, Number(event.target.value))}>{Array.from({ length: target.revision }, (_, index) => index + 1).reverse().map((revision) => <option value={revision} key={revision}>Revision {revision}</option>)}</select></label>}
        <footer><button type="button" onClick={() => openRevision(target)} disabled={busy}>Revise</button><button type="button" onClick={() => void setState(target)} disabled={busy}>{target.state === "active" ? "Archive" : "Reactivate"}</button></footer>
      </article>;
    })}</div>}
    {formOpen && <form className="target-editor" onSubmit={submit} aria-labelledby="target-editor-title">
      <header><div><span className="eyebrow">{editing ? `REVISION ${editing.revision + 1}` : "NEW TARGET"}</span><h3 id="target-editor-title">{editing ? `Revise ${editing.label}` : "Create Target Profile"}</h3></div><button type="button" onClick={() => setFormOpen(false)} aria-label="Close Target Profile editor">×</button></header>
      <div className="target-form-grid">
        <label><span>Label</span><input required value={draft.label} onChange={(event) => update("label", event.target.value)} /></label>
        <label><span>Company</span><input required value={draft.company} onChange={(event) => update("company", event.target.value)} /></label>
        <label><span>Role title</span><input required value={draft.roleTitle} onChange={(event) => update("roleTitle", event.target.value)} /></label>
        <label><span>Target level</span><input value={draft.targetLevel} onChange={(event) => update("targetLevel", event.target.value)} /></label>
        <label><span>Location</span><input value={draft.location} onChange={(event) => update("location", event.target.value)} /></label>
        <label><span>Team</span><input value={draft.team} onChange={(event) => update("team", event.target.value)} /></label>
      </div>
      <div className="target-source-tabs" role="group" aria-label="Job description source"><button type="button" className={draft.sourceMode === "pasted_jd" ? "active" : ""} onClick={() => { setDraft((current) => ({ ...current, sourceMode: "pasted_jd", publicUrl: "", jdText: "" })); setPreview(null); }}>Paste job description</button><button type="button" className={draft.sourceMode === "public_posting" ? "active" : ""} onClick={() => { setDraft((current) => ({ ...current, sourceMode: "public_posting", jdText: "" })); setPreview(null); }}>Import public posting</button></div>
      {draft.sourceMode === "pasted_jd" ? <label className="target-jd-field"><span>Private job description</span><textarea required rows={8} value={draft.jdText} onChange={(event) => update("jdText", event.target.value)} /><small>Stored owner-private; never rendered after save.</small></label> : <div className="target-public-import"><label><span>Public posting URL</span><input type="url" required value={draft.publicUrl} onChange={(event) => { update("publicUrl", event.target.value); setPreview(null); update("jdText", ""); }} /></label><button type="button" disabled={busy || !draft.publicUrl} onClick={() => void importPublicPosting()}>{busy ? "Checking…" : "Import securely"}</button></div>}
      <label className="target-jd-field"><span>Competency signals · one per line</span><textarea rows={4} value={draft.signals} onChange={(event) => update("signals", event.target.value)} /><small>Owner-authored labels only. The posting never issues instructions to Interview Arc.</small></label>
      <footer><button type="button" onClick={() => setFormOpen(false)}>Cancel</button><button className="primary-action" type="submit" disabled={busy}>{busy ? "Saving…" : editing ? "Save new revision" : "Create target"}</button></footer>
    </form>}
  </section>;
}
