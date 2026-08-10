"use client";

import { useCallback, useEffect, useState } from "react";

import { subscribeToLiveUpdates } from "./live-event-policy";
import {
  behavioralTargetProfileListSchema,
  type DisplaySafeBehavioralTargetRevision,
} from "./behavioral-target-contract";

export async function behavioralTargetRequest(path: string, init?: RequestInit) {
  const response = await fetch(path, { cache: "no-store", ...init });
  const payload = await response.json() as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Target Profile request failed.");
  return payload;
}

export function useBehavioralTargetProfiles(enabled = true) {
  const [targets, setTargets] = useState<DisplaySafeBehavioralTargetRevision[]>();
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  const refresh = useCallback(async () => {
    if (!enabled) return false;
    try {
      const payload = behavioralTargetProfileListSchema.parse(
        await behavioralTargetRequest("/api/behavioral-targets?includeArchived=true"),
      );
      setTargets(payload.targets);
      setError(null);
      setGeneration((value) => value + 1);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Target Profiles could not load.");
      return false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const frame = window.requestAnimationFrame(() => void refresh());
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const unsubscribe = subscribeToLiveUpdates({
      url: `${protocol}//${window.location.host}/api/live-events`,
      onUpdate: (update) => update.scope === "behavioral_target" ? refresh() : undefined,
      onFallback: refresh,
    });
    return () => {
      window.cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, [enabled, refresh]);

  return { targets, error, generation, refresh };
}
