import type { InterviewPackageSourceKind } from "./interview-package-policy.ts";

export class InterviewPackageContentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "InterviewPackageContentError";
    this.code = code;
  }
}

export async function interviewPackageObjectLocator(ownerId: string, packageId: string, sourceId: string) {
  const bytes = new TextEncoder().encode(`${ownerId}\u0000${packageId}\u0000${sourceId}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const opaque = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `interview-packages/${opaque}/asset`;
}

function bytesPrefix(bytes: Uint8Array, prefix: number[]) {
  return prefix.every((value, index) => bytes[index] === value);
}

export function interviewPackageSignatureMatches(kind: InterviewPackageSourceKind, mediaType: string, prefix: Uint8Array, text?: string) {
  if (kind === "audio") {
    if (mediaType === "audio/mpeg") return bytesPrefix(prefix, [0x49, 0x44, 0x33]) || (prefix[0] === 0xff && (prefix[1] & 0xe0) === 0xe0);
    if (mediaType === "audio/wav") return new TextDecoder().decode(prefix.slice(0, 4)) === "RIFF" && new TextDecoder().decode(prefix.slice(8, 12)) === "WAVE";
    if (mediaType === "audio/mp4") return new TextDecoder().decode(prefix.slice(4, 8)) === "ftyp";
    if (mediaType === "audio/webm") return bytesPrefix(prefix, [0x1a, 0x45, 0xdf, 0xa3]);
    if (mediaType === "audio/ogg") return new TextDecoder().decode(prefix.slice(0, 4)) === "OggS";
  }
  if (kind === "image") {
    if (mediaType === "image/png") return bytesPrefix(prefix, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (mediaType === "image/jpeg") return bytesPrefix(prefix, [0xff, 0xd8, 0xff]);
    if (mediaType === "image/webp") return new TextDecoder().decode(prefix.slice(0, 4)) === "RIFF" && new TextDecoder().decode(prefix.slice(8, 12)) === "WEBP";
  }
  if (kind === "document" && mediaType === "application/pdf") return new TextDecoder().decode(prefix.slice(0, 5)) === "%PDF-";
  if ((kind === "document" || kind === "transcript") && text !== undefined) {
    const sample = text.slice(0, 2_000).trimStart().toLowerCase();
    return !sample.startsWith("<!doctype html") && !sample.startsWith("<html") && !sample.startsWith("<svg") && !sample.includes("<script");
  }
  return false;
}

export function createSuppliedInterviewTranscriptParser(mediaType: string) {
  const format = mediaType === "text/vtt" ? "vtt" : mediaType === "application/x-subrip" ? "srt" : "plain";
  const cues: Array<{ sequence: number; timing?: string; text: string }> = [];
  let timing: string | undefined;
  let content: string[] = [];
  let pending = "";
  let firstLine = true;
  const flush = () => {
    const value = content.join("\n").trim();
    if (value) cues.push({ sequence: cues.length + 1, ...(timing ? { timing } : {}), text: value });
    timing = undefined;
    content = [];
  };
  const line = (rawValue: string) => {
    const raw = firstLine ? rawValue.replace(/^\uFEFF/, "") : rawValue;
    const value = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (firstLine) {
      firstLine = false;
      if (format === "vtt" && value.trim() !== "WEBVTT") {
        throw new InterviewPackageContentError("interview_package_signature_mismatch", "The supplied transcript does not match its declared format.");
      }
    }
    const line = value.trimEnd();
    if (!line.trim()) { flush(); return; }
    if (line.includes("-->")) { timing = line.trim(); return; }
    if ((format === "vtt" && line.trim() === "WEBVTT") || (format === "srt" && /^\d+$/.test(line.trim()) && content.length === 0)) return;
    content.push(line);
  };
  return {
    push(chunk: string) {
      pending += chunk;
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        line(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
      }
    },
    finish() {
      if (pending || firstLine) line(pending);
      pending = "";
      flush();
      return { schemaVersion: 1 as const, format, cueCount: cues.length, cues };
    },
  };
}

export function parseSuppliedInterviewTranscript(mediaType: string, text: string) {
  const parser = createSuppliedInterviewTranscriptParser(mediaType);
  parser.push(text);
  return parser.finish();
}
