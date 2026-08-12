"use client";

import { useMemo, useRef, useState } from "react";

import {
  behavioralTargetProfileListSchema,
  type DisplaySafeBehavioralTargetRevision,
} from "./behavioral-target-contract";
import { behavioralTargetRequest, useBehavioralTargetProfiles } from "./behavioral-target-client";

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
  const [inspected, setInspected] = useState<Record<string, DisplaySafeBehavioralTargetRevision>>({});
  const [requestedRevisions, setRequestedRevisions] = useState<Record<string, number>>({});
  const latestRevisionRequest = useRef<Record<string, number>>({});
  const legacyCount = useMemo(() => targets?.length ?? 0, [targets]);

  const inspectRevision = async (target: DisplaySafeBehavioralTargetRevision, revision: number) => {
    latestRevisionRequest.current[target.targetId] = revision;
    setRequestedRevisions((current) => ({ ...current, [target.targetId]: revision }));
    try {
      const payload = behavioralTargetProfileListSchema.parse(await behavioralTargetRequest(`/api/behavioral-targets?includeArchived=true&targetId=${encodeURIComponent(target.targetId)}&revision=${revision}`));
      if (latestRevisionRequest.current[target.targetId] === revision && payload.targets[0]?.revision === revision) {
        setInspected((current) => ({ ...current, [target.targetId]: payload.targets[0] }));
      }
    } catch {
      if (latestRevisionRequest.current[target.targetId] === revision) {
        setRequestedRevisions((current) => Object.fromEntries(
          Object.entries(current).filter(([targetId]) => targetId !== target.targetId),
        ));
        await refresh();
      }
    }
  };

  return <section className="behavioral-target-desk" aria-labelledby="behavioral-target-desk-title">
    <header><div><span className="eyebrow">LEGACY TARGET PROFILES · MIGRATION ONLY</span><h2 id="behavioral-target-desk-title">Move role context into its hiring Loop.</h2><p>Historical revisions remain exact and readable. The Loop Recorder creates or attaches one immutable Loop-owned Role Brief; Behavioral cannot create a competing profile.</p></div><div><strong>{legacyCount}</strong><span>legacy records</span></div></header>
    <div className="target-notice" role="status"><span>Ask <strong>Interview Arc — Loop Recorder</strong> to inspect its migration inbox and choose Create Loop, Attach to existing Loop, or Archive. Nothing is inferred or deleted.</span></div>
    {error && <div className="target-notice error" role="alert"><span>{error}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}
    {targets === undefined && <div className="target-loading" role="status">Reading migration-only Target Profiles…</div>}
    {targets?.length === 0 && <div className="target-empty"><strong>No active standalone Target Profiles remain.</strong><span>New role context starts as a Loop-owned Role Brief.</span></div>}
    {targets && targets.length > 0 && <div className="target-card-grid">{targets.map((target) => {
      const shown = inspected[target.targetId] ?? target;
      return <article className={`target-card ${shown.state}`} key={target.targetId}>
        <header><div><span>{shown.state === "active" ? "Active legacy record" : "Archived legacy record"}</span>{shown.source.kind === "public_posting" && <i className={sourceAgeState(shown)}>{sourceAgeState(shown)}</i>}</div><small>Revision {shown.revision} of {target.revision}</small></header>
        <h3>{shown.label}</h3>
        <TargetRevision target={shown} />
        {target.revision > 1 && <label className="target-revision-picker"><span>Inspect immutable revision</span><input type="number" inputMode="numeric" min={1} max={target.revision} value={requestedRevisions[target.targetId] ?? shown.revision} aria-label={`Inspect ${shown.label} revision, from 1 to ${target.revision}`} onChange={(event) => { const revision = Number(event.target.value); if (Number.isInteger(revision) && revision >= 1 && revision <= target.revision) void inspectRevision(target, revision); }} /></label>}
        <footer><span>Read-only historical record · Loop Recorder migration required</span></footer>
      </article>;
    })}</div>}
  </section>;
}
