"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { readLecture } from "../../db/lectures";
import type { LectureCursorInput } from "../../db/lecture-policy";
import "./player.css";

type Lecture = Awaited<ReturnType<typeof readLecture>> & { speechConfigured: boolean };
type Summary = { lectureId: string; title: string; estimatedMinutes: number };
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
async function json<T>(response: Response): Promise<T> {
  const value = await response.json() as { error?: string };
  if (!response.ok) throw Object.assign(new Error(value.error ?? "Request failed."), { status: response.status });
  return value as T;
}
const send = <T,>(action: string, input: unknown, keepalive = false) => fetch("/api/lectures", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, input }), keepalive,
}).then(json<T>);
const preparationPrompt = "Prepare a complete one-hour Professor lecture on the topic I select. Teach from first principles with detailed examples, calculations, tradeoffs and failure cases. Research real sources first. Write roughly 7,200 spoken words in ordered sections, then save the complete script using Interview Arc's save_practice_lecture tool. Return its continuous-player link and retain its lecture ID for Live continuation. Do not replace the lecture with an outline or claim uninterrupted ChatGPT Voice is guaranteed.";

export default function LectureLibrary({ initialId }: { initialId: string | null }) {
  const [lectures, setLectures] = useState<Summary[]>([]), [selected, setSelected] = useState(initialId);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [saving, setSaving] = useState(false);
  const draft = useRef<{ content: string; id: string } | null>(null);
  const [title, setTitle] = useState(""), [source, setSource] = useState(""), [script, setScript] = useState("");
  const refresh = useCallback(async () => {
    const value = await fetch("/api/lectures", { cache: "no-store" }).then(json<{ lectures: Summary[] }>);
    setLectures(value.lectures);
  }, []);
  useEffect(() => { let active = true; void fetch("/api/lectures", { cache: "no-store" }).then(json<{ lectures: Summary[] }>).then(value => { if (active) setLectures(value.lectures); }).catch(error => { if (active) setError(error.message); }); return () => { active = false; }; }, []);
  async function addScript(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const sections: { id: string; title: string; text: string }[] = [];
      let heading = "Introduction", body: string[] = [];
      const append = () => { if (body.join("\n").trim()) sections.push({ id: `section-${sections.length + 1}`, title: heading, text: body.join("\n").trim() }); body = []; };
      for (const line of script.split(/\r?\n/)) { if (/^#{1,3}\s/.test(line)) { append(); heading = line.replace(/^#{1,3}\s+/, ""); } else body.push(line); } append();
      const content = JSON.stringify({ title, source, sections });
      if (draft.current?.content !== content) draft.current = { content, id: crypto.randomUUID() };
      const lectureId = draft.current.id;
      await send("save", { lectureId, title, sources: source.split(/\r?\n/).filter(Boolean).map(url => ({ label: "Lecture reference", url: url.trim() })), sections });
      await refresh(); draft.current = null; setSelected(lectureId); setScript(""); setMessage("Script saved privately. Prepare its audio when you are ready.");
    } catch (error) { setError((error as Error).message); } finally { setSaving(false); }
  }
  return <main className="lecture-page">
    <header className="lecture-bar"><Link href="/">Interview Arc</Link><span>Professor lectures</span><span>Private library</span></header>
    <div className="lecture-layout">
      <aside className="lecture-library"><p className="lecture-eyebrow">A lesson to listen to</p><h1>Take your time.<br />Keep listening.</h1>
        <p>Prepare the full lesson in ChatGPT, then listen here without asking it to continue.</p>
        <button className="lecture-secondary" onClick={() => void navigator.clipboard.writeText(preparationPrompt).then(() => setMessage("Preparation prompt copied. Use it in your connected ChatGPT conversation."), () => setError("Clipboard is unavailable. Use the preparation instructions below."))}>Copy ChatGPT preparation prompt</button>
        <details><summary>Preparation instructions</summary><p>{preparationPrompt}</p></details>
        <nav aria-label="Saved lectures">{lectures.length === 0 ? <p>No saved lectures yet.</p> : lectures.map(lecture => <button key={lecture.lectureId} aria-current={selected === lecture.lectureId ? "true" : undefined} onClick={() => { setSelected(lecture.lectureId); window.history.replaceState(null, "", `?id=${encodeURIComponent(lecture.lectureId)}`); }}><span>{lecture.title}</span><small>Script estimate · {lecture.estimatedMinutes} min</small></button>)}</nav>
        <details><summary>Add a prepared script</summary><form onSubmit={addScript}>
          <label>Lecture title<input required maxLength={240} value={title} onChange={event => setTitle(event.target.value)} /></label>
          <label>Reference URLs, one per line<textarea required value={source} onChange={event => setSource(event.target.value)} /></label>
          <label>Complete lecture, with Markdown section headings<textarea required rows={12} maxLength={120000} value={script} onChange={event => setScript(event.target.value)} /></label>
          <button disabled={saving}>{saving ? "Saving…" : "Save private script"}</button>
        </form></details>
      </aside>
      <section className="lecture-main" aria-label="Lecture player">
        {error ? <p role="alert" className="lecture-error">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
        {selected ? <ProfessorPlayer key={selected} id={selected} /> : <div className="lecture-empty"><p className="lecture-eyebrow">One hour, at your pace</p><h2>The whole lesson,<br />ready before you press play.</h2><p>Your script, audio and listening position stay together. Pause for a question, then return to the same place.</p><p>Audio is AI-generated. Playback does not start an interview timer or complete a practice activity.</p></div>}
      </section>
    </div>
  </main>;
}

function ProfessorPlayer({ id }: { id: string }) {
  const [lecture, setLecture] = useState<Lecture | null>(null), [error, setError] = useState("");
  const [generating, setGenerating] = useState(false), [playing, setPlaying] = useState(false), [position, setPosition] = useState(0), [rate, setRate] = useState(1);
  const [conflicted, setConflicted] = useState(false);
  const revision = useRef(0), lastPosition = useRef(0), queued = useRef<number | null>(null);
  const [saveStatus, setSaveStatus] = useState("Position loaded"), [excerpt, setExcerpt] = useState("");
  const audio = useRef<HTMLAudioElement>(null), current = useRef<Lecture | null>(null), pending = useRef<LectureCursorInput | null>(null);
  const saving = useRef(false), mounted = useRef(true), lastSave = useRef(0), blocked = useRef(false), restored = useRef(false);
  const refresh = useCallback(async () => {
    const value = await fetch(`/api/lectures?id=${encodeURIComponent(id)}`, { cache: "no-store" }).then(json<Lecture>);
    if (mounted.current) { current.current = value; revision.current = value.cursor.revision; setLecture(value); setExcerpt(value.fragment.text); }
    return value;
  }, [id]);
  const persist = useCallback(async () => {
    const value = current.current;
    if (!value || !restored.current || blocked.current) return;
    queued.current = audio.current?.currentTime ?? lastPosition.current;
    if (saving.current) return;
    saving.current = true;
    try {
      do {
        if (!pending.current) {
          let remaining = queued.current ?? lastPosition.current, index = 0;
          queued.current = null;
          while (index < value.chunks.length - 1 && remaining >= (value.chunks[index].audio?.duration_seconds ?? Infinity)) {
            remaining -= value.chunks[index].audio!.duration_seconds!; index++;
          }
          pending.current = { lectureId: id, operationId: crypto.randomUUID(), expectedRevision: revision.current,
            chunkIndex: index, offsetSeconds: Math.max(0, Math.min(remaining, value.chunks[index].audio?.duration_seconds ?? 1800)), characterOffset: 0 };
        }
        if (mounted.current) setSaveStatus("Saving position�");
        const receipt = await send<{ revision: number }>("cursor", pending.current, true);
        revision.current = receipt.revision; pending.current = null; lastSave.current = Date.now();
      } while (queued.current != null);
      if (mounted.current) setSaveStatus("Position saved");
    } catch (error) {
      if ((error as { status?: number }).status === 409) { blocked.current = true; audio.current?.pause(); if (mounted.current) setConflicted(true); }
      if (mounted.current) { setSaveStatus("Position not saved"); setError((error as Error).message); }
    } finally { saving.current = false; }
  }, [id]);
  useEffect(() => {
    mounted.current = true; void refresh().catch(error => setError(error.message));
    const leave = () => { void persist(); };
    window.addEventListener("pagehide", leave);
    return () => { void persist(); mounted.current = false; window.removeEventListener("pagehide", leave); };
  }, [refresh, persist]);
  const complete = Boolean(lecture?.chunks.every(chunk => chunk.audio?.state === "ready"));
  const duration = lecture?.chunks.reduce((sum, chunk) => sum + (chunk.audio?.duration_seconds ?? 0), 0) ?? 0;
  function seek(seconds: number) { if (audio.current) { audio.current.currentTime = Math.max(0, Math.min(duration, seconds)); setPosition(audio.current.currentTime); lastPosition.current = audio.current.currentTime; void persist(); } }
  useEffect(() => {
    if (!lecture || !complete || !("mediaSession" in navigator)) return;
    const mediaHandler = (name: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try { navigator.mediaSession.setActionHandler(name, handler); } catch { /* Older browsers support only a subset of actions. */ }
    };
    navigator.mediaSession.metadata = new MediaMetadata({ title: lecture.title, artist: "Interview Arc · AI-generated lecture" });
    mediaHandler("play", () => { void audio.current?.play().catch(error => setError(error.message)); });
    mediaHandler("pause", () => audio.current?.pause());
    mediaHandler("seekto", event => { if (audio.current && event.seekTime != null) audio.current.currentTime = event.seekTime; });
    mediaHandler("seekbackward", () => { if (audio.current) audio.current.currentTime = Math.max(0, audio.current.currentTime - 15); });
    mediaHandler("seekforward", () => { if (audio.current) audio.current.currentTime = Math.min(duration, audio.current.currentTime + 15); });
    return () => { for (const name of ["play", "pause", "seekto", "seekbackward", "seekforward"] as const) mediaHandler(name, null); navigator.mediaSession.metadata = null; };
  }, [lecture, complete, duration]);
  async function generate() {
    if (!lecture) return; setGenerating(true); setError("");
    try {
      for (const chunk of lecture.chunks) {
        if (!mounted.current) break;
        if (chunk.audio?.state === "ready") continue;
        await fetch(`/api/lectures/${encodeURIComponent(id)}/audio/${chunk.index}`, { method: "POST" }).then(json);
        await refresh();
      }
    } catch (error) { if (mounted.current) setError((error as Error).message); }
    finally { if (mounted.current) setGenerating(false); }
  }
  if (!lecture) return <p role="status">{error || "Loading your lecture…"}</p>;
  const ready = lecture.chunks.filter(chunk => chunk.audio?.state === "ready").length;
  return <article className="professor-player">
    <p className="lecture-eyebrow">Professor mode · AI-generated voice</p><h2>{lecture.title}</h2>
    <div className="lecture-facts"><span><strong>{complete ? clock(duration) : `${lecture.estimatedMinutes} min`}</strong>{complete ? "Measured audio" : "Script estimate"}</span><span><strong>60 min</strong>Requested lesson</span><span><strong>{ready}/{lecture.chunks.length}</strong>Audio parts ready</span></div>
    {error ? <p role="alert" className="lecture-error">{error} <button className="lecture-secondary" onClick={() => window.location.reload()}>Reload saved position</button></p> : null}
    {!complete ? <div className="lecture-preparation"><p>The complete script is saved. Generate every audio part before listening continuously.</p><p>Generation sends this script to OpenAI Speech and uses the configured API account. Completed parts are reused on retry.</p><button disabled={generating || !lecture.speechConfigured} onClick={() => void generate()}>{generating ? `Preparing audio · ${ready}/${lecture.chunks.length}` : ready ? "Prepare remaining audio" : "Generate lecture audio"}</button>{!lecture.speechConfigured ? <p>Audio generation needs administrator configuration. Your script is available in ChatGPT now.</p> : null}</div> : null}
    {complete && duration < 3600 ? <p className="lecture-note">This recording is {clock(duration)}, shorter than the requested hour. Ask ChatGPT to expand the lecture and save a new version.</p> : null}
    {complete ? <>
      <audio ref={audio} src={`/api/lectures/${encodeURIComponent(id)}/audio`} preload="metadata"
        onLoadedMetadata={() => { if (!restored.current && audio.current) { const seconds = lecture.chunks.slice(0, lecture.cursor.chunkIndex).reduce((sum, chunk) => sum + (chunk.audio?.duration_seconds ?? 0), 0) + lecture.cursor.offsetSeconds; audio.current.currentTime = seconds; audio.current.playbackRate = rate; setPosition(seconds); lastPosition.current = seconds; restored.current = true; } }}
        onPlay={() => setPlaying(true)} onPause={() => { setPlaying(false); void persist(); }} onEnded={() => { setPlaying(false); void persist(); }}
        onTimeUpdate={() => { if (audio.current) { lastPosition.current = audio.current.currentTime; setPosition(audio.current.currentTime); } if (Date.now() - lastSave.current > 10000) void persist(); }}
        onError={() => { setError("Audio could not be loaded. Check the connection and reload your saved position."); }} />
      <div className="lecture-transport"><button aria-label="Back 15 seconds" onClick={() => seek(position - 15)}>−15 s</button><button className="lecture-play" disabled={conflicted} onClick={() => { if (playing) audio.current?.pause(); else void audio.current?.play().catch(error => setError(error.message)); }}>{playing ? "Pause lecture" : position ? "Resume lecture" : "Play lecture"}</button><button aria-label="Forward 15 seconds" onClick={() => seek(position + 15)}>+15 s</button></div>
      <label className="lecture-progress">Lecture position<input type="range" min={0} max={duration} step={0.1} value={Math.min(position, duration)} onChange={event => seek(Number(event.target.value))} /></label>
      <div className="lecture-time"><span>{clock(position)} / {clock(duration)}</span><label>Speed <select value={rate} onChange={event => { const rate = Number(event.target.value); setRate(rate); if (audio.current) audio.current.playbackRate = rate; }}>{[0.75, 1, 1.25, 1.5].map(rate => <option key={rate} value={rate}>{rate}×</option>)}</select></label><span role="status">{saveStatus}</span></div>
      <p className="lecture-note">Pause here before asking a question in ChatGPT. Use this lecture’s saved position there, then return here to resume. ChatGPT voice starts manually.</p>
    </> : null}
    <h3>Follow the lesson</h3><ol className="lecture-chapters">{lecture.chunks.map(chunk => {
      const start = lecture.chunks.slice(0, chunk.index).reduce((sum, part) => sum + (part.audio?.duration_seconds ?? 0), 0);
      return <li key={chunk.index}><button onClick={() => { if (complete) seek(start); void fetch(`/api/lectures?id=${encodeURIComponent(id)}&chunk=${chunk.index}`, { cache: "no-store" }).then(json<Lecture>).then(value => { if (mounted.current) setExcerpt(value.fragment.text); }).catch(error => setError(error.message)); }}><span>{chunk.sectionTitle}</span><small>{complete ? clock(start) : `Part ${chunk.index + 1}`}</small></button></li>;
    })}</ol><details className="lecture-script"><summary>Read the current script section</summary><p>{excerpt}</p></details>
    <details><summary>References</summary><ul>{lecture.sources.map((source, index) => <li key={index}><a href={source.url} target="_blank" rel="noreferrer">{source.label}</a></li>)}</ul></details>
  </article>;
}
