"use client";

import { useEffect, useMemo, useState } from "react";

import {
  defaultComposerLoopRoundId,
  type ComposerLoopOption,
} from "./activity-composer-loop-binding";
import { isAbortError, parseLoopPayloadResponse } from "./loop-payload";

type LoopPayload = {
  loops: Array<{
    loop: {
      loopId: string;
      company: string;
      roleTitle: string;
      stages: ComposerLoopOption["stages"];
    };
  }>;
};

function toLoopOptions(payload: LoopPayload | null): ComposerLoopOption[] {
  return (payload?.loops ?? []).map((item) => ({
    loopId: item.loop.loopId,
    company: item.loop.company,
    roleTitle: item.loop.roleTitle,
    stages: item.loop.stages,
  }));
}

async function fetchComposerLoops(signal: AbortSignal) {
  const response = await fetch("/api/loops?includeArchived=false", { cache: "no-store", signal });
  const bodyText = await response.text();
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  return parseLoopPayloadResponse<LoopPayload & { error?: string }>(
    response.status,
    response.headers.get("content-type") ?? "",
    bodyText,
  );
}

export function ActivityComposerLoopBinding({
  enabled,
  loopId,
  stageId,
  onEnabledChange,
  onLoopChange,
}: {
  enabled: boolean;
  loopId: string;
  stageId: string;
  onEnabledChange: (enabled: boolean) => void;
  onLoopChange: (loopId: string, stageId: string) => void;
}) {
  const [payload, setPayload] = useState<LoopPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const loops = useMemo(() => toLoopOptions(payload), [payload]);
  const selected = loops.find((loop) => loop.loopId === loopId) ?? loops[0];

  useEffect(() => {
    const controller = new AbortController();
    void fetchComposerLoops(controller.signal).then(
      (next) => {
        setPayload(next);
        setError("");
        setLoading(false);
      },
      (cause: unknown) => {
        if (isAbortError(cause)) return;
        setError(cause instanceof Error ? cause.message : "Hiring Loops could not be loaded.");
        setLoading(false);
      },
    );
    return () => controller.abort();
  }, []);

  function applyLoop(next: ComposerLoopOption, preferredStageId = "") {
    onLoopChange(next.loopId, defaultComposerLoopRoundId(next.stages, preferredStageId));
  }

  function toggleEnabled() {
    if (enabled) {
      onEnabledChange(false);
      return;
    }
    onEnabledChange(true);
    if (selected) applyLoop(selected, stageId);
  }

  function selectLoop(nextLoopId: string) {
    const next = loops.find((loop) => loop.loopId === nextLoopId);
    if (!next) return;
    applyLoop(next, next.loopId === loopId ? stageId : "");
  }

  return (
    <div className={`composer-hiring-loop ${enabled ? "bound" : "universal"}`}>
      <div className="composer-hiring-loop-latch" role="group" aria-label="Hiring Loop">
        <span>Hiring Loop</span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          className={enabled ? "active" : ""}
          disabled={loading && !enabled}
          onClick={toggleEnabled}
        >
          {enabled ? "On" : "Off"}
        </button>
        <small>{enabled ? "Stamp selected practice with one Loop." : "Universal practice — no hiring Loop."}</small>
      </div>
      {enabled && (
        <div className="composer-hiring-loop-well">
          {loading && <p>Reading owner-private Loops…</p>}
          {error && !loading && <p role="alert">{error}</p>}
          {!loading && !error && !loops.length && (
            <p>No hiring Loop is recorded. Keep this add universal, or ask Loop Recorder to add a company-and-role Loop.</p>
          )}
          {selected && (
            <>
              <div className="composer-hiring-loop-picks">
                <label>
                  <span>Loop</span>
                  <select
                    value={selected.loopId}
                    onChange={(event) => selectLoop(event.target.value)}
                    aria-label="Hiring Loop"
                  >
                    {loops.map((loop) => (
                      <option value={loop.loopId} key={loop.loopId}>
                        {loop.company} · {loop.roleTitle}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Round</span>
                  <select
                    value={stageId}
                    onChange={(event) => onLoopChange(selected.loopId, event.target.value)}
                    aria-label="Hiring Loop round"
                  >
                    <option value="">No round</option>
                    {selected.stages.map((stage) => (
                      <option value={stage.stageId} key={stage.stageId}>
                        {stage.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p>Checked practice takes this Loop. Uncheck a row to leave it universal. Career Focus never binds.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ActivityComposerLoopBindStamp({
  title,
  bound,
  disabled,
  onToggle,
}: {
  title: string;
  bound: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  if (disabled) return null;
  return (
    <label className={`composer-loop-stamp ${bound ? "bound" : ""}`}>
      <input
        type="checkbox"
        checked={bound}
        onChange={onToggle}
        aria-label={bound ? `Keep ${title} bound to this Loop` : `Leave ${title} as universal practice`}
      />
      <span aria-hidden="true" />
    </label>
  );
}
