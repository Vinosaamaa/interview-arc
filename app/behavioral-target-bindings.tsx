"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ExtraActivity, LocalSession } from "./live-types";
import {
  behavioralTargetBindingBatchReadSchema,
  type BehavioralTargetBindingRead,
} from "./behavioral-target-contract";
import { behavioralTargetRequest } from "./behavioral-target-client";
import { behavioralTargetErrorMessage } from "./behavioral-target-response";

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
      detail: "Saved session context",
    })),
    ...behavioralActivities.map((activity) => ({
      type: "activity" as const,
      id: activity.id,
      label: activity.title,
      detail: "Saved activity context",
    })),
  ], [behavioralActivities, behavioralIds, sessions]);
  const [bindings, setBindings] = useState<Record<string, BehavioralTargetBindingRead>>({});
  const [bindingError, setBindingError] = useState<string | null>(null);
  const latestBindingRequest = useRef(0);
  const readBindings = useCallback(async () => {
    const request = ++latestBindingRequest.current;
    if (!scopes.length) {
      setBindings({});
      setBindingError(null);
      return;
    }
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
      if (request !== latestBindingRequest.current) return;
      setBindings(Object.fromEntries(payloads.flatMap((payload) => payload.bindings).map((item) => [
        `${item.scope.type}:${item.scope.id}`,
        { directBinding: item.directBinding, resolution: item.resolution },
      ])));
      setBindingError(null);
    } catch (reason) {
      if (request !== latestBindingRequest.current) return;
      setBindingError(behavioralTargetErrorMessage(reason));
    }
  }, [scopes]);
  useEffect(() => {
    const refreshTimer = window.setTimeout(() => void readBindings(), 0);
    return () => {
      window.clearTimeout(refreshTimer);
      latestBindingRequest.current += 1;
    };
  }, [readBindings]);
  const hasHistoricalTarget = scopes.some((scope) => Boolean(bindings[`${scope.type}:${scope.id}`]?.resolution.target));
  if (scopes.length === 0 || (!bindingError && !hasHistoricalTarget)) return null;
  return <div className="today-saved-role-context">
    {bindingError && <div className="target-notice error" role="alert"><span>{bindingError}</span><button type="button" onClick={() => void readBindings()}>Retry role context</button></div>}
    {hasHistoricalTarget && <details className="behavioral-target-bindings">
      <summary>Saved role context</summary>
      <div className="target-binding-list">{scopes.filter((scope) => bindings[`${scope.type}:${scope.id}`]?.resolution.target).map((scope) => <LegacyBindingRow scope={scope} state={bindings[`${scope.type}:${scope.id}`]} key={`${scope.type}:${scope.id}`} />)}</div>
    </details>}
  </div>;
}
