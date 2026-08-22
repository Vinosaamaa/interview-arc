"use client";
/* eslint-disable @next/next/no-img-element -- authenticated private and local object URLs bypass the public image optimizer */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

const PART_BYTES = 5 * 1024 * 1024;

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

type PackageRecord = {
  packageId: string;
  revision: number;
  status: string;
  assignment: { loopId: string; stageId?: string } | null;
  sources: PackageSource[];
  uploads: Array<{ sourceId: string; status: string; expectedBytes: number; uploadedBytes: number; expiresAt: number }>;
};

type ResourceZone = "recording" | "resources";

function operationId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function sourceKind(file: File, zone: ResourceZone): PackageSource["kind"] {
  if (zone === "recording") return file.type.startsWith("audio/") ? "audio" : "transcript";
  if (file.type.startsWith("image/")) return "image";
  return "document";
}

function mediaTypeForFile(file: File, kind: PackageSource["kind"]) {
  if (/\.vtt$/i.test(file.name)) return "text/vtt";
  if (/\.srt$/i.test(file.name)) return "application/x-subrip";
  if (/\.md$/i.test(file.name)) return "text/markdown";
  if (/\.pdf$/i.test(file.name)) return "application/pdf";
  if (file.type) return file.type;
  return kind === "transcript" ? "text/plain" : "application/octet-stream";
}

function accepted(file: File, zone: ResourceZone) {
  const mediaType = mediaTypeForFile(file, sourceKind(file, zone));
  if (zone === "recording") {
    return file.type.startsWith("audio/") || ["text/plain", "text/vtt", "application/x-subrip", "text/markdown"].includes(mediaType) || /\.(txt|md|srt|vtt)$/i.test(file.name);
  }
  return ["application/pdf", "text/plain", "text/markdown", "image/png", "image/jpeg", "image/webp"].includes(mediaType) || /\.(pdf|txt|md|png|jpe?g|webp)$/i.test(file.name);
}

async function packageCommand(action: string, payload: Record<string, unknown>) {
  const operation = String(payload.operationId ?? "");
  const response = await fetch("/api/interview-packages", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": operation },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String(body.error ?? "The Round resource command failed."));
  return body;
}

function TranscriptPreview({ source }: { source: PackageSource }) {
  const transcript = source.transcriptRepresentation;
  if (!transcript) return <a href={`/api/interview-packages/sources/${encodeURIComponent(source.sourceId)}/content`} target="_blank" rel="noreferrer">Read transcript</a>;
  return <details className="round-transcript-preview"><summary>{transcript.cueCount} transcript blocks</summary><div>{transcript.cues.map((cue) => <p key={cue.sequence}>{cue.timing ? <time>{cue.timing}</time> : null}{cue.text}</p>)}</div></details>;
}

function SourcePreview({ source }: { source: PackageSource }) {
  const content = `/api/interview-packages/sources/${encodeURIComponent(source.sourceId)}/content`;
  if (source.state !== "ready") return <p className="round-source-state">{source.state === "uploading" ? "Upload interrupted. Reselect the same file here to resume from the saved checkpoint." : source.rejectionCode ?? source.state}</p>;
  if (source.kind === "audio") return <audio controls preload="metadata" src={content} />;
  if (source.kind === "transcript") return <TranscriptPreview source={source} />;
  if (source.kind === "image") return <a className="round-image-preview" href={content} target="_blank" rel="noreferrer"><img src={content} alt={source.label} /></a>;
  if (source.mediaType === "application/pdf" || source.mediaType.startsWith("text/")) return <iframe src={content} title={`Preview ${source.label}`} loading="lazy" />;
  return <a href={content} target="_blank" rel="noreferrer">Open or download</a>;
}

function ResourceShelf({
  title,
  description,
  zone,
  sources,
  disabled,
  onFile,
  onResume,
}: {
  title: string;
  description: string;
  zone: ResourceZone;
  sources: PackageSource[];
  disabled: boolean;
  onFile: (file: File, zone: ResourceZone) => void;
  onResume: (source: PackageSource, file: File, zone: ResourceZone) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const accept = zone === "recording"
    ? "audio/mpeg,audio/mp4,audio/wav,audio/webm,audio/ogg,text/plain,text/vtt,.srt,.md"
    : "application/pdf,text/plain,text/markdown,image/png,image/jpeg,image/webp";
  return <section className={`round-resource-shelf ${zone}`} aria-labelledby={headingId}>
    <header><div><span>{zone === "recording" ? "PRIVATE INTERVIEW EVIDENCE" : "RELATED MATERIAL"}</span><h3 id={headingId}>{title}</h3><p>{description}</p></div><button type="button" onClick={() => inputRef.current?.click()} disabled={disabled}>Choose file</button></header>
    <label className={`round-resource-drop ${disabled ? "disabled" : ""}`} onDragOver={(event) => { event.preventDefault(); if (!disabled) event.dataTransfer.dropEffect = "copy"; }} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file && !disabled) onFile(file, zone); }}>
      <input ref={inputRef} type="file" accept={accept} disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file, zone); event.currentTarget.value = ""; }} />
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 15v4h14v-4" /></svg>
      <strong>Drop a file here</strong><span>{zone === "recording" ? "Audio, TXT, Markdown, SRT, or VTT" : "PDF, image, TXT, or Markdown"}</span>
    </label>
    <div className="round-source-grid">{sources.map((source) => <article key={source.sourceId}><header><div><strong>{source.label}</strong><span>{source.kind} · {formatBytes(source.sizeBytes)}</span></div>{source.state === "ready" ? <a href={`/api/interview-packages/sources/${encodeURIComponent(source.sourceId)}/content`} target="_blank" rel="noreferrer">Open</a> : source.state === "uploading" ? <label className="round-source-resume"><input type="file" accept={source.mediaType} disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) onResume(source, file, zone); event.currentTarget.value = ""; }} />Resume</label> : null}</header><SourcePreview source={source} /></article>)}{!sources.length ? <p>No files added to this section yet.</p> : null}</div>
  </section>;
}

export default function RoundResources({
  loopId,
  stageId,
  loopRevision,
  roleBriefRevision,
  enabled,
}: {
  loopId: string;
  stageId: string;
  loopRevision: number;
  roleBriefRevision: number;
  enabled: boolean;
}) {
  const [record, setRecord] = useState<PackageRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingPreview, setPendingPreview] = useState<{ name: string; url: string; type: string } | null>(null);

  const load = useCallback(async (packageId?: string) => {
    const response = await fetch(packageId ? `/api/interview-packages?packageId=${encodeURIComponent(packageId)}` : `/api/interview-packages?loopId=${encodeURIComponent(loopId)}&stageId=${encodeURIComponent(stageId)}`, { cache: "no-store" });
    const body = await response.json() as { packages?: PackageRecord[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? "Round resources are unavailable.");
    const exact = (body.packages ?? []).find((candidate) => candidate.assignment?.loopId === loopId && candidate.assignment.stageId === stageId && candidate.status !== "deleted") ?? null;
    setRecord(exact);
    setLoaded(true);
    return exact;
  }, [loopId, stageId]);

  useEffect(() => {
    if (!enabled || loaded) return;
    const frame = window.requestAnimationFrame(() => {
      void load().catch((cause) => { setError(cause instanceof Error ? cause.message : "Round resources are unavailable."); setLoaded(true); });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [enabled, load, loaded]);

  useEffect(() => () => { if (pendingPreview) URL.revokeObjectURL(pendingPreview.url); }, [pendingPreview]);

  const ensurePackage = useCallback(async () => {
    if (record) return record;
    if (!consent) throw new Error("Affirm permission before storing interview files.");
    const receipt = await packageCommand("create", {
      schemaVersion: 1,
      operationId: operationId("round_package_create"),
      assignment: { loopId, stageId, expectedLoopRevision: loopRevision, expectedRoleBriefRevision: roleBriefRevision },
      consentAffirmed: true,
    });
    const created = await load(String(receipt.packageId));
    if (!created) throw new Error("The new Round package could not be read back.");
    setConsent(false);
    return created;
  }, [consent, load, loopId, loopRevision, record, roleBriefRevision, stageId]);

  const transferSource = useCallback(async ({
    packageId,
    sourceId,
    file,
    firstPartIndex,
    statusLabel,
  }: {
    packageId: string;
    sourceId: string;
    file: File;
    firstPartIndex: number;
    statusLabel: string;
  }) => {
    const partCount = Math.ceil(file.size / PART_BYTES);
    for (let index = firstPartIndex; index < partCount; index += 1) {
      setBusy(`${statusLabel} · ${index + 1}/${partCount}`);
      const chunk = file.slice(index * PART_BYTES, Math.min(file.size, (index + 1) * PART_BYTES));
      const response = await fetch(`/api/interview-packages/${encodeURIComponent(packageId)}/sources/${encodeURIComponent(sourceId)}`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream", "idempotency-key": `${sourceId}_part_${index + 1}`, "x-part-number": String(index + 1) },
        body: chunk,
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Upload part ${index + 1} failed.`);
    }
    await packageCommand("complete_source", { schemaVersion: 1, operationId: `${sourceId}_complete`, packageId, sourceId });
  }, []);

  const uploadFile = useCallback(async (file: File, zone: ResourceZone) => {
    if (!accepted(file, zone)) {
      setError(zone === "recording" ? "Use a supported audio or transcript file." : "Use a PDF, image, TXT, or Markdown file.");
      return;
    }
    const preview = { name: file.name, url: URL.createObjectURL(file), type: file.type };
    setPendingPreview(preview);
    setBusy(`Adding ${file.name}`);
    setError(""); setNotice("");
    let currentPackageId = "";
    try {
      const current = await ensurePackage();
      currentPackageId = current.packageId;
      const kind = sourceKind(file, zone);
      const mediaType = mediaTypeForFile(file, kind);
      const declared = await packageCommand("declare_source", {
        schemaVersion: 1,
        operationId: operationId("round_source_declare"),
        packageId: current.packageId,
        expectedRevision: current.revision,
        kind,
        label: file.name,
        mediaType,
        sizeBytes: file.size,
      });
      const sourceId = String(declared.sourceId);
      await transferSource({ packageId: current.packageId, sourceId, file, firstPartIndex: 0, statusLabel: `Uploading ${file.name}` });
      await load(current.packageId);
      setNotice(`${file.name} is stored privately and ready in this Round.`);
      setPendingPreview(null);
    } catch (cause) {
      if (currentPackageId) await load(currentPackageId).catch(() => undefined);
      setError(cause instanceof Error ? cause.message : "The file could not be added.");
    } finally {
      setBusy("");
    }
  }, [ensurePackage, load, transferSource]);

  const resumeFile = useCallback(async (source: PackageSource, file: File, zone: ResourceZone) => {
    if (!record) return;
    const upload = record.uploads.find((candidate) => candidate.sourceId === source.sourceId && candidate.status === "open");
    const kind = sourceKind(file, zone);
    const mediaType = mediaTypeForFile(file, kind);
    if (!upload || file.size !== source.sizeBytes || kind !== source.kind || mediaType !== source.mediaType) {
      setError(`Reselect the original ${source.label} with the same type and exact ${formatBytes(source.sizeBytes)} size.`);
      return;
    }
    if (upload.uploadedBytes < 0 || upload.uploadedBytes > file.size || (upload.uploadedBytes !== file.size && upload.uploadedBytes % PART_BYTES !== 0)) {
      setError("The saved upload checkpoint is not a resumable 5 MB boundary.");
      return;
    }
    setBusy(`Resuming ${source.label}`); setError(""); setNotice("");
    try {
      const firstPartIndex = Math.floor(upload.uploadedBytes / PART_BYTES);
      await transferSource({ packageId: record.packageId, sourceId: source.sourceId, file, firstPartIndex, statusLabel: `Resuming ${source.label}` });
      await load(record.packageId);
      setNotice(`${source.label} resumed and passed private storage verification.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The upload could not be resumed.");
    } finally { setBusy(""); }
  }, [load, record, transferSource]);

  const recordingSources = useMemo(() => record?.sources.filter((source) => source.state !== "deleted" && (source.kind === "audio" || source.kind === "transcript")) ?? [], [record]);
  const resourceSources = useMemo(() => record?.sources.filter((source) => source.state !== "deleted" && (source.kind === "document" || source.kind === "image")) ?? [], [record]);
  if (!enabled) return null;
  return <section className="round-resources" aria-label="Round resources">
    <header className="round-resources-intro"><div><span>ROUND SOURCES</span><h3>Evidence and materials</h3><p>Files stay assigned to this exact Round. Upload does not turn them into practice or invoke AI.</p></div>{record ? <small>Private package · revision {record.revision}</small> : null}</header>
    {!record ? <label className="round-resource-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> <span><strong>Permission to store</strong>I affirm I am permitted to store and process the interview sources I add.</span></label> : null}
    {busy ? <p className="round-resource-message busy" role="status">{busy}</p> : null}
    {error ? <p className="round-resource-message error" role="alert">{error}</p> : null}
    {notice ? <p className="round-resource-message" role="status">{notice}</p> : null}
    {pendingPreview ? <article className="round-pending-preview"><div><strong>{pendingPreview.name}</strong><span>Selected locally · private upload in progress</span></div>{pendingPreview.type.startsWith("audio/") ? <audio controls src={pendingPreview.url} /> : pendingPreview.type.startsWith("image/") ? <img src={pendingPreview.url} alt={`Local preview of ${pendingPreview.name}`} /> : null}</article> : null}
    <div className="round-resource-columns">
      <ResourceShelf title="Recording & Transcript" description="Keep the interview audio and the transcript you supply together, but as separate files." zone="recording" sources={recordingSources} disabled={Boolean(busy)} onFile={(file, zone) => void uploadFile(file, zone)} onResume={(source, file, zone) => void resumeFile(source, file, zone)} />
      <ResourceShelf title="Resources" description="Add the rubric, notes, diagrams, PDFs, or other related material for this Round." zone="resources" sources={resourceSources} disabled={Boolean(busy)} onFile={(file, zone) => void uploadFile(file, zone)} onResume={(source, file, zone) => void resumeFile(source, file, zone)} />
    </div>
  </section>;
}
