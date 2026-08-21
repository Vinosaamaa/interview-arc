"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { acquireDocumentScrollLock } from "./document-scroll-policy";

const PART_BYTES = 5 * 1024 * 1024;

type Material = {
  materialId: string;
  revision: number;
  stageId?: string;
  label: string;
  summary?: string;
  sections: Array<{ sectionId: string; title: string; body?: string; bullets: string[] }>;
};

export type InterviewPackageLoopOption = {
  loopId: string;
  company: string;
  roleTitle: string;
  revision: number;
  roleBriefRevision: number;
  stages: Array<{ stageId: string; label: string; status: string }>;
  materials: Material[];
};

type PackageSource = {
  sourceId: string;
  kind: "audio" | "transcript" | "document" | "image";
  state: string;
  label: string;
  mediaType: string;
  sizeBytes: number;
  contentHash?: string;
  transcriptRepresentation?: { format: string; cueCount: number; cues: Array<{ sequence: number; timing?: string; text: string }> };
  rejectionCode?: string;
};

type PackageEntry = {
  entryId: string;
  kind: "link" | "note";
  revision: number;
  snapshot: { kind: "link"; label: string; url: string; note?: string } | { kind: "note"; label: string; body: string };
  contentHash: string;
};

type PackageRecord = {
  packageId: string;
  revision: number;
  status: string;
  interviewAt?: number;
  timeZone?: string;
  assignment: { loopId: string; stageId?: string } | null;
  manifestDigest?: string;
  sources: PackageSource[];
  entries: PackageEntry[];
  uploads: Array<{ sourceId: string; status: string; expectedBytes: number; uploadedBytes: number; expiresAt: number }>;
  materialLink: { state: string; materialId?: string; materialRevision?: number } | null;
  proposals: Array<{ proposalId: string; status: string; materialId: string; baseMaterialRevision: number | null; proposedSnapshot: Material; confirmedMaterialRevision?: number }>;
  createdAt: number;
  updatedAt: number;
};

function operationId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function sourceKind(file: File) {
  if (file.type.startsWith("audio/")) return "audio";
  if (["text/vtt", "application/x-subrip"].includes(file.type) || /\.(srt|vtt)$/i.test(file.name)) return "transcript";
  if (file.type.startsWith("image/")) return "image";
  return "document";
}

function mediaTypeForFile(file: File, kind = sourceKind(file)) {
  if (file.type) return file.type;
  if (/\.vtt$/i.test(file.name)) return "text/vtt";
  if (/\.srt$/i.test(file.name)) return "application/x-subrip";
  if (/\.md$/i.test(file.name)) return "text/markdown";
  if (/\.pdf$/i.test(file.name)) return "application/pdf";
  return kind === "transcript" ? "text/plain" : "application/octet-stream";
}

async function packageCommand(action: string, payload: Record<string, unknown>) {
  const operation = String(payload.operationId ?? "");
  const response = await fetch("/api/interview-packages", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": operation },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String(body.error ?? "The Interview Package command failed."));
  return body;
}

function packageTitle(record: PackageRecord, loops: InterviewPackageLoopOption[]) {
  const loop = record.assignment ? loops.find((candidate) => candidate.loopId === record.assignment?.loopId) : undefined;
  return loop ? `${loop.company} · ${loop.roleTitle}` : "Unassigned interview";
}

export default function InterviewPackageDialog({
  opener,
  loops,
  initialLoopId,
  onClose,
}: {
  opener: HTMLButtonElement;
  loops: InterviewPackageLoopOption[];
  initialLoopId?: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const selectedIdRef = useRef("");
  const [records, setRecords] = useState<PackageRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loopId, setLoopId] = useState(initialLoopId ?? "");
  const [stageId, setStageId] = useState("");
  const [newLoopId, setNewLoopId] = useState(initialLoopId ?? "");
  const [newStageId, setNewStageId] = useState("");
  const [interviewLocal, setInterviewLocal] = useState("");
  const [consent, setConsent] = useState(false);
  const [entryKind, setEntryKind] = useState<"note" | "link">("note");
  const [entryLabel, setEntryLabel] = useState("");
  const [entryBody, setEntryBody] = useState("");
  const [editingEntryId, setEditingEntryId] = useState("");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [proposalLabel, setProposalLabel] = useState("Interview preparation");
  const [proposalSummary, setProposalSummary] = useState("");
  const [proposalSection, setProposalSection] = useState("");
  const selected = records.find((record) => record.packageId === selectedId) ?? records[0];
  const selectedLoop = loops.find((loop) => loop.loopId === (selected?.assignment?.loopId ?? loopId));

  const load = useCallback(async (preferredId?: string) => {
    const response = await fetch("/api/interview-packages", { cache: "no-store" });
    const body = await response.json() as { packages?: PackageRecord[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? "Interview Packages are unavailable.");
    const next = body.packages ?? [];
    const nextId = preferredId ?? selectedIdRef.current ?? next[0]?.packageId ?? "";
    const nextRecord = next.find((record) => record.packageId === nextId) ?? next[0];
    setRecords(next);
    selectedIdRef.current = nextRecord?.packageId ?? "";
    setSelectedId(selectedIdRef.current);
    setLoopId(nextRecord?.assignment?.loopId ?? initialLoopId ?? "");
    setStageId(nextRecord?.assignment?.stageId ?? "");
  }, [initialLoopId]);

  const selectRecord = (record: PackageRecord) => {
    selectedIdRef.current = record.packageId;
    setSelectedId(record.packageId);
    setLoopId(record.assignment?.loopId ?? "");
    setStageId(record.assignment?.stageId ?? "");
    setSelectedSourceIds([]);
    setEditingEntryId("");
  };

  useEffect(() => {
    const release = acquireDocumentScrollLock();
    const frame = requestAnimationFrame(() => {
      dialogRef.current?.focus();
      void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Interview Packages are unavailable.")).finally(() => setLoading(false));
    });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown);
      release();
      opener.focus({ preventScroll: true });
    };
  }, [load, onClose, opener]);

  const run = useCallback(async (label: string, work: () => Promise<Record<string, unknown>>, preferredId?: string) => {
    setBusy(label); setError(""); setNotice("");
    try {
      const receipt = await work();
      const packageId = preferredId ?? (typeof receipt.packageId === "string" ? receipt.packageId : selected?.packageId);
      await load(packageId);
      setNotice(`${label} saved. Revision ${String(receipt.packageRevision ?? "unchanged")}.`);
      return receipt;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${label} failed.`);
      return null;
    } finally {
      setBusy("");
    }
  }, [load, selected]);

  const createPackage = async () => {
    const loop = loops.find((candidate) => candidate.loopId === newLoopId);
    const interviewAt = interviewLocal ? new Date(interviewLocal).getTime() : undefined;
    const receipt = await run("Package creation", () => packageCommand("create", {
      schemaVersion: 1,
      operationId: operationId("package_create"),
      ...(interviewAt ? { interviewAt, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } : {}),
      ...(loop ? { assignment: { loopId: loop.loopId, ...(newStageId ? { stageId: newStageId } : {}), expectedLoopRevision: loop.revision, expectedRoleBriefRevision: loop.roleBriefRevision } } : {}),
      consentAffirmed: consent,
    }));
    if (receipt) { setConsent(false); setInterviewLocal(""); }
  };

  const uploadBytes = async (source: Pick<PackageSource, "sourceId" | "kind" | "label" | "mediaType" | "sizeBytes">, file: File, uploadedBytes = 0) => {
    if (!selected) return;
    if (file.size !== source.sizeBytes || sourceKind(file) !== source.kind || mediaTypeForFile(file) !== source.mediaType) {
      throw new Error(`Choose the original ${source.label} file with the same type and exact ${formatBytes(source.sizeBytes)} byte size.`);
    }
    if (uploadedBytes < 0 || uploadedBytes > file.size || (uploadedBytes !== file.size && uploadedBytes % PART_BYTES !== 0)) {
      throw new Error("The saved upload checkpoint is not a resumable 5 MB boundary. Cancel this upload and add the source again.");
    }
    const partCount = Math.ceil(file.size / PART_BYTES);
    const firstPartIndex = Math.floor(uploadedBytes / PART_BYTES);
    for (let index = firstPartIndex; index < partCount; index += 1) {
      setBusy(`Uploading ${source.kind} · part ${index + 1}/${partCount}`);
      const chunk = file.slice(index * PART_BYTES, Math.min(file.size, (index + 1) * PART_BYTES));
      const response = await fetch(`/api/interview-packages/${encodeURIComponent(selected.packageId)}/sources/${encodeURIComponent(source.sourceId)}`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream", "idempotency-key": `${source.sourceId}_part_${index + 1}`, "x-part-number": String(index + 1) },
        body: chunk,
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Upload part ${index + 1} failed.`);
    }
    await packageCommand("complete_source", { schemaVersion: 1, operationId: `${source.sourceId}_complete`, packageId: selected.packageId, sourceId: source.sourceId });
  };

  const uploadFile = async (file: File) => {
    if (!selected) return;
    const kind = sourceKind(file);
    const mediaType = mediaTypeForFile(file, kind);
    setBusy(`Uploading ${kind}`); setError(""); setNotice("");
    try {
      const declared = await packageCommand("declare_source", {
        schemaVersion: 1,
        operationId: operationId("source_declare"),
        packageId: selected.packageId,
        expectedRevision: selected.revision,
        kind,
        label: file.name,
        mediaType,
        sizeBytes: file.size,
      });
      const sourceId = String(declared.sourceId);
      await uploadBytes({ sourceId, kind, label: file.name, mediaType, sizeBytes: file.size }, file);
      await load(selected.packageId);
      setNotice(`${file.name} passed checksum, signature, and private R2 readback.`);
    } catch (cause) {
      await load(selected.packageId).catch(() => undefined);
      setError(cause instanceof Error ? cause.message : "The file upload failed. Reselect the same file to resume or retry.");
    } finally {
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const resumeUpload = async (source: PackageSource, file: File) => {
    if (!selected) return;
    const upload = selected.uploads.find((candidate) => candidate.sourceId === source.sourceId && candidate.status === "open");
    setBusy(`Resuming ${source.kind}`); setError(""); setNotice("");
    try {
      if (!upload) throw new Error("This upload session is no longer open. Cancel it and add the source again.");
      await uploadBytes(source, file, upload.uploadedBytes);
      await load(selected.packageId);
      setNotice(`${source.label} resumed at ${formatBytes(upload.uploadedBytes)} and passed private storage verification.`);
    } catch (cause) {
      await load(selected.packageId).catch(() => undefined);
      setError(cause instanceof Error ? cause.message : "The upload could not be resumed.");
    } finally {
      setBusy("");
    }
  };

  const cancelUpload = async (source: PackageSource) => {
    if (!selected) return;
    await run("Upload cancellation", () => packageCommand("cancel_upload", {
      schemaVersion: 1,
      operationId: operationId("upload_cancel"),
      packageId: selected.packageId,
      sourceId: source.sourceId,
    }));
  };

  const saveEntry = async () => {
    if (!selected) return;
    const entry = entryKind === "note"
      ? { kind: "note", label: entryLabel, body: entryBody }
      : { kind: "link", label: entryLabel, url: entryBody };
    const current = selected.entries.find((candidate) => candidate.entryId === editingEntryId);
    const receipt = await run(current ? "Entry revision" : "Package entry", () => packageCommand(current ? "revise_entry" : "add_entry", {
      schemaVersion: 1,
      operationId: operationId(current ? "entry_revise" : "entry_add"),
      packageId: selected.packageId,
      expectedRevision: selected.revision,
      ...(current ? { entryId: current.entryId, expectedEntryRevision: current.revision } : {}),
      entry,
    }));
    if (receipt) { setEntryLabel(""); setEntryBody(""); setEditingEntryId(""); }
  };

  const editEntry = (entry: PackageEntry) => {
    setEditingEntryId(entry.entryId);
    setEntryKind(entry.kind);
    setEntryLabel(entry.snapshot.label);
    setEntryBody(entry.snapshot.kind === "note" ? entry.snapshot.body : entry.snapshot.url);
  };

  const assign = async () => {
    if (!selected) return;
    const loop = loops.find((candidate) => candidate.loopId === loopId);
    await run("Assignment", () => packageCommand("assign", {
      schemaVersion: 1, operationId: operationId("package_assign"), packageId: selected.packageId, expectedRevision: selected.revision,
      assignment: loop ? { loopId: loop.loopId, ...(stageId ? { stageId } : {}), expectedLoopRevision: loop.revision, expectedRoleBriefRevision: loop.roleBriefRevision } : null,
    }));
  };

  const finalize = async () => {
    if (!selected) return;
    const includedSourceIds = selected.sources.filter((source) => source.state === "ready").map((source) => source.sourceId);
    const includedEntryIds = selected.entries.map((entry) => entry.entryId);
    const finalizeSubset = selected.sources.some((source) => source.state !== "ready");
    await run("Package finalization", () => packageCommand("finalize", {
      schemaVersion: 1, operationId: operationId("package_finalize"), packageId: selected.packageId, expectedRevision: selected.revision,
      includedSourceIds, includedEntryIds, finalizeSubset,
    }));
  };

  const linkMaterial = async (materialValue: string) => {
    if (!selected) return;
    const material = selectedLoop?.materials.find((candidate) => `${candidate.materialId}@${candidate.revision}` === materialValue);
    await run(material ? "Material link" : "Material unlink", () => packageCommand("link_material", {
      schemaVersion: 1, operationId: operationId("material_link"), packageId: selected.packageId, expectedRevision: selected.revision,
      materialId: material?.materialId ?? null, materialRevision: material?.revision ?? null,
    }));
  };

  const prepareProposal = async () => {
    if (!selected || !selectedLoop || !selectedSourceIds.length) return;
    const currentMaterial = selectedLoop.materials.find((material) => (material.stageId ?? "") === (selected.assignment?.stageId ?? ""));
    const materialId = currentMaterial?.materialId ?? operationId("material");
    await run("Material proposal", () => packageCommand("prepare_material_proposal", {
      schemaVersion: 1,
      operationId: operationId("material_proposal"),
      packageId: selected.packageId,
      expectedRevision: selected.revision,
      baseMaterialRevision: currentMaterial?.revision ?? null,
      baseLoopRevision: selectedLoop.revision,
      baseRoleBriefRevision: selectedLoop.roleBriefRevision,
      selectedSourceIds,
      proposedMaterial: {
        materialId,
        loopId: selectedLoop.loopId,
        ...(selected.assignment?.stageId ? { stageId: selected.assignment.stageId } : {}),
        kind: "interview_prep",
        state: "active",
        label: proposalLabel,
        ...(proposalSummary.trim() ? { summary: proposalSummary.trim() } : {}),
        sections: [{ sectionId: operationId("section"), title: "Owner-reviewed interview material", body: proposalSection, bullets: [] }],
        provenance: { kind: "owner_authorized_synthesis", roleBriefRevision: selectedLoop.roleBriefRevision, activityIds: [], sourceLabel: "Selected Interview Package sources", preparedAt: Date.now() },
      },
    }));
  };

  const readyRefs = useMemo(() => selected ? [
    ...selected.sources.filter((source) => source.state === "ready").map((source) => ({ id: source.sourceId, label: source.label, detail: source.kind })),
    ...selected.entries.map((entry) => ({ id: entry.entryId, label: entry.snapshot.label, detail: entry.kind })),
  ] : [], [selected]);

  if (typeof document === "undefined") return null;
  return createPortal(<div className="package-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="package-dialog" role="dialog" aria-modal="true" aria-labelledby="package-dialog-title" tabIndex={-1} ref={dialogRef}>
      <header className="package-dialog-header"><div><span>PRIVATE INTERVIEW SOURCES</span><h2 id="package-dialog-title">Interview Packages</h2><p>Recordings, supplied transcripts, documents, images, links, and notes stay separate from practice and AI.</p></div><button type="button" onClick={onClose} aria-label="Close Interview Packages">×</button></header>
      {error ? <div className="package-message error" role="alert"><strong>Could not complete that action.</strong><span>{error}</span></div> : null}
      {notice ? <div className="package-message" role="status">{notice}</div> : null}
      {busy ? <div className="package-busy" role="status"><span />{busy}</div> : null}
      <div className="package-dialog-body">
        <aside className="package-register"><header><strong>Event register</strong><span>{records.length} saved</span></header>{loading ? <p>Reading private packages…</p> : records.map((record) => <button type="button" className={record.packageId === selected?.packageId ? "active" : ""} onClick={() => selectRecord(record)} key={record.packageId}><span>{packageTitle(record, loops)}</span><small>{record.status} · {record.sources.length + record.entries.length} sources</small></button>)}<section><strong>New package</strong><label>Loop or inbox<select value={newLoopId} onChange={(event) => { setNewLoopId(event.target.value); setNewStageId(""); }}><option value="">Unassigned inbox</option>{loops.map((loop) => <option value={loop.loopId} key={loop.loopId}>{loop.company} · {loop.roleTitle}</option>)}</select></label>{newLoopId ? <label>Round<select value={newStageId} onChange={(event) => setNewStageId(event.target.value)}><option value="">Loop-wide</option>{loops.find((loop) => loop.loopId === newLoopId)?.stages.map((stage) => <option value={stage.stageId} key={stage.stageId}>{stage.label}</option>)}</select></label> : null}<label>Interview time<input type="datetime-local" value={interviewLocal} onChange={(event) => setInterviewLocal(event.target.value)} /></label><label className="package-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> I affirm I am permitted to store and process these sources.</label><button type="button" disabled={!consent || Boolean(busy)} onClick={() => void createPackage()}>Create package</button></section></aside>
        <main className="package-sheet">{selected ? <>
          <section className="package-event"><div><span>EVENT</span><h3>{packageTitle(selected, loops)}</h3><p>{selected.interviewAt ? new Date(selected.interviewAt).toLocaleString() : "Interview time not recorded"} · Revision {selected.revision}</p></div><i className={`package-state ${selected.status}`}>{selected.status}</i><div className="package-assignment"><select value={loopId} onChange={(event) => { setLoopId(event.target.value); setStageId(""); }}><option value="">Unassigned inbox</option>{loops.map((loop) => <option value={loop.loopId} key={loop.loopId}>{loop.company} · {loop.roleTitle}</option>)}</select>{loopId ? <select value={stageId} onChange={(event) => setStageId(event.target.value)}><option value="">Loop-wide</option>{loops.find((loop) => loop.loopId === loopId)?.stages.map((stage) => <option value={stage.stageId} key={stage.stageId}>{stage.label}</option>)}</select> : null}<button type="button" onClick={() => void assign()} disabled={Boolean(busy)}>Save assignment</button></div></section>
          <section className="package-sources">
            <header><div><span>SOURCES</span><h3>Private source register</h3></div><label className="package-file-action"><input ref={fileRef} type="file" accept="audio/mpeg,audio/mp4,audio/wav,audio/webm,audio/ogg,text/plain,text/vtt,.srt,application/pdf,text/markdown,image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file); }} />Add file</label></header>
            <div className="package-source-list">
              {selected.sources.filter((source) => source.state !== "deleted").map((source) => {
                const upload = selected.uploads.find((candidate) => candidate.sourceId === source.sourceId && candidate.status === "open");
                return <article key={source.sourceId}>
                  <div className={`package-source-mark ${source.kind}`} aria-hidden="true">{source.kind.slice(0, 1).toUpperCase()}</div>
                  <div><strong>{source.label}</strong><span>{source.kind} · {formatBytes(source.sizeBytes)} · {source.state}</span>{upload ? <small>{formatBytes(upload.uploadedBytes)} uploaded · expires {new Date(upload.expiresAt).toLocaleString()}</small> : null}{source.contentHash ? <code title={source.contentHash}>SHA-256 {source.contentHash.slice(0, 12)}…</code> : null}{source.rejectionCode ? <small>{source.rejectionCode}</small> : null}</div>
                  {source.state === "ready" ? <a href={`/api/interview-packages/sources/${encodeURIComponent(source.sourceId)}/content`} target="_blank" rel="noreferrer">{source.kind === "audio" ? "Play / download" : "Open source"}</a> : null}
                  {source.state === "uploading" ? <div className="package-source-actions"><label className="package-file-action secondary"><input type="file" accept={source.mediaType} onChange={(event) => { const file = event.target.files?.[0]; if (file) void resumeUpload(source, file); event.currentTarget.value = ""; }} />Resume upload</label><button type="button" className="package-inline-danger" disabled={Boolean(busy)} onClick={() => void cancelUpload(source)}>Cancel upload</button></div> : null}
                  {source.kind === "audio" && source.state === "ready" ? <audio controls preload="metadata" src={`/api/interview-packages/sources/${encodeURIComponent(source.sourceId)}/content`} /> : null}
                  {source.transcriptRepresentation ? <details><summary>{source.transcriptRepresentation.cueCount} transcript blocks</summary><div className="package-transcript">{source.transcriptRepresentation.cues.map((cue) => <p key={cue.sequence}>{cue.timing ? <time>{cue.timing}</time> : null}{cue.text}</p>)}</div></details> : null}
                </article>;
              })}
              {selected.entries.map((entry) => <article key={entry.entryId}><div className={`package-source-mark ${entry.kind}`} aria-hidden="true">{entry.kind === "note" ? "N" : "↗"}</div><div><strong>{entry.snapshot.label}</strong><span>{entry.kind} · revision {entry.revision}</span>{entry.snapshot.kind === "note" ? <p>{entry.snapshot.body}</p> : <a href={entry.snapshot.url} target="_blank" rel="noreferrer">{entry.snapshot.url}</a>}</div><button type="button" className="package-revise-entry" disabled={Boolean(busy)} onClick={() => editEntry(entry)}>Revise {entry.kind}</button></article>)}
              {selected.sources.filter((source) => source.state !== "deleted").length + selected.entries.length === 0 ? <p className="package-empty-row">Add any supported source. A recording and transcript are optional, not required as a pair.</p> : null}
            </div>
            <div className="package-entry-compose"><select value={entryKind} disabled={Boolean(editingEntryId)} onChange={(event) => setEntryKind(event.target.value as "note" | "link")}><option value="note">Owner note</option><option value="link">External HTTPS link</option></select><input aria-label="Entry label" placeholder="Label" value={entryLabel} onChange={(event) => setEntryLabel(event.target.value)} /><textarea aria-label={entryKind === "note" ? "Owner note" : "HTTPS URL"} placeholder={entryKind === "note" ? "Your factual debrief or related note" : "https://…"} value={entryBody} onChange={(event) => setEntryBody(event.target.value)} /><div className="package-entry-actions"><button type="button" disabled={!entryLabel.trim() || !entryBody.trim() || Boolean(busy)} onClick={() => void saveEntry()}>{editingEntryId ? "Save revision" : `Save ${entryKind}`}</button>{editingEntryId ? <button type="button" className="secondary" onClick={() => { setEditingEntryId(""); setEntryLabel(""); setEntryBody(""); }}>Cancel edit</button> : null}</div></div>
          </section>
          <section className="package-material"><header><span>RELATED MATERIAL · SEPARATE AUTHORITY</span><h3>Choose what this package changes</h3><p>Upload never edits Interview Material. Link an exact revision, prepare an owner-authored proposal from checked sources, or keep no relationship.</p></header><label>Exact material link<select value={selected.materialLink?.state === "linked" ? `${selected.materialLink.materialId}@${selected.materialLink.materialRevision}` : ""} onChange={(event) => void linkMaterial(event.target.value)}><option value="">No material relationship</option>{selectedLoop?.materials.map((material) => <option value={`${material.materialId}@${material.revision}`} key={`${material.materialId}@${material.revision}`}>{material.label} · revision {material.revision}</option>)}</select></label><fieldset><legend>Sources allowed into a proposal</legend>{readyRefs.map((source) => <label key={source.id}><input type="checkbox" checked={selectedSourceIds.includes(source.id)} onChange={(event) => setSelectedSourceIds((current) => event.target.checked ? [...current, source.id] : current.filter((id) => id !== source.id))} /> <span>{source.label}<small>{source.detail}</small></span></label>)}</fieldset><div className="package-proposal-draft"><input aria-label="Material label" value={proposalLabel} onChange={(event) => setProposalLabel(event.target.value)} /><textarea aria-label="Material summary" placeholder="Optional summary" value={proposalSummary} onChange={(event) => setProposalSummary(event.target.value)} /><textarea aria-label="Owner-authored material section" placeholder="Write the material you want to review. Interview Arc does not synthesize it with AI." value={proposalSection} onChange={(event) => setProposalSection(event.target.value)} /><button type="button" disabled={!selectedLoop || !selectedSourceIds.length || !proposalLabel.trim() || !proposalSection.trim() || Boolean(busy)} onClick={() => void prepareProposal()}>Prepare reviewed revision</button></div>{selected.proposals.map((proposal) => <article className="package-proposal" key={proposal.proposalId}><div><strong>{proposal.proposedSnapshot.label}</strong><span>{proposal.status} · base {proposal.baseMaterialRevision ? `revision ${proposal.baseMaterialRevision}` : "new material"}</span></div>{proposal.status === "proposed" ? <button type="button" disabled={Boolean(busy)} onClick={() => void run("Material confirmation", () => packageCommand("confirm_material_proposal", { schemaVersion: 1, operationId: operationId("proposal_confirm"), packageId: selected.packageId, expectedRevision: selected.revision, proposalId: proposal.proposalId }))}>Confirm exact proposal</button> : <small>{proposal.confirmedMaterialRevision ? `Material revision ${proposal.confirmedMaterialRevision}` : proposal.status}</small>}</article>)}</section>
          <section className="package-review"><div><span>REVIEW & RETENTION</span><h3>Finish without hiding partial work</h3><p>{selected.sources.filter((source) => source.state === "ready").length} ready files · {selected.entries.length} saved entries. Ready sources are retained until you explicitly delete the package.</p></div><div><button type="button" onClick={() => void finalize()} disabled={Boolean(busy) || !readyRefs.length}>Finalize {selected.sources.some((source) => source.state !== "ready") ? "valid subset" : "package"}</button><a href={`/api/interview-packages?packageId=${encodeURIComponent(selected.packageId)}&format=export`}>Export manifest</a><button type="button" className="danger" disabled={Boolean(busy)} onClick={() => { if (window.confirm("Delete this package and all private source bytes? Linked Interview Material remains and the receipt records its provenance impact.")) void run("Package deletion", () => packageCommand("delete", { schemaVersion: 1, operationId: operationId("package_delete"), packageId: selected.packageId, expectedRevision: selected.revision, confirmation: "delete_interview_package" })); }}>Delete package</button></div></section>
        </> : <section className="package-zero"><span>UNASSIGNED INBOX</span><h3>Create the first Interview Package.</h3><p>Choose a Loop and Round now, or leave the destination visibly unassigned. The system will never guess it.</p></section>}</main>
      </div>
    </div>
  </div>, document.body);
}
