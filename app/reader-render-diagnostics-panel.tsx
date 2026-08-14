"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  captureReaderFlash,
  getReaderDiagnosticBuffer,
  markReaderFlash,
  persistReaderDiagnosticBuffer,
  readerDiagnosticEnabled,
  recordReaderDiagnostic,
  recordReaderVisualHeartbeat,
  resetReaderTrace,
  type ReaderDiagnosticSnapshot,
} from "./reader-render-diagnostics";

type DiagnosticPerformanceEntry = PerformanceEntry & {
  duration: number;
  hadRecentInput?: boolean;
  value?: number;
};

function readerNode() {
  return document.querySelector<HTMLElement>(".reader-workspace");
}

function visualSnapshot(node: HTMLElement | null) {
  if (!node) return { mounted: false };
  const style = window.getComputedStyle(node);
  const rect = node.getBoundingClientRect();
  return {
    mounted: true,
    opacity: Number(style.opacity),
    visibility: style.visibility,
    display: style.display,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    left: rect.left,
    petals: document.querySelectorAll(".ambient-petal").length,
  };
}

function animationSnapshot() {
  try {
    const animations = document.getAnimations();
    let runningAnimations = 0;
    let petalAnimations = 0;
    let runningPetalAnimations = 0;
    for (const animation of animations) {
      const running = animation.playState === "running";
      if (running) runningAnimations += 1;
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
      if (!(target instanceof Element) || !target.classList.contains("ambient-petal")) continue;
      petalAnimations += 1;
      if (running) runningPetalAnimations += 1;
    }
    return {
      animations: animations.length,
      runningAnimations,
      petalAnimations,
      runningPetalAnimations,
    };
  } catch {
    return {
      animations: -1,
      runningAnimations: -1,
      petalAnimations: -1,
      runningPetalAnimations: -1,
    };
  }
}

function diagnosticSnapshot() {
  return {
    ...visualSnapshot(readerNode()),
    ...animationSnapshot(),
  };
}

function useReaderFrameDiagnostics(enabled: boolean, surface: string | null) {
  const priorNodeRef = useRef<HTMLElement | null>(null);
  const priorVisualRef = useRef("");
  useEffect(() => {
    if (!enabled) return;
    const activeSurface = surface ?? "none";
    const openedAt = performance.now();
    recordReaderDiagnostic(surface ? "reader-open" : "reader-closed", activeSurface, diagnosticSnapshot());

    let lastFrame = performance.now();
    let lastVisualSample = 0;
    let frame = 0;
    const sample = (now: number) => {
      const frameGap = now - lastFrame;
      if (frameGap > 250) recordReaderDiagnostic("frame-gap", activeSurface, { duration: frameGap });
      lastFrame = now;

      // Computed style and geometry are sampled at 1 Hz. Animation lifecycle
      // events and the rAF frame-gap detector provide the higher-frequency
      // signal without repeatedly traversing the document animation tree.
      if (now - lastVisualSample >= 1_000) {
        lastVisualSample = now;
        const node = readerNode();
        const visual = {
          ...visualSnapshot(node),
          ...animationSnapshot(),
        };
        const serialized = JSON.stringify(visual);
        const establishedReader = Boolean(surface) && now - openedAt > 1_000;
        recordReaderVisualHeartbeat(activeSurface, visual);
        if (node !== priorNodeRef.current) {
          recordReaderDiagnostic(node ? "reader-node-mounted" : "reader-node-unmounted", activeSurface, visual);
          if (establishedReader && priorNodeRef.current && node) markReaderFlash(activeSurface, true);
          priorNodeRef.current = node;
        }
        if (serialized !== priorVisualRef.current) {
          recordReaderDiagnostic("visual-state", activeSurface, visual);
          if (establishedReader && visual.mounted && visual.opacity < 0.98) markReaderFlash(activeSurface, true);
          priorVisualRef.current = serialized;
        }
      }
      frame = window.requestAnimationFrame(sample);
    };
    frame = window.requestAnimationFrame(sample);
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [enabled, surface]);
}

function useDiagnosticPersistence(
  enabled: boolean,
  setSnapshot: Dispatch<SetStateAction<ReaderDiagnosticSnapshot | null>>,
) {
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      persistReaderDiagnosticBuffer();
      setSnapshot(getReaderDiagnosticBuffer().snapshot());
    }, 1_000);
    return () => {
      window.clearInterval(timer);
      persistReaderDiagnosticBuffer();
    };
  }, [enabled, setSnapshot]);
}

function useDiagnosticLifecycleEvents(enabled: boolean, surface: string | null) {
  useEffect(() => {
    if (!enabled) return;
    const activeSurface = surface ?? "none";
    const animationListener = (event: AnimationEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const owner = target?.closest(".reader-workspace, .petal-field");
      if (!owner) return;
      recordReaderDiagnostic(`animation-${event.type.replace("animation", "")}`, activeSurface, {
        name: event.animationName,
        owner: owner.classList.contains("petal-field") ? "petals" : "reader",
      });
    };
    const animationTypes = ["animationstart", "animationend", "animationcancel"] as const;
    animationTypes.forEach((type) => document.addEventListener(type, animationListener as EventListener, true));
    const visibilityListener = () => recordReaderDiagnostic("visibility", activeSurface, { state: document.visibilityState });
    const pageShowListener = (event: PageTransitionEvent) => recordReaderDiagnostic("pageshow", activeSurface, { persisted: event.persisted });
    const pageHideListener = (event: PageTransitionEvent) => {
      recordReaderDiagnostic("pagehide", activeSurface, { persisted: event.persisted });
      persistReaderDiagnosticBuffer();
    };
    document.addEventListener("visibilitychange", visibilityListener);
    window.addEventListener("pageshow", pageShowListener);
    window.addEventListener("pagehide", pageHideListener);
    return () => {
      animationTypes.forEach((type) => document.removeEventListener(type, animationListener as EventListener, true));
      document.removeEventListener("visibilitychange", visibilityListener);
      window.removeEventListener("pageshow", pageShowListener);
      window.removeEventListener("pagehide", pageHideListener);
    };
  }, [enabled, surface]);
}

function useDiagnosticPerformanceObservers(enabled: boolean, surface: string | null) {
  useEffect(() => {
    if (!enabled) return;
    const activeSurface = surface ?? "none";
    const observers: PerformanceObserver[] = [];
    for (const entryType of ["longtask", "layout-shift"]) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const rawEntry of list.getEntries()) {
            const entry = rawEntry as DiagnosticPerformanceEntry;
            if (entryType === "layout-shift" && entry.hadRecentInput) continue;
            recordReaderDiagnostic(entryType, activeSurface, {
              duration: entry.duration,
              value: entry.value ?? null,
            });
          }
        });
        observer.observe({ type: entryType, buffered: true });
        observers.push(observer);
      } catch {
        recordReaderDiagnostic("observer-unavailable", activeSurface, { type: entryType });
      }
    }
    return () => observers.forEach((observer) => observer.disconnect());
  }, [enabled, surface]);
}

export default function ReaderRenderDiagnosticsPanel({ surface }: { surface: string | null }) {
  const [enabled, setEnabled] = useState(false);
  const [snapshot, setSnapshot] = useState<ReaderDiagnosticSnapshot | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setEnabled(readerDiagnosticEnabled(window.location.search)));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useReaderFrameDiagnostics(enabled, surface);
  useDiagnosticPersistence(enabled, setSnapshot);
  useDiagnosticLifecycleEvents(enabled, surface);
  useDiagnosticPerformanceObservers(enabled, surface);

  if (!enabled) return null;
  const currentSnapshot = snapshot ?? getReaderDiagnosticBuffer().snapshot();
  const latest = currentSnapshot.events.at(-1);
  const download = () => {
    persistReaderDiagnosticBuffer();
    const payload = JSON.stringify(getReaderDiagnosticBuffer().snapshot(), null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "interview-arc-reader-trace.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const mark = () => {
    captureReaderFlash(surface ?? "none", diagnosticSnapshot());
    setSnapshot(getReaderDiagnosticBuffer().snapshot());
  };
  const reset = () => {
    resetReaderTrace(surface ?? "none", diagnosticSnapshot());
    setSnapshot(getReaderDiagnosticBuffer().snapshot());
  };

  return (
    <aside className="reader-diagnostics-panel" aria-label="Reader diagnostics">
      <strong>Reader trace</strong>
      <span>{surface ?? "closed"} · {currentSnapshot.events.length} events</span>
      <small>{currentSnapshot.frozen ? "Trace frozen" : latest?.kind ?? "waiting"}</small>
      <div>
        <button type="button" onClick={mark} disabled={currentSnapshot.frozen}>Mark flash</button>
        <button type="button" onClick={download}>Download JSON</button>
      </div>
      <button type="button" className="reader-diagnostics-reset" onClick={reset}>Reset trace</button>
    </aside>
  );
}
