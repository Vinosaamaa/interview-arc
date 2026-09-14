"use client";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { LearningMaterial } from "../db/learning-materials";
import type { StudyResource } from "../db/study-resources";
import MaterialPdf from "./material-pdf";
import LearnPageHero from "./learn-page-hero";
import { createPortal } from "react-dom";
import "./learning-materials.css";
type Item = Omit<LearningMaterial, "summary">;
type Fragment = {
    ordinal: number;
    location: string;
    offset: number;
    text: string;
};
type Source = {
    resource: StudyResource;
    fragment: Fragment | null;
    nextChunk: number | null;
};
async function read<T>(url: string, signal?: AbortSignal): Promise<T> { const r = await fetch(url, { signal }); const value = await r.json() as T & { error?: string }; if (!r.ok)
    throw Error(value.error ?? "Could not load this material."); return value; }
function message(e: unknown) { return e instanceof Error ? e.message : "Could not load this material."; }
function currentMaterial() { return typeof window === "undefined" ? "" : new URL(window.location.href).searchParams.get("material") ?? ""; }
export default function LearningMaterials() {
    const [items, setItems] = useState<Item[]>([]), [query, setQuery] = useState(""), [next, setNext] = useState<number | null>(null), [selected, setSelected] = useState(currentMaterial), [material, setMaterial] = useState<LearningMaterial | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(false);
    const generation = useRef(0), loadGeneration = useRef(0);
    const [listError, setListError] = useState("");
    const load = useCallback(async (offset = 0, q = "") => { const job = ++loadGeneration.current; setLoading(true); try {
        const value = await read<{
            materials: Item[];
            nextOffset: number | null;
        }>(`/api/learn/materials?query=${encodeURIComponent(q)}&offset=${offset}`);
        if (job !== loadGeneration.current)
            return;
        setItems(old => offset ? [...old, ...value.materials] : value.materials);
        setNext(value.nextOffset);
        setListError("");
    }
    catch (e) {
        if (job === loadGeneration.current)
            setListError(message(e));
    }
    finally {
        if (job === loadGeneration.current)
            setLoading(false);
    } }, []);
    useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => { window.clearTimeout(timer); }; }, [load]);
    useEffect(() => { const sync = () => setSelected(currentMaterial()); window.addEventListener("popstate", sync); return () => window.removeEventListener("popstate", sync); }, []);
    useEffect(() => { const job = ++generation.current, abort = new AbortController(); if (selected)
        void read<LearningMaterial>(`/api/learn/materials?materialId=${encodeURIComponent(selected)}`, abort.signal).then(v => { if (job === generation.current) {
            setMaterial(v);
            setError("");
        } }).catch(e => { if (!abort.signal.aborted && job === generation.current)
            setError(message(e)); }); return () => abort.abort(); }, [selected]);
    function select(id: string) { setSelected(id); const url = new URL(window.location.href); if (id)
        url.searchParams.set("material", id);
    else
        url.searchParams.delete("material"); window.history.pushState(window.history.state, "", url); }
    return <section className={`learning-materials learn-workspace${selected ? " has-material" : ""}`}>
  <LearnPageHero destination="materials" eyebrow="LEARN · MATERIALS" title={<>Keep the ideas.<br/>Keep the source.</>} quote="Return to what matters." description="Detailed notes from videos, articles and courses, with the complete source beside them." metrics={[{label: next !== null ? "Materials loaded" : "Materials", value: items.length}, {label:"Source types loaded", value: new Set(items.map(i => i.kind)).size}, {label:"Originals", value:"Preserved"}]} action={<a href="/resources">Study resource library ↗</a>}/>

  <div className={`material-layout learn-frame${selected ? " has-selection" : ""}`}>
   <aside className="material-index" aria-label="Published materials"><form onSubmit={e => { e.preventDefault(); void load(0, query); }}><label htmlFor="material-search">Find a material</label><div className="material-search"><input id="material-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Title or idea"/><button disabled={loading}>Search</button></div></form>
    <ul>{items.map(i => <li key={i.materialId}><button className={i.materialId === selected ? "selected" : ""} aria-pressed={i.materialId === selected} onClick={() => select(i.materialId)}><span className="material-kind">{i.kind === "youtube" ? "YouTube" : i.kind === "article" ? "Article" : "Uploaded source"}</span><strong>{i.title}</strong><small>{new Date(i.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" })} · {i.coverage === "complete" ? "Full source reviewed" : "Partial coverage"}</small></button></li>)}</ul>
    {!items.length && !loading && <p className="material-muted">No published materials yet.</p>}{next !== null && <button disabled={loading} onClick={() => void load(next, query)}>Load more</button>}<button className="material-refresh" disabled={loading} onClick={() => void load(0, query)}>Refresh materials</button>
    {listError && <p role="alert">{listError}</p>}
   </aside>
   <article className="material-reader" aria-label="Learning material reader">
    {selected && <button className="material-back" onClick={() => select("")}>← All materials</button>}
    {error && <p role="alert">{error}</p>}
    {material && material.materialId === selected ? <MaterialReader key={material.materialId} material={material}/> : selected ? <p role="status">{error ? "Choose a material or refresh the page to retry." : "Opening material…"}</p> : <div className="material-empty"><p className="learn-eyebrow">FROM LISTENING TO UNDERSTANDING</p><h2>Your next useful idea belongs here.</h2><p>Ask connected ChatGPT:</p><blockquote>“Publish this video or material to my Interview Arc learning library. Cover every major topic in detail, include key notes, and keep the full source.”</blockquote><p>Give it a YouTube or article URL, an uploaded file, or a resource already in your library. If captions or a subscription page cannot be read, supply the transcript or saved file.</p><a href="/resources">Open study resource library →</a></div>}
   </article>
  </div>
 </section>;
}
function MaterialReader({ material: m }: {
    material: LearningMaterial;
}) {
    const [source, setSource] = useState<Source | null>(null), [fragments, setFragments] = useState<Fragment[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false), [expanded, setExpanded] = useState(false), [filter, setFilter] = useState("");
    const busyRef = useRef(false), alive = useRef(true);
    const [visibleParts, setVisibleParts] = useState(10);
    const [fullScreen, setFullScreen] = useState(false);
    const dialog = useRef<HTMLDialogElement>(null), opener = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!fullScreen) { opener.current?.focus(); return; }
        if (!dialog.current) return;
        const element = dialog.current;
        const previousOverflow = document.body.style.overflow;

        document.body.style.overflow = "hidden";
        element.showModal();
        return () => { element.close(); document.body.style.overflow = previousOverflow; };
    }, [fullScreen]);
    const normalized = useMemo(() => fragments.map(f => ({ ...f, searchText: f.text.toLowerCase() })), [fragments]);
    const term = useDeferredValue(filter.toLowerCase());
    const matching = useMemo(() => normalized.filter(f => !term || f.searchText.includes(term)), [normalized, term]);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    async function loadSource(all = false) { if (source?.nextChunk === null || busyRef.current)
        return; busyRef.current = true; setBusy(true); setError(""); try {
        if (all) {
            const value = await read<{
                resource: StudyResource;
                fragments: Fragment[];
                nextChunk: null;
            }>(`/api/learn/materials?materialId=${m.materialId}&source=1`);
            if (alive.current) {
                setSource({ ...value, fragment: value.fragments[0] ?? null });
                setFragments(value.fragments);
                setVisibleParts(value.fragments.length);
            }
            return;
        }
        let next = source ? source.nextChunk : 0;
        while (next !== null) {
            const value: Source = await read(`/api/study-resources?resourceId=${m.resourceId}&sha256=${m.sourceSha256}&chunk=${next}`);
            if (!alive.current)
                return;
            if (value.resource.sourceSha256 !== m.sourceSha256)
                throw Error("Source identity changed. Reload before reading.");
            setSource(value);
            if (value.fragment)
                setFragments(old => old.some(f => f.ordinal === value.fragment!.ordinal) ? old : [...old, value.fragment!]);
            next = value.nextChunk;
            if (!all)
                break;
        }
    }
    catch (e) {
        if (alive.current)
            setError(message(e));
    }
    finally {
        busyRef.current = false;
        if (alive.current)
            setBusy(false);
    } }
    const preview = `/api/learn/materials/source?materialId=${m.materialId}`;
    const isImage = source && /\.(png|jpe?g|gif|webp)$/i.test(source.resource.filename), isHtml = source && /\.html?$/i.test(source.resource.filename), isPdf = source && /\.pdf$/i.test(source.resource.filename);
    const sourceBody = <div className="material-original-body">
      <div className="material-source-actions"><a href={`/api/study-resources?resourceId=${m.resourceId}&original=1`} download>Download unchanged original</a>
      {!fullScreen && <button ref={opener} disabled={busy} onClick={() => { setFullScreen(true); void loadSource(true); }}>Open full screen</button>}</div>
      {source?.resource.warnings.map((w, i) => <p className="material-muted" key={i}>{w}</p>)}
      {isHtml && <p className="material-muted">Original saved page. Scripts and external assets are disabled.</p>}
      {isImage && <img className="material-image" src={preview} alt={source!.resource.title}/>}
      {isHtml && <iframe className="material-preview" title="Original artifact" src={preview} sandbox=""/>}
      {isPdf && <MaterialPdf url={preview}/>}
      {source?.resource.chunkCount === 0 && <p>This file has no readable text copy. Use its original preview or download.</p>}
      {source && source.resource.chunkCount > 0 && <><label htmlFor="transcript-filter">{source.nextChunk === null ? "Find in full source" : "Find in loaded source"}</label><input id="transcript-filter" value={filter} onChange={e => { setFilter(e.target.value); setVisibleParts(10); }} placeholder="Word or phrase"/>
      <p className="material-muted" role="status">{fragments.length} of {source.resource.chunkCount} source parts loaded{source.nextChunk === null ? " · Complete reading copy" : ""}</p>
      <div className="material-transcript">{matching.slice(0, visibleParts).map(f => <section key={f.ordinal}><h4>{f.location} · part {f.ordinal + 1}</h4><pre>{f.text}</pre></section>)}{term && matching.length === 0 && <p>No matches in the loaded source.</p>}</div>
      {matching.length > visibleParts && <button onClick={() => setVisibleParts(n => n + 10)}>Show more source parts ({matching.length - visibleParts} remaining)</button>}
      {source.nextChunk !== null && <div className="material-source-actions"><button disabled={busy} onClick={() => void loadSource()}>Read next part</button><button disabled={busy} onClick={() => void loadSource(true)}>Load full source</button></div>}</>}
      {busy && <p role="status">Loading source…</p>}{error && <><p role="alert">{error}</p><button onClick={() => void loadSource(fullScreen)}>Retry source</button></>}
    </div>;
    return <><details className="learn-lesson-contents material-contents"><summary>Contents</summary><nav aria-label="Material contents"><a href="#material-overview">Overview</a>{m.summary.sections.map((s,i) => <a key={i} href={`#material-topic-${i}`}>{s.heading}</a>)}<a href="#material-key-notes">Key notes</a><a href="#material-original" onClick={() => { setExpanded(true); void loadSource(); }}>{m.kind === "youtube" ? "Full transcript" : "Full source"}</a></nav></details><div className="material-meta"><span>{m.kind === "youtube" ? "YOUTUBE · VIDEO NOTES" : m.kind === "article" ? "ARTICLE NOTES" : "STUDY NOTES"}</span><span>Private</span></div><h2 className="material-title">{m.title}</h2>
  {m.sourceUrl && <a className="material-source-link" href={m.sourceUrl} target="_blank" rel="noreferrer">Open original source ↗</a>}
  {(m.coverage === "partial" || m.limitations.length > 0) && <details className="material-limitations" open={m.coverage === "partial"}><summary>{m.coverage === "partial" ? "Partial source coverage" : "Source notes"}</summary><ul>{m.limitations.map((x, i) => <li key={i}>{x}</li>)}</ul></details>}
  <section id="material-overview" className="material-overview"><h3>Overview</h3><p>{m.summary.overview}</p></section>

  {m.summary.sections.map((s, i) => <section className="material-topic" id={`material-topic-${i}`} key={i}><p className="material-location">{String(i + 1).padStart(2, "0")} · {s.sourceLocation}</p><h3>{s.heading}</h3><p>{s.body}</p></section>)}
  <section id="material-key-notes" className="material-notes"><h3>Key notes to keep</h3><ul>{m.summary.keyNotes.map((n, i) => <li key={i}>{n}</li>)}</ul></section>
  <details id="material-original" className="material-original" open={expanded} onToggle={e => { const open = e.currentTarget.open; setExpanded(open); if (open && !source && !busyRef.current)
        void loadSource(); }}><summary><span>{m.kind === "youtube" ? "Full video transcript" : "Full source & original artifact"}</span><small>Expand to read</small></summary>
   {expanded && !fullScreen && sourceBody}
  </details>
  {fullScreen && createPortal(<dialog ref={dialog} className="material-fullscreen learning-materials learn-workspace" aria-labelledby="full-source-title" onCancel={() => setFullScreen(false)} onClose={() => setFullScreen(false)}><header><h2 id="full-source-title">{m.kind === "youtube" ? "Full transcript" : "Full source"} · {m.title}</h2><button onClick={() => setFullScreen(false)}>Close</button></header><div className="material-fullscreen-body">{sourceBody}</div></dialog>, document.body)}
 </>;
}
