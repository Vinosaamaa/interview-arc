"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { ExtraActivity, LocalSession } from "./live-types";
import {
  behavioralTargetBindingBatchReadSchema,
  type BehavioralTargetBindingRead,
  type DisplaySafeBehavioralTargetRevision,
} from "./behavioral-target-contract";
import { behavioralTargetRequest, useBehavioralTargetProfiles } from "./behavioral-target-client";

type Scope = { type: "session" | "activity"; id: string; label: string; detail: string };

const mutationId = () => `website-target-binding-${crypto.randomUUID().toLowerCase()}`;

function TargetBindingRow({
  scope,
  targets,
  state,
  onChanged,
}: {
  scope: Scope;
  targets: DisplaySafeBehavioralTargetRevision[];
  state?: BehavioralTargetBindingRead;
  onChanged: () => Promise<boolean>;
}) {
  const [selection, setSelection] = useState(state?.directBinding?.targetId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const write = async (action: "set" | "clear") => {
    const target = targets.find((candidate) => candidate.targetId === selection);
    if (action === "set" && !target) return;
    setBusy(true);
    setError(null);
    try {
      await behavioralTargetRequest("/api/behavioral-target-bindings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mutationId: mutationId(),
          scope: { type: scope.type, id: scope.id },
          action,
          ...(action === "set" ? { targetId: target!.targetId, targetRevision: target!.revision } : {}),
          expectedRevision: state?.directBinding?.revision ?? 0,
          authorization: "explicit_user_instruction",
        }),
      });
      await onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The target binding did not change.");
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const sourceLabel = !state
    ? "Resolving"
    : state.resolution.source === "activity"
      ? "Activity override"
      : state.resolution.source === "session" && scope.type === "activity"
        ? "Inherited from session"
        : state.resolution.source === "session"
          ? "Session target"
          : "No target";
  return <article className={`target-binding-row ${state?.resolution.source ?? "loading"}`}>
    <div><span>{scope.type === "session" ? "Session" : "Behavioral activity"}</span><strong>{scope.label}</strong><small>{scope.detail}</small></div>
    <div className="target-binding-status"><span>{sourceLabel}</span><strong>{!state ? "Reading binding…" : state.resolution.target?.label ?? "Universal practice"}</strong>{state?.resolution.target && <small>Exact revision {state.resolution.target.revision}</small>}</div>
    <label><span>{scope.type === "activity" ? "Activity override" : "Session target"}</span><select value={selection} onChange={(event) => setSelection(event.target.value)} disabled={busy || targets.length === 0}><option value="">Choose an active target…</option>{targets.map((target) => <option value={target.targetId} key={target.targetId}>{target.label} · r{target.revision}</option>)}</select></label>
    <div className="target-binding-actions"><button type="button" disabled={busy || !selection} onClick={() => void write("set")}>Set exact revision</button><button type="button" disabled={busy || !state?.directBinding} onClick={() => void write("clear")}>{scope.type === "activity" ? "Clear override" : "Clear target"}</button></div>
    {error && <p role="alert">{error} Reread completed; choose the current revision before retrying.</p>}
  </article>;
}

export default function BehavioralTargetBindings({
  activities,
  sessions,
}: {
  activities: ExtraActivity[];
  sessions: LocalSession[];
}) {
  const behavioralActivities = useMemo(() => activities.filter((activity) => activity.type === "behavioral"), [activities]);
  const behavioralIds = useMemo(() => new Set(behavioralActivities.map((activity) => activity.id)), [behavioralActivities]);
  const scopes = useMemo<Scope[]>(() => [
    ...sessions.filter((session) => session.activityIds.some((id) => behavioralIds.has(id))).map((session) => ({
      type: "session" as const,
      id: session.id,
      label: session.label,
      detail: "Inherited by behavioral activities unless an activity override is set.",
    })),
    ...behavioralActivities.map((activity) => ({
      type: "activity" as const,
      id: activity.id,
      label: activity.title,
      detail: activity.sessionId ? "Can override its parent session target." : "Standalone behavioral practice.",
    })),
  ], [behavioralActivities, behavioralIds, sessions]);
  const { targets, error, generation, refresh } = useBehavioralTargetProfiles(scopes.length > 0);
  const [bindings, setBindings] = useState<Record<string, BehavioralTargetBindingRead>>({});
  const [bindingError, setBindingError] = useState<string | null>(null);
  const readBindings = useCallback(async () => {
    if (!scopes.length) return true;
    const params = new URLSearchParams();
    for (const scope of scopes) params.append("scope", `${scope.type}:${scope.id}`);
    try {
      const payload = behavioralTargetBindingBatchReadSchema.parse(
        await behavioralTargetRequest(`/api/behavioral-target-bindings?${params}`),
      );
      setBindings(Object.fromEntries(payload.bindings.map((item) => [
        `${item.scope.type}:${item.scope.id}`,
        { directBinding: item.directBinding, resolution: item.resolution },
      ])));
      setBindingError(null);
      return true;
    } catch (reason) {
      setBindingError(reason instanceof Error ? reason.message : "Target bindings are unavailable.");
      return false;
    }
  }, [scopes]);
  useEffect(() => {
    const refreshTimer = window.setTimeout(() => void readBindings(), 0);
    return () => window.clearTimeout(refreshTimer);
  }, [generation, readBindings]);
  const refreshAll = useCallback(async () => {
    const [targetsFresh, bindingsFresh] = await Promise.all([refresh(), readBindings()]);
    return targetsFresh && bindingsFresh;
  }, [readBindings, refresh]);
  if (scopes.length === 0) return null;
  const activeTargets = targets?.filter((target) => target.state === "active") ?? [];
  return <section className="behavioral-target-bindings" aria-labelledby="behavioral-target-bindings-title">
    <header><div><span className="eyebrow">TODAY · ANSWER TARGETS</span><h2 id="behavioral-target-bindings-title">Choose the role each answer serves.</h2><p>Session targets inherit downward. Activity overrides remain exact and never rewrite earlier attempts.</p></div><small>{activeTargets.length} active target{activeTargets.length === 1 ? "" : "s"}</small></header>
    {targets === undefined && !error && <div className="target-loading" role="status">Resolving Today’s owner-private targets…</div>}
    {error && <div className="target-notice error" role="alert"><span>{error}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}
    {bindingError && <div className="target-notice error" role="alert"><span>{bindingError}</span><button type="button" onClick={() => void readBindings()}>Retry</button></div>}
    {targets && activeTargets.length === 0 && <div className="target-empty"><strong>No active target.</strong><span>Create one from Behavioral Problem Bank, or practice the universal answer.</span></div>}
    {targets && <div className="target-binding-list">{scopes.map((scope) => {
      const state = bindings[`${scope.type}:${scope.id}`];
      return <TargetBindingRow scope={scope} targets={activeTargets} state={state} onChanged={refreshAll} key={`${scope.type}:${scope.id}:${state?.directBinding?.revision ?? "loading"}`} />;
    })}</div>}
  </section>;
}
