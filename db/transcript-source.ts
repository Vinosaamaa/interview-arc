export const TYPED_TRANSCRIPT_SOURCES = ["codex", "chatgpt"] as const;
export const TRANSCRIPT_SOURCES = [...TYPED_TRANSCRIPT_SOURCES, "dictation", "audio_transcript"] as const;
export type TranscriptSource = typeof TRANSCRIPT_SOURCES[number];
export type TypedTranscriptSource = typeof TYPED_TRANSCRIPT_SOURCES[number];
// Native append callers cannot select the connected ChatGPT identity.
export type NativeTranscriptSource = Exclude<TranscriptSource, "chatgpt">;
export const isTypedTranscriptSource = (source: string): source is TypedTranscriptSource =>
  TYPED_TRANSCRIPT_SOURCES.some((candidate) => candidate === source);
