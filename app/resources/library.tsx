"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StudyResource } from "../../db/study-resources";
import { resourceTeachingPrompt } from "../../db/study-resource-policy";
import { pdfPageImages } from "./pdf-pages";
import "./resources.css";

type Reading = { resource: StudyResource; fragment: { location: string; text: string; ordinal: number } | null; nextChunk: number | null; readingCopies: { resourceId: string; page: number }[] };
type Upload = { file: File | null; filename: string; operationId: string; state: string; resource?: StudyResource };
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw Error(data.error ?? "The request was not confirmed.");
  return data;
}
async function upload(file: Blob, filename: string, title: string, operationId: string) {
  const form = new FormData(); form.set("file", file, filename); form.set("title", title); form.set("operationId", operationId);
  return (await request<{ resource: StudyResource }>("/api/study-resources", { method: "POST", body: form })).resource;
}
export default function ResourceLibrary() {
  const [items, setItems] = useState<StudyResource[]>([]), [nextOffset, setNextOffset] = useState<number | null>(null);
  const [query, setQuery] = useState(""), [reading, setReading] = useState<Reading | null>(null);
  const [jobs, setJobs] = useState<Upload[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [notice, setNotice] = useState(""), [prompt, setPrompt] = useState("");
  const [ready, setReady] = useState(false);
  const selection = useRef(0), searchRevision = useRef(0), displayedQuery = useRef(""), loadingOffsets = useRef(new Set<number>());
  const load = useCallback(async (offset = 0, search = "") => {
    const revision = offset === 0 ? ++searchRevision.current : searchRevision.current;
    if (offset === 0) { displayedQuery.current = search; loadingOffsets.current.clear(); }
    else if (search !== displayedQuery.current || loadingOffsets.current.has(0) || loadingOffsets.current.has(offset)) return;
    loadingOffsets.current.add(offset);
    try {
      const data = await request<{ resources: StudyResource[]; nextOffset: number | null }>(`/api/study-resources?offset=${offset}&query=${encodeURIComponent(search)}`);
      if (revision !== searchRevision.current) return;
      setItems(old => offset ? [...old, ...data.resources] : data.resources); setNextOffset(data.nextOffset);
    } catch (e) { if (revision === searchRevision.current) throw e; }
    finally { if (revision === searchRevision.current) loadingOffsets.current.delete(offset); }
  }, []);
  useEffect(() => {
    let active = true; const revision = searchRevision.current;
    request<{ resources: StudyResource[]; nextOffset: number | null }>("/api/study-resources").then(data => {
      if (!active) return;
      setReady(true);
      if (revision === searchRevision.current) { setItems(data.resources); setNextOffset(data.nextOffset); }
    }).catch(e => { if (active) { if (revision === searchRevision.current) setError(e.message); setReady(true); } });
    return () => { active = false; };
  }, []);
  async function open(resource: StudyResource, chunk = 0) {
    const ticket = ++selection.current; setError("");
    try {
      const data = await request<Reading>(`/api/study-resources?resourceId=${resource.resourceId}&chunk=${chunk}&sha256=${resource.sourceSha256}`);
      if (ticket === selection.current) { setReading(data); setPrompt(""); }
    } catch (e) { if (ticket === selection.current) setError((e as Error).message); }
  }
  async function run(queue: Upload[]) {
    setBusy(true); setError("");
    for (const job of queue) {
      if (job.state === "Saved" || !job.file) continue;
      const file = job.file;
      const update = (state: string) => { job.state = state; setJobs([...queue]); };
      try {
        update("Saving original…");
        job.resource ??= await upload(file, file.name, file.name, job.operationId);
        if (new TextDecoder().decode(new Uint8Array(await file.slice(0, 5).arrayBuffer())) === "%PDF-") {
          await preparePdf(file, job.resource, update);
        }
        job.file = null; update("Saved");
      } catch (e) { update((e as Error).message); }
    }
    setBusy(false); await load(0, query).catch(e => setError(e.message));
  }
  async function preparePdf(file: Blob, parent: StudyResource, update: (message: string) => void) {
    for await (const image of pdfPageImages(file)) {
      update(`Original saved · preparing page ${image.page} of ${image.total}`);
      const derived = await upload(image.blob, `page-${image.page}.png`, `${parent.title} · page ${image.page}`, `${parent.resourceId}:page-v1:${image.page}`);
      await request("/api/study-resources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceId: derived.resourceId, target: "resource", targetId: parent.resourceId, revision: image.page }) });
    }
  }
  async function prepareSelected() {
    if (!reading) return; setBusy(true); setError("");
    try {
      const response = await fetch(reading.resource.originalUrl);
      if (!response.ok) throw Error("Original download was not confirmed.");
      await preparePdf(await response.blob(), reading.resource, setNotice);
      setNotice("Page images saved for ChatGPT."); await open(reading.resource);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <main className="resources-page">
    <header><Link href="/">← Interview Arc</Link><p className="resource-eyebrow">YOUR STUDY LIBRARY</p><h1>Keep the whole source.</h1><p>Upload once. Read here, or ask connected ChatGPT to teach and practise from your material.</p></header>
    <section className="resource-upload" aria-labelledby="upload-title"><div><h2 id="upload-title">Add your files</h2><p>HTML, PDF, TXT, Markdown, images and other files. Originals stay intact. Up to 25 MB per file.</p><p className="resource-muted">Updated material is a new upload; earlier originals remain available. PDF page images are prepared here for visual reading.</p></div><label className="resource-upload-button">Choose files<input type="file" multiple disabled={busy || !ready} onChange={e => { const queue = Array.from(e.target.files ?? []).map(file => ({ file, filename: file.name, operationId: "upload-" + crypto.randomUUID(), state: "Waiting" })); setJobs(queue); void run(queue); e.target.value = ""; }} /></label></section>
    {jobs.length > 0 && <section aria-label="Upload progress"><ul className="resource-jobs">{jobs.map(job => <li key={job.operationId}><strong>{job.filename}</strong><span role="status">{job.state}</span></li>)}</ul>{!busy && jobs.some(j => j.state !== "Saved") && <button onClick={() => void run(jobs)}>Retry unfinished uploads</button>}</section>}
    <p role="alert" className="resource-error">{error}</p><p role="status">{notice}</p>
    <div className="resource-columns"><aside><form onSubmit={e => { e.preventDefault(); load(0, query).catch(e => setError(e.message)); }}><label htmlFor="resource-search">Find in your library</label><div className="resource-actions"><input id="resource-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Title or text phrase" /><button>Search</button></div></form>
      <ul className="resource-list">{items.map(item => <li key={item.resourceId}><button aria-pressed={reading?.resource.resourceId === item.resourceId} onClick={() => void open(item)}><strong>{item.title}</strong><small>{Math.ceil(item.sizeBytes / 1024)} KB · {item.chunkCount ? `${item.chunkCount} reading fragments` : "Original file"}</small></button></li>)}</ul>
      {!items.length && <p className="resource-muted">Your saved files will appear here.</p>}{nextOffset !== null && <button onClick={() => load(nextOffset, query).catch(e => setError(e.message))}>Load more</button>}</aside>
      <article aria-label="Resource reader">{reading ? <><p className="resource-eyebrow">ORIGINAL PRESERVED</p><h2>{reading.resource.title}</h2><div className="resource-actions"><a className="resource-button" href={reading.resource.originalUrl} download>Download original</a><button onClick={async () => { const text = resourceTeachingPrompt(reading.resource.resourceId, reading.resource.title); setPrompt(text); try { await navigator.clipboard.writeText(text); setNotice("ChatGPT request copied."); } catch { setNotice("Copy the request below into connected ChatGPT."); } }}>Use in ChatGPT</button>{reading.resource.filename.toLowerCase().endsWith(".pdf") && <button disabled={busy} onClick={() => void prepareSelected()}>Prepare PDF page images</button>}</div>
        {prompt && <label className="resource-prompt">Paste into connected ChatGPT<textarea readOnly value={prompt} rows={8} /></label>}
        {reading.resource.warnings.length > 0 && <details className="resource-notes" open><summary>Reading coverage</summary><ul>{reading.resource.warnings.map(w => <li key={w}>{w}</li>)}</ul></details>}
        {reading.readingCopies.length > 0 && <div className="resource-actions"><span>Page images:</span>{reading.readingCopies.map(copy => <button key={copy.resourceId} onClick={() => request<Reading>(`/api/study-resources?resourceId=${copy.resourceId}`).then(setReading).catch(e => setError(e.message))}>Page {copy.page}</button>)}</div>}
        {/\.(png|jpe?g|gif|webp)$/i.test(reading.resource.filename) && <figure><a href={`/api/study-resources?resourceId=${reading.resource.resourceId}&image=1`} target="_blank" rel="noreferrer">Open full-size image</a>
          {/* The authenticated endpoint serves verified private image bytes. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={reading.resource.title} src={`/api/study-resources?resourceId=${reading.resource.resourceId}&image=1`} style={{ maxWidth: "100%", height: "auto" }} />
        </figure>}
        {reading.fragment ? <><div className="resource-actions resource-paging"><span>{reading.fragment.location} · fragment {reading.fragment.ordinal + 1} of {reading.resource.chunkCount}</span><button disabled={reading.fragment.ordinal === 0} onClick={() => void open(reading.resource, reading.fragment!.ordinal - 1)}>Previous</button><button disabled={reading.nextChunk === null} onClick={() => void open(reading.resource, reading.nextChunk!)}>Next</button></div><pre className="resource-text">{reading.fragment.text}</pre></> : <p>The original is saved. For images, ask ChatGPT to inspect the pixels with its library tool. Other formats may need a separate reading copy.</p>}
        <details><summary>Original identity</summary><code className="resource-hash">{reading.resource.sourceSha256}</code><small>{reading.resource.resourceId}</small></details>
      </> : <div className="resource-empty"><h2>Your material, ready to return to.</h2><p>Choose a file to read its complete text in fragments, download the unchanged original, or use it in ChatGPT.</p><p>ChatGPT can also save attached files to this same private library through the Interview Arc connection.</p></div>}</article></div>
  </main>;
}
