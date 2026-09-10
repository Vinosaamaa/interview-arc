"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { CHATGPT_IMPORT_MAX_BYTES, chatgptTimingLabel, type ChatgptExport, type ChatgptImportRequest, type ImportedPractice, type ImportPreview } from "../db/chatgpt-import-policy";
import type { readChatgptBank } from "../db/chatgpt-bank";
import type { listImportedPractice } from "../db/chatgpt-import-store";
import type { PracticeEditorial } from "../db/practice-editorial";
import type { PracticeDrawing } from "../db/practice-drawing";
import type { PracticeSolutionPublication } from "../db/practice-solution-publication";
import "./chatgpt-practice.css";

type Bank = Awaited<ReturnType<typeof readChatgptBank>>;
type Page = Awaited<ReturnType<typeof listImportedPractice>>;
const guideUrl = "https://github.com/Vinosaamaa/interview-arc/blob/main/docs/agents/chatgpt-practice-prompt.md";
async function readJson<T>(response: Response): Promise<T> {
  const value = await response.json() as { error?: string; issues?: { path: string; message: string }[] };
  if (!response.ok) throw new Error([value.error, ...((value.issues ?? []) as { path: string; message: string }[]).map((i) => `${i.path}: ${i.message}`)].join("\n"));
  return value as T;
}
export default function ChatgptPractice({ MarkdownBody, refreshKey }: { MarkdownBody: ComponentType<{ source: string }>; refreshKey?: unknown }) {
  const [raw, setRaw] = useState("");
  const [packet, setPacket] = useState<ChatgptExport | null>(null);
  const [bank, setBank] = useState<Bank | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [resolutions, setResolutions] = useState<ChatgptImportRequest["resolutions"]>([]);
  const [corrections, setCorrections] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [page, setPage] = useState<Page | null>(null);
  const [pending, setPending] = useState<Page | null>(null);
  const [selected, setSelected] = useState<(ImportedPractice & { editorial?: PracticeEditorial | null; drawing?: PracticeDrawing | null; solutionPublication?: PracticeSolutionPublication | null }) | null>(null);
  const selectedActivityId = selected?.activityId;
  useEffect(() => {
    if (!selectedActivityId) return;
    const controller = new AbortController();
    void fetch(`/api/chatgpt-practice?activityId=${encodeURIComponent(selectedActivityId)}`, { cache: "no-store", signal: controller.signal })
      .then(readJson<{ record: NonNullable<typeof selected> }>)
      .then(({ record }) => setSelected(current => current?.activityId === selectedActivityId ? record : current))
      .catch(e => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [selectedActivityId, refreshKey]);
  const dialog = useRef<HTMLDialogElement>(null);
  const editor = useRef<HTMLDetailsElement>(null);
  const refresh = useCallback(async () => {
    const [completed, drafts] = await Promise.all([
      fetch("/api/chatgpt-practice", { cache: "no-store" }).then(readJson<Page>),
      fetch("/api/chatgpt-practice?status=pending", { cache: "no-store" }).then(readJson<Page>),
    ]);
    setPage(completed); setPending(drafts);
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch("/api/chatgpt-practice", { cache: "no-store" }).then(readJson<Page>),
      fetch("/api/chatgpt-practice?status=pending", { cache: "no-store" }).then(readJson<Page>),
    ]).then(([completed, drafts]) => { if (active) { setPage(completed); setPending(drafts); } })
      .catch((e) => { if (active) setError(String(e.message)); });
    return () => { active = false; };
  }, []);
  useEffect(() => { if (selected) dialog.current?.showModal(); else dialog.current?.close(); }, [selected]);
  function changeRaw(value: string) { setRaw(value); setPreview(null); setPacket(null); setResolutions([]); setCorrections(false); setMessage(""); }
  async function run(action: "preview" | "apply") {
    setBusy(true); setError(""); setMessage("");
    try {
      if (new TextEncoder().encode(raw).length > CHATGPT_IMPORT_MAX_BYTES) throw new Error("Use a packet smaller than 1 MB. Split a large day into session exports.");
      const parsed = JSON.parse(raw) as ChatgptExport;
      const response = await fetch("/api/chatgpt-practice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, packet: parsed, resolutions, confirmCorrections: corrections, ...(preview ? { previewToken: preview.previewToken } : {}) }) });
      const result = await readJson<ImportPreview>(response);
      setPacket(parsed); setPreview(result);
      if (action === "apply") {
        const completed = result.records.filter((r) => r.status === "completed").length;
        setMessage(`${result.duplicate ? "Already saved" : "Saved and verified"}: ${completed} completed, ${result.records.length - completed} pending. Today is unchanged.`);
        await refresh();
      } else if (!bank) setBank(await fetch("/api/chatgpt-practice?bank=1", { cache: "no-store" }).then(readJson<Bank>));
    } catch (e) { setError(e instanceof Error ? e.message : "Import could not be confirmed. Retry the unchanged export."); }
    finally { setBusy(false); }
  }
  function resolve(attemptKey: string, field: "questionId" | "practiceDate", value: string) {
    setResolutions((rows) => [...rows.filter((r) => r.attemptKey !== attemptKey), { ...rows.find((r) => r.attemptKey === attemptKey), attemptKey, [field]: value || undefined }]);
    setPreview(null); setMessage("");
  }
  async function openRecord(activityId: string) {
    setError("");
    try { setSelected((await fetch(`/api/chatgpt-practice?activityId=${encodeURIComponent(activityId)}`, { cache: "no-store" }).then(readJson<{ record: ImportedPractice }>)).record); }
    catch (e) { setError((e as Error).message); }
  }
  function correctRecord(record: ImportedPractice) {
    const exportPacket: ChatgptExport = { schemaVersion: 1, kind: "practice_export", packetId: `correction-${crypto.randomUUID()}`, exportedAt: new Date().toISOString(), timeZone: "America/Los_Angeles",
      snapshots: record.snapshot ? [record.snapshot] : [], sources: record.sources.map((s) => ({ ...s, coverage: s.coverage === "summary_only" ? "summary_only" : "partial", gaps: [...s.gaps, "This correction contains only the source turns previously linked to this attempt."] })),
      sessions: [{ ...record.session, attempts: [record.attempt] }], gaps: [] };
    changeRaw(JSON.stringify(exportPacket, null, 2)); setSelected(null);
    if (editor.current) { editor.current.open = true; editor.current.scrollIntoView({ block: "start" }); }
  }
  async function more(status: "completed" | "pending") {
    const target = status === "completed" ? page : pending;
    if (target?.nextOffset == null) return;
    try {
      const next = await fetch(`/api/chatgpt-practice?status=${status}&offset=${target.nextOffset}`, { cache: "no-store" }).then(readJson<Page>);
      const update = { records: [...target.records, ...next.records], nextOffset: next.nextOffset };
      if (status === "completed") setPage(update); else setPending(update);
    } catch (e) { setError((e as Error).message); }
  }
  return <section className="chatgpt-practice" aria-label="ChatGPT practice">
    <details ref={editor} className="chatgpt-import-editor">
      <summary><span>ChatGPT practice</span><small>Bring your conversation back to Arc</small></summary>
      <div className="chatgpt-import-flow">
        <div className="chatgpt-import-handoff"><h3>Take your questions with you</h3><p>Download your private bank, attach it in text ChatGPT with the guide, then switch to Live in that same chat. Download again when you want fresh progress.</p><div className="chatgpt-import-actions"><a href="/api/chatgpt-practice?bank=1&download=1" download>Download private bank</a><a href={guideUrl} target="_blank" rel="noreferrer">Open practice guide ↗</a></div><p className="chatgpt-import-note">Your bank file contains personal questions and progress. Keep it out of GitHub. Live uses the supplied snapshot; it does not continuously refresh Arc.</p></div>
        <div><h3>Bring the session back</h3><p>After Voice, ask text ChatGPT to export the session using the guide. Choose the JSON file or paste its contents below.</p>
          <label className="chatgpt-import-file">Choose session export<input type="file" accept=".json,application/json" disabled={busy} onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; if (file.size > CHATGPT_IMPORT_MAX_BYTES) { setError("Choose a session export smaller than 1 MB."); return; } changeRaw(await file.text()); }} /></label>
          <label>Session export<textarea rows={5} value={raw} disabled={busy} onChange={(e) => changeRaw(e.target.value)} spellCheck={false} placeholder="Paste the complete JSON export…" /></label>
          <button type="button" disabled={busy || !raw.trim()} onClick={() => void run("preview")}>{busy ? "Checking…" : "Preview import"}</button>
        </div>
      </div>
      {packet && <div className="chatgpt-import-preview"><h3>Review each question</h3><p>Missing dates and question matches need your input. Estimated time stays approximate.</p>
        {packet.sessions.flatMap((s) => s.attempts).map((attempt) => {
          const record = preview?.records.find((r) => r.attemptKey === attempt.attemptKey);
          const resolution = resolutions.find((r) => r.attemptKey === attempt.attemptKey);
          return <article key={attempt.attemptKey}><header><h4>{attempt.question.title}</h4><span>{record ? record.status === "completed" ? "Ready for Past" : "Save as pending" : "Preview needed"}</span></header><p>{chatgptTimingLabel(attempt.timing)} · {attempt.outcome?.replaceAll("_", " ") ?? "No result supplied"}</p>
            <div className="chatgpt-import-fields"><label>Bank question<select value={resolution?.questionId ?? attempt.question.questionId ?? ""} disabled={busy} onChange={(e) => resolve(attempt.attemptKey, "questionId", e.target.value)}><option value="">Choose a question</option>{bank?.questions.filter((q) => q.specialty === attempt.question.specialty).map((q) => <option key={q.questionId} value={q.questionId}>{q.title}{q.availability === "inactive" ? " (inactive)" : ""}</option>)}</select></label><label>Pacific practice date<input type="date" disabled={busy} value={resolution?.practiceDate ?? attempt.practiceDate ?? ""} onChange={(e) => resolve(attempt.attemptKey, "practiceDate", e.target.value)} /></label></div>
            {record?.reasons.map((reason) => <p className="chatgpt-import-note" key={reason}>{reason}</p>)}
            <details><summary>Review supplied content</summary><MarkdownBody source={attempt.summary || "No summary supplied."} /><MarkdownBody source={attempt.review || "No review supplied."} /><p>{attempt.turnKeys.length} linked source turns · {attempt.gaps.join(" · ") || "No attempt gaps declared"}</p></details>
          </article>;
        })}
        {preview && <><details><summary>Source gaps and session timing</summary>{preview.warnings.map((w, i) => <p key={i}>{w}</p>)}{packet.sessions.map((s) => <p key={s.sessionKey}>Session · {chatgptTimingLabel(s.timing)} · {s.timing.evidence ?? "No timing evidence supplied"}</p>)}</details>{preview.corrections && <label className="chatgpt-import-confirm"><input type="checkbox" checked={corrections} onChange={(e) => setCorrections(e.target.checked)} /> I reviewed the changed attempts and want to save new revisions.</label>}<button type="button" className="chatgpt-import-save" disabled={busy || preview.corrections && !corrections} onClick={() => void run("apply")}>Save reviewed import</button></>}
      </div>}
    </details>
    {error && <p className="chatgpt-import-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {Boolean(page?.records.length) && <div className="chatgpt-import-history"><h3>Imported practice</h3>{page!.records.map((r) => <button type="button" key={r.activityId} onClick={() => void openRecord(r.activityId)}><span><time>{r.practiceDate}</time><strong>{r.title}</strong></span><small>{chatgptTimingLabel(r.timing)}</small></button>)}{page?.nextOffset != null && <button type="button" onClick={() => void more("completed")}>Load more imported practice</button>}</div>}
    {Boolean(pending?.records.length) && <details className="chatgpt-import-pending"><summary>Pending imports · {pending!.records.length}{pending?.nextOffset != null ? "+" : ""}</summary><p>Source evidence is saved. These entries do not count as completed practice yet.</p>{pending!.records.map((r) => <button type="button" key={r.activityId} onClick={() => void openRecord(r.activityId)}>{r.title} · {r.reasons[0]}</button>)}{pending?.nextOffset != null && <button type="button" onClick={() => void more("pending")}>Load more pending imports</button>}</details>}
    <dialog ref={dialog} className="chatgpt-import-reader" onClose={() => setSelected(null)}>
      {selected && <><header><span>Imported practice · Revision {selected.revision}</span><button type="button" autoFocus onClick={() => setSelected(null)}>Close</button></header><div className="chatgpt-import-reader-body"><h2>{selected.attempt.question.title}</h2><p>{selected.practiceDate ?? "Date unknown"} · {chatgptTimingLabel(selected.attempt.timing)} · {selected.status === "completed" ? "Completed" : "Pending"}</p><p>{selected.attempt.timing.evidence}</p>{selected.reasons.map((reason) => <p key={reason}>{reason}</p>)}{selected.status === "pending" && <button type="button" onClick={() => correctRecord(selected)}>Resolve this import</button>}
        {selected.solutionPublication && <section aria-label="Solution added after practice"><h3>Solution added after practice</h3><p>Solution revision {selected.solutionPublication.solutionRevision} was {selected.solutionPublication.action} after this practice was saved.</p><div className="chatgpt-import-actions"><a href={`/?view=banks&specialty=${encodeURIComponent(selected.solutionPublication.specialty)}&problem=${encodeURIComponent(selected.solutionPublication.questionId)}`}>Open latest solution</a></div></section>}
        <h3>Prompt used</h3><MarkdownBody source={selected.attempt.question.prompt ?? "The source did not supply a prompt."} />
        <h3>Attempt summary</h3><MarkdownBody source={selected.attempt.summary || "No summary supplied."} />
        <h3>Activity review</h3><MarkdownBody source={selected.attempt.review || "No review supplied."} />
        {selected.drawing && <section aria-label="Saved drawing"><h3>Saved drawing</h3><p>{selected.drawing.authorship === "owner" ? "Your drawing" : "AI-generated reference"} · Drawing revision {selected.drawing.revision} · {selected.drawing.elementCount} elements</p><div className="chatgpt-import-actions"><a href={selected.drawing.url} target="_blank" rel="noreferrer">Open diagram in Excalidraw ↗</a><a href={selected.drawing.downloadUrl}>Download editable drawing</a></div><p className="chatgpt-import-note">Arc retains the editable original. This snapshot does not update when you edit a separate browser canvas.</p></section>}
        {selected.editorial && <section aria-label="Editorial added after practice"><h3>Editorial added after practice</h3><p><a href={selected.editorial.editorialUrl} target="_blank" rel="noreferrer">Official editorial ↗</a> · Addition revision {selected.editorial.revision} · Read {selected.editorial.accessedAt}</p><MarkdownBody source={selected.editorial.explanation} /></section>}
        <details><summary>Conversation · supplied transcript</summary>{selected.sources.map((s) => <section key={s.sourceChatKey}><p>Linked turns from {s.providedRange}. Original capture: {s.coverage.replaceAll("_", " ")}.</p>{s.turns.map((t) => <article key={t.turnKey}><strong>{t.speaker === "user" ? "You" : "ChatGPT"}</strong><MarkdownBody source={t.text} /></article>)}{s.gaps.map((gap) => <p key={gap}>{gap}</p>)}</section>)}</details>
        <details><summary>Timing and source details</summary><p>Latest session: {chatgptTimingLabel(selected.currentSession?.timing ?? selected.session.timing)}. This is separate from question time.</p><p>{selected.currentSession?.timing.evidence ?? selected.session.timing.evidence}</p><p>Session at this record revision: {chatgptTimingLabel(selected.session.timing)}</p><p>{selected.snapshot?.sourceDescription ?? "No bank snapshot supplied"}</p><p>{selected.attempt.kind} · {selected.attempt.mode} · {selected.attempt.outcome ?? "Result not supplied"}</p>{selected.attempt.timing.events.map((e, i) => <p key={i}>{e.command} · {e.at ?? "Time unknown"} · {e.evidence}</p>)}{selected.attempt.gaps.map((gap) => <p key={gap}>{gap}</p>)}<small>Record {selected.activityId} · {selected.fingerprint}</small></details>
      </div></>}
    </dialog>
  </section>;
}
