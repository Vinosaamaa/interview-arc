"use client";
import { useEffect, useRef, useState } from "react";
import { createDeviceLectureSpeech, type DeviceSpeechState } from "../../lib/lecture-device-speech";
import type { readLecture } from "../../db/lectures";

type Lecture = Awaited<ReturnType<typeof readLecture>>;
export function DeviceLecturePlayer({ lecture, onPlay }: { lecture: Lecture; onPlay: () => void }) {
  const controller = useRef<ReturnType<typeof createDeviceLectureSpeech> | null>(null);
  const [state, setState] = useState<DeviceSpeechState>({ phase: "paused", chunkIndex: lecture.cursor.chunkIndex, characterOffset: lecture.cursor.characterOffset, message: "Ready for free playback on this device." });
  useEffect(() => {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    let revision = lecture.cursor.revision;
    let pending: object | null = null;
    controller.current = createDeviceLectureSpeech({
      speech: window.speechSynthesis, makeUtterance: text => new SpeechSynthesisUtterance(text),
      chunkCount: lecture.chunks.length, chunkIndex: lecture.cursor.chunkIndex, characterOffset: lecture.cursor.characterOffset,
      loadChunk: async index => {
        if (lecture.fragment.index === index) return lecture.fragment.text;
        const response = await fetch(`/api/lectures?id=${encodeURIComponent(lecture.lectureId)}&chunk=${index}`, { cache: "no-store" });
        const data = await response.json() as Lecture;
        if (!response.ok || data.fingerprint !== lecture.fingerprint || data.fragment?.index !== index) throw Error("The original lecture section was not confirmed.");
        return data.fragment.text;
      },
      savePosition: async (index, offset) => {
        pending ??= { lectureId: lecture.lectureId, operationId: "device-" + crypto.randomUUID(), expectedRevision: revision, chunkIndex: index, characterOffset: offset, offsetSeconds: 0 };
        const response = await fetch("/api/lectures", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cursor", input: pending }) });
        const saved = await response.json() as { revision?: number; error?: string };
        if (!response.ok || !saved.revision) throw Error(saved.error || "Position save was not confirmed. Reload before resuming.");
        revision = saved.revision; pending = null;
      },
      onChange: setState,
    });
    return () => { void controller.current?.pause().catch(() => {}); controller.current?.dispose(); controller.current = null; };
  }, [lecture]);
  const active = ["playing", "loading"].includes(state.phase);
  return <section aria-label="Free device lecture player" className="lecture-preparation">
    <h3>Listen free on this device</h3>
    <p>The voice installed on your phone or computer reads the original sections automatically. No API credit or connection to a separate computer is needed.</p>
    <button disabled={active || ["error", "finished"].includes(state.phase)} onClick={() => {
      onPlay();
      if (!controller.current) { setState({ ...state, phase: "unavailable", message: "This host does not expose device speech. No paid request was made." }); return; }
      void controller.current.play();
    }}>Play free on this device</button>{" "}
    <button disabled={!active} onClick={() => void controller.current?.pause().catch(() => {})}>Pause</button>{" "}
    <label>Device voice speed <select defaultValue="1" onChange={event => controller.current?.setRate(Number(event.target.value))}>{[0.75, 1, 1.25, 1.5, 2].map(rate => <option key={rate} value={rate}>{rate}×</option>)}</select></label>
    <label>Start at section <select value={state.chunkIndex} onChange={event => void controller.current?.seek(Number(event.target.value)).catch(() => {})}>{lecture.chunks.map(chunk => <option key={chunk.index} value={chunk.index}>{chunk.index + 1}. {chunk.sectionTitle}</option>)}</select></label>
    <p role="status">{state.message || `Playing free · section ${state.chunkIndex + 1} of ${lecture.chunks.length} · character ${state.characterOffset}`}</p>
    <p>Duration is a script estimate. Keep the player open; background and screen-lock behavior depend on the browser. Resume uses the last reported word or sentence.</p>
  </section>;
}
