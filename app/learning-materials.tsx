"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LearningMaterial } from "../db/learning-materials";
import type { StudyResource } from "../db/study-resources";
import "./learning-materials.css";

type Item=Omit<LearningMaterial,"summary">;
type Fragment={ordinal:number;location:string;offset:number;text:string};
type Source={resource:StudyResource;fragment:Fragment|null;nextChunk:number|null};
async function read<T>(url:string,signal?:AbortSignal):Promise<T>{const r=await fetch(url,{signal});const value=await r.json();if(!r.ok)throw Error(value.error??"Could not load this material.");return value;}
function message(e:unknown){return e instanceof Error?e.message:"Could not load this material.";}
function currentMaterial(){return typeof window==="undefined"?"":new URL(window.location.href).searchParams.get("material")??"";}
export default function LearningMaterials(){
 const [items,setItems]=useState<Item[]>([]),[query,setQuery]=useState(""),[next,setNext]=useState<number|null>(null),[selected,setSelected]=useState(currentMaterial),[material,setMaterial]=useState<LearningMaterial|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(false);
 const generation=useRef(0),loadGeneration=useRef(0);
 const load=useCallback(async(offset=0,q="")=>{const job=++loadGeneration.current;setLoading(true);try{const value=await read<{materials:Item[];nextOffset:number|null}>(`/api/learn/materials?query=${encodeURIComponent(q)}&offset=${offset}`);if(job!==loadGeneration.current)return;setItems(old=>offset?[...old,...value.materials]:value.materials);setNext(value.nextOffset);setError("");}catch(e){if(job===loadGeneration.current)setError(message(e));}finally{if(job===loadGeneration.current)setLoading(false);}},[]);
 useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>{window.clearTimeout(timer);};},[load]);
 useEffect(()=>{const sync=()=>setSelected(currentMaterial());window.addEventListener("popstate",sync);return()=>window.removeEventListener("popstate",sync);},[]);
 useEffect(()=>{const job=++generation.current,abort=new AbortController();if(selected)void read<LearningMaterial>(`/api/learn/materials?materialId=${encodeURIComponent(selected)}`,abort.signal).then(v=>{if(job===generation.current){setMaterial(v);setError("");}}).catch(e=>{if(!abort.signal.aborted&&job===generation.current)setError(message(e));});return()=>abort.abort();},[selected]);
 function select(id:string){setSelected(id);const url=new URL(window.location.href);if(id)url.searchParams.set("material",id);else url.searchParams.delete("material");window.history.pushState(window.history.state,"",url);}
 return <section className={`learning-materials learn-workspace${selected?" has-material":""}`}>
  <header className="material-heading learn-frame"><div><p className="learn-eyebrow">LEARN · MATERIALS</p><h1>Keep the ideas. Return to the source.</h1><p>Detailed notes from your videos, articles and courses. Originals stay intact and private.</p></div><a href="/resources">Upload material ↗</a></header>
  <div className={`material-layout learn-frame${selected?" has-selection":""}`}>
   <aside className="material-index" aria-label="Published materials"><form onSubmit={e=>{e.preventDefault();void load(0,query);}}><label htmlFor="material-search">Find a material</label><div className="material-search"><input id="material-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Title or idea"/><button disabled={loading}>Search</button></div></form>
    <ul>{items.map(i=><li key={i.materialId}><button className={i.materialId===selected?"selected":""} aria-pressed={i.materialId===selected} onClick={()=>select(i.materialId)}><span className="material-kind">{i.kind==="youtube"?"YouTube":i.kind==="article"?"Article":"Uploaded source"}</span><strong>{i.title}</strong><small>{new Date(i.createdAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"America/Los_Angeles"})} · {i.coverage==="complete"?"Full source reviewed":"Partial coverage"}</small></button></li>)}</ul>
    {!items.length&&!loading&&<p className="material-muted">No published materials yet.</p>}{next!==null&&<button disabled={loading} onClick={()=>void load(next,query)}>Load more</button>}<button className="material-refresh" disabled={loading} onClick={()=>void load(0,query)}>Refresh materials</button>
   </aside>
   <article className="material-reader" aria-label="Learning material reader">
    {selected&&<button className="material-back" onClick={()=>select("")}>← All materials</button>}
    {error&&<p role="alert">{error}</p>}
    {material&&material.materialId===selected?<MaterialReader key={material.materialId} material={material}/>:selected?<p role="status">{error?"Choose a material or refresh the page to retry.":"Opening material…"}</p>:<div className="material-empty"><p className="learn-eyebrow">FROM LISTENING TO UNDERSTANDING</p><h2>Your next useful idea belongs here.</h2><p>Ask connected ChatGPT:</p><blockquote>“Publish this video or material to my Interview Arc learning library. Cover every major topic in detail, include key notes, and keep the full source.”</blockquote><p>Give it a YouTube or article URL, an uploaded file, or a resource already in your library. If captions or a subscription page cannot be read, supply the transcript or saved file.</p><a href="/resources">Open study resource library →</a></div>}
   </article>
  </div>
 </section>;
}
function MaterialReader({material:m}:{material:LearningMaterial}){
 const [source,setSource]=useState<Source|null>(null),[fragments,setFragments]=useState<Fragment[]>([]),[error,setError]=useState(""),[busy,setBusy]=useState(false),[expanded,setExpanded]=useState(false),[filter,setFilter]=useState("");
 const busyRef=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function loadSource(all=false){if(busyRef.current)return;busyRef.current=true;setBusy(true);setError("");try{let next=source?source.nextChunk:0;while(next!==null){const value:Source=await read(`/api/study-resources?resourceId=${m.resourceId}&sha256=${m.sourceSha256}&chunk=${next}`);if(!alive.current)return;if(value.resource.sourceSha256!==m.sourceSha256)throw Error("Source identity changed. Reload before reading.");setSource(value);if(value.fragment)setFragments(old=>old.some(f=>f.ordinal===value.fragment!.ordinal)?old:[...old,value.fragment!]);next=value.nextChunk;if(!all)break;}}catch(e){if(alive.current)setError(message(e));}finally{busyRef.current=false;if(alive.current)setBusy(false);}}
 const preview=`/api/learn/materials/source?materialId=${m.materialId}`;
 const isImage=source&&/\.(png|jpe?g|gif|webp)$/i.test(source.resource.filename),isHtml=source&&/\.html?$/i.test(source.resource.filename),isPdf=source&&/\.pdf$/i.test(source.resource.filename);
 return <><div className="material-meta"><span>{m.kind==="youtube"?"YOUTUBE · VIDEO NOTES":m.kind==="article"?"ARTICLE NOTES":"STUDY NOTES"}</span><span>Private</span></div><h2 className="material-title">{m.title}</h2>
  {m.sourceUrl&&<a className="material-source-link" href={m.sourceUrl} target="_blank" rel="noreferrer">Open original source ↗</a>}
  {(m.coverage==="partial"||m.limitations.length>0)&&<aside className="material-limitations"><strong>{m.coverage==="partial"?"Partial source coverage":"Reading notes"}</strong><ul>{m.limitations.map((x,i)=><li key={i}>{x}</li>)}</ul></aside>}
  <section className="material-overview"><h3>Overview</h3><p>{m.summary.overview}</p></section>
  <nav className="material-outline" aria-label="Topics in this material"><h3>What it covers</h3><ol>{m.summary.sections.map((s,i)=><li key={i}><a href={`#material-topic-${i}`}>{s.heading}</a></li>)}</ol></nav>
  {m.summary.sections.map((s,i)=><section className="material-topic" id={`material-topic-${i}`} key={i}><p className="material-location">{String(i+1).padStart(2,"0")} · {s.sourceLocation}</p><h3>{s.heading}</h3><p>{s.body}</p></section>)}
  <section className="material-notes"><h3>Key notes to keep</h3><ul>{m.summary.keyNotes.map((n,i)=><li key={i}>{n}</li>)}</ul></section>
  <details className="material-original" open={expanded} onToggle={e=>{const open=e.currentTarget.open;setExpanded(open);if(open&&!source&&!busyRef.current)void loadSource();}}><summary><span>{m.kind==="youtube"?"Full video transcript":"Full source & original artifact"}</span><small>Expand to read</small></summary>
   {expanded&&<div className="material-original-body"><p>The original is preserved separately from these notes.</p><a href={`/api/study-resources?resourceId=${m.resourceId}&original=1`} download>Download unchanged original</a>
    {source?.resource.warnings.map((w,i)=><p className="material-muted" key={i}>{w}</p>)}
    {isHtml&&<p className="material-muted">Saved page shown safely: scripts and external assets are disabled. Embedded images and styling remain available.</p>}
    {isImage&&<img className="material-image" src={preview} alt={source!.resource.title}/>}
    {(isHtml||isPdf)&&<iframe className="material-preview" title="Original artifact" src={preview} sandbox={isPdf?"allow-same-origin":""}/>}
    {source?.resource.chunkCount===0&&<p>This file has no readable text copy. Use its original preview or download.</p>}
    {source&&source.resource.chunkCount>0&&<><label htmlFor="transcript-filter">Find in loaded source</label><input id="transcript-filter" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Word or phrase"/><p className="material-muted">{fragments.length} of {source.resource.chunkCount} source parts loaded{source.nextChunk===null?" · Complete reading copy":""}</p>
    <div className="material-transcript">{fragments.filter(f=>!filter||f.text.toLowerCase().includes(filter.toLowerCase())).map(f=><section key={f.ordinal}><h4>{f.location} · part {f.ordinal+1}</h4><pre>{f.text}</pre></section>)}</div>
    {source.nextChunk!==null&&<div className="material-source-actions"><button disabled={busy} onClick={()=>void loadSource()}>Read next part</button><button disabled={busy} onClick={()=>void loadSource(true)}>Load full source</button></div>}</>}
    {busy&&<p role="status">Loading source…</p>}{error&&<><p role="alert">{error}</p><button onClick={()=>void loadSource()}>Retry source</button></>}
   </div>}
  </details>
 </>;
}
