"use client";
import { useEffect, useRef, useState } from "react";
import { createDeviceLectureSpeech, type DeviceSpeechState } from "../../lib/lecture-device-speech";
import { attachLectureGestures } from "../../lib/lecture-player-gestures";
import { lectureTranscriptSegments } from "../../lib/lecture-transcript";
import type { readLecture } from "../../db/lectures";

type Lecture = Awaited<ReturnType<typeof readLecture>>;
export function DeviceLecturePlayer({ lecture, onPlay }: { lecture: Lecture; onPlay: () => void }) {
  const controller = useRef<ReturnType<typeof createDeviceLectureSpeech> | null>(null);
  const touch = useRef<HTMLButtonElement>(null), transcript = useRef<HTMLDivElement>(null);
  const phase = useRef("paused"), rate = useRef(1), voiceChoice = useRef(""), loadText = useRef<(index: number) => Promise<string>>(async () => "");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]), [voice, setVoice] = useState("");
  const [feedback, setFeedback] = useState(""), [follow, setFollow] = useState(true);
  const [viewIndex, setViewIndex] = useState(lecture.cursor.chunkIndex);
  const [transcriptData, setTranscriptData] = useState({ index: lecture.fragment.index, text: lecture.fragment.text, error: false });
  const [state, setState] = useState<DeviceSpeechState>({ phase: "paused", chunkIndex: lecture.cursor.chunkIndex, characterOffset: lecture.cursor.characterOffset, message: "Ready for free playback on this device." });
  useEffect(() => {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    let revision = lecture.cursor.revision;
    let pending: object | null = null;
    const cache = new Map<number, Promise<string>>();
    loadText.current = index => {
      if (!cache.has(index)) cache.set(index, (async () => {
        if (lecture.fragment.index === index) return lecture.fragment.text;
        const response = await fetch(`/api/lectures?id=${encodeURIComponent(lecture.lectureId)}&chunk=${index}`, { cache: "no-store" });
        const data = await response.json() as Lecture;
        if (!response.ok || data.fingerprint !== lecture.fingerprint || data.fragment?.index !== index) throw Error("The original lecture section was not confirmed.");
        return data.fragment.text;
      })());
      return cache.get(index)!;
    };
    controller.current = createDeviceLectureSpeech({
      speech: window.speechSynthesis, makeUtterance: text => new SpeechSynthesisUtterance(text),
      chunkCount: lecture.chunks.length, chunkIndex: lecture.cursor.chunkIndex, characterOffset: lecture.cursor.characterOffset,
      loadChunk: index => loadText.current(index),
      savePosition: async (index, offset) => {
        pending ??= { lectureId: lecture.lectureId, operationId: "device-" + crypto.randomUUID(), expectedRevision: revision, chunkIndex: index, characterOffset: offset, offsetSeconds: 0 };
        const response = await fetch("/api/lectures", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cursor", input: pending }) });
        const saved = await response.json() as { revision?: number; error?: string };
        if (!response.ok || !saved.revision) throw Error(saved.error || "Position save was not confirmed. Reload before resuming.");
        revision = saved.revision; pending = null;
      },
      onChange: value => { phase.current = value.phase; setState(value); },
    });
    controller.current.setRate(rate.current);
    const updateVoices = () => {
      const available = controller.current?.voices() ?? [];
      setVoices(available);
      const selected = available.find(v => v.voiceURI === voiceChoice.current) ?? available.find(v => /premium|enhanced|natural/i.test(v.name)) ?? available.find(v => v.default) ?? available[0];
      if (selected) { voiceChoice.current = selected.voiceURI; setVoice(selected.voiceURI); controller.current?.setVoice(selected.voiceURI); }
    };
    queueMicrotask(updateVoices); window.speechSynthesis.addEventListener("voiceschanged", updateVoices);
    return () => { window.speechSynthesis.removeEventListener("voiceschanged", updateVoices); void controller.current?.pause().catch(() => {}); controller.current?.dispose(); controller.current = null; };
  }, [lecture]);
  useEffect(() => {
    if (!touch.current) return;
    return attachLectureGestures(touch.current, {
      toggle: () => { if (["playing", "loading"].includes(phase.current)) void controller.current?.pause().catch(() => {}); else { onPlay(); void controller.current?.play(); } },
      skip: seconds => { void controller.current?.skip(seconds); setFeedback(seconds < 0 ? "About −5s" : "About +5s"); },
      boost: value => { controller.current?.setRate(value ? 2 : rate.current); setFeedback(value ? "2× while holding" : ""); },
    });
  }, [onPlay]);
  const shownIndex = follow ? state.chunkIndex : viewIndex;
  const text = transcriptData.index === shownIndex ? transcriptData.text : "";
  useEffect(() => {
    let stale = false;
    void loadText.current(shownIndex).then(value => { if (!stale) setTranscriptData({ index: shownIndex, text: value, error: false }); }).catch(() => { if (!stale) setTranscriptData({ index: shownIndex, text: "Transcript could not load. Reopen the lesson to retry.", error: true }); });
    return () => { stale = true; };
  }, [shownIndex, lecture]);
  useEffect(() => {
    const box = transcript.current, active = box?.querySelector<HTMLElement>('[aria-current="true"]');
    if (follow && box && active && (active.offsetTop < box.scrollTop || active.offsetTop + active.offsetHeight > box.scrollTop + box.clientHeight)) box.scrollTop = Math.max(0, active.offsetTop - box.clientHeight / 3);
  }, [state.characterOffset, follow, text]);
  const active = ["playing", "loading"].includes(state.phase);
  const counts = lecture.chunks.map(chunk => chunk.characterCount), total = counts.reduce((a, b) => a + b, 0);
  const progress = total ? 100 * (counts.slice(0, state.chunkIndex).reduce((a, b) => a + b, 0) + state.characterOffset) / total : 0;
  const browse = (index: number) => { setViewIndex(index); setFollow(false); };
  return <section aria-label="Free device lecture player" className="device-reader">
    <button ref={touch} className="device-touch" aria-label={active ? "Pause lecture" : state.phase === "finished" ? "Replay lecture" : "Play lecture"} disabled={!voices.length || state.phase === "error"}>
      <span aria-hidden="true">−5s</span><span className="device-play-icon"><svg viewBox="0 0 24 24" aria-hidden="true">{active ? <path d="M8 5v14M16 5v14" /> : <path d="M8 4v16l13-8z" />}</svg></span><span aria-hidden="true">+5s</span>
    </button>
    <progress value={progress} max={100} aria-label="Lecture progress" />
    <div className="device-position"><span>{lecture.chunks[state.chunkIndex]?.sectionTitle}</span><span>{Math.round(progress)}%</span></div>
    <div className="device-transport"><button aria-label="Back about five seconds" onClick={() => void controller.current?.skip(-5)}>−5s</button><select aria-label="Playback speed" defaultValue="1" onChange={event => { rate.current = Number(event.target.value); controller.current?.setRate(rate.current); }}>{[0.75, 1, 1.25, 1.5, 2].map(value => <option key={value} value={value}>{value}×</option>)}</select><button aria-label="Forward about five seconds" onClick={() => void controller.current?.skip(5)}>+5s</button></div>
    <small>Tap to play / pause · Double-tap sides to skip · Hold for 2×</small><small>Device-voice skips are approximate.</small>
    <p role="status">{["error", "unavailable"].includes(state.phase) ? state.message : !voices.length ? "No installed English voice is available in this browser." : state.phase === "finished" ? "Finished. Tap to listen again." : feedback}</p>
    <div className="device-transcript-heading"><strong>Transcript</strong><button aria-pressed={follow} onClick={() => setFollow(!follow)}>{follow ? "Following" : "Follow playback"}</button></div>
    <small>Tap a passage to play from there.</small>
    <div className="device-transcript" ref={transcript} tabIndex={0} aria-label="Lecture transcript" onWheel={() => browse(shownIndex)} onTouchMove={() => browse(shownIndex)} onKeyDown={event => { if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) browse(shownIndex); }}>
      {!text ? <p>Loading transcript…</p> : transcriptData.error ? <p>{text}</p> : lectureTranscriptSegments(text).map(part => <button key={`${shownIndex}-${part.start}`} aria-current={shownIndex === state.chunkIndex && part.start <= state.characterOffset && part.end > state.characterOffset} onClick={() => { setFollow(true); onPlay(); void controller.current?.seek(shownIndex, part.start, true); }}>{part.text}</button>)}
    </div>
    <div className="device-transcript-heading"><button disabled={shownIndex === 0} onClick={() => browse(shownIndex - 1)}>Previous</button><small>{shownIndex + 1} / {lecture.chunks.length}</small><button disabled={shownIndex === lecture.chunks.length - 1} onClick={() => browse(shownIndex + 1)}>Next</button></div>
    <details><summary>Voice &amp; chapters</summary><label>Voice on this device<select value={voice || undefined} onChange={event => { voiceChoice.current = event.target.value; setVoice(event.target.value); controller.current?.setVoice(event.target.value); }}>{voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name} · {v.lang}</option>)}</select></label><label>Start at section<select value={state.chunkIndex} onChange={event => void controller.current?.seek(Number(event.target.value))}>{lecture.chunks.map(chunk => <option key={chunk.index} value={chunk.index}>{chunk.sectionTitle}</option>)}</select></label><small>Only installed voices exposed by this browser appear here. Keep the player open; background playback depends on your device.</small></details>
  </section>;
}
