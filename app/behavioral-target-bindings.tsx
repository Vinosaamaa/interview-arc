"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { ExtraActivity, LocalSession } from "./live-types";
import {
  behavioralTargetBindingBatchReadSchema,
  type BehavioralTargetBindingRead,
} from "./behavioral-target-contract";
import { behavioralTargetRequest } from "./behavioral-target-client";

type Scope = { type: "session" | "activity"; id: string; label: string; detail: string };
const BINDING_READ_LIMIT = 50;

function LegacyBindingRow({ scope, state }: { scope: Scope; state?: BehavioralTargetBindingRead }) {
  const sourceLabel = !state
    ? "Resolving"
    : state.resolution.source === "activity"
      ? "Historical activity binding"
      : state.resolution.source === "session" && scope.type === "activity"
        ? "Historical session inheritance"
        : state.resolution.source === "session"
          ? "Historical session binding"
          : "No legacy binding";
  return <article className={`target-binding-row ${state?.resolution.source ?? "loading"}`}>
    <div><span>{scope.type === "session" ? "Session" : "Behavioral activity"}</span><strong>{scope.label}</strong><small>{scope.detail}</small></div>
    <div className="target-binding-status"><span>{sourceLabel}</span><strong>{!state ? "Reading binding…" : state.resolution.target?.label ?? "Loop context or universal practice"}</strong>{state?.resolution.target && <small>Read-only Target Profile revision {state.resolution.target.revision}</small>}</div>
    <p>{state?.resolution.target ? "This exact legacy context remains readable for history. New context must bind the planned activity to a Loop and optional Round." : "No standalone Target Profile can be attached. Use the Loop Recorder for role-specific context."}</p>
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
      detail: "Legacy session bindings remain readable but cannot be created or revised.",
    })),
    ...behavioralActivities.map((activity) => ({
      type: "activity" as const,
      id: activity.id,
      label: activity.title,
      detail: "Forward role context comes from the activity’s Loop and optional Round binding.",
    })),
  ], [behavioralActivities, behavioralIds, sessions]);
  const [bindings, setBindings] = useState<Record<string, BehavioralTargetBindingRead>>({});
  const [bindingError, setBindingError] = useState<string | null>(null);
  const readBindings = useCallback(async () => {
    if (!scopes.length) return;
    try {
      const batches = Array.from(
        { length: Math.ceil(scopes.length / BINDING_READ_LIMIT) },
        (_, index) => scopes.slice(index * BINDING_READ_LIMIT, (index + 1) * BINDING_READ_LIMIT),
      );
      const payloads = await Promise.all(batches.map(async (batch) => {
        const params = new URLSearchParams();
        for (const scope of batch) params.append("scope", `${scope.type}:${scope.id}`);
        return behavioralTargetBindingBatchReadSchema.parse(
          await behavioralTargetRequest(`/api/behavioral-target-bindings?${params}`),
        );
      }));
      setBindings(Object.fromEntries(payloads.flatMap((payload) => payload.bindings).map((item) => [
        `${item.scope.type}:${item.scope.id}`,
        { directBinding: item.directBinding, resolution: item.resolution },
      ])));
      setBindingError(null);
    } catch (reason) {
      setBindingError(reason instanceof Error ? reason.message : "Historical Target Profile bindings are unavailable.");
    }
  }, [scopes]);
  useEffect(() => {
    const refreshTimer = window.setTimeout(() => void readBindings(), 0);
    return () => window.clearTimeout(refreshTimer);
  }, [readBindings]);
  if (scopes.length === 0) return null;
  return <section className="behavioral-target-bindings" aria-labelledby="behavioral-target-bindings-title">
    <header><div><span className="eyebrow">TODAY · LOOP CONTEXT</span><h2 id="behavioral-target-bindings-title">Role context belongs to the hiring Loop.</h2><p>Historical Target Profile bindings remain visible below. New planned activities use one optional Loop and Round with an exact immutable Role Brief revision.</p></div><small>Migration-only legacy</small></header>
    {bindingError && <div className="target-notice error" role="alert"><span>{bindingError}</span><button type="button" onClick={() => void readBindings()}>Retry</button></div>}
    <div className="target-binding-list">{scopes.map((scope) => <LegacyBindingRow scope={scope} state={bindings[`${scope.type}:${scope.id}`]} key={`${scope.type}:${scope.id}`} />)}</div>
  </section>;
}
