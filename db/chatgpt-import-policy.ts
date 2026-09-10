import { z } from "zod";
import { practiceDateAt } from "../app/practice-time.ts";

export const CHATGPT_IMPORT_MAX_BYTES = 1_000_000;
const key = z.string().min(1).max(160).regex(/^[a-z0-9][a-z0-9._:-]*$/);
const text = z.string().min(1).max(2000);
const strings = z.array(text).max(100);
const keys = z.array(key).max(10000).refine((v) => new Set(v).size === v.length, "Duplicate references");
const timestamp = z.iso.datetime({ offset: true }).nullable();
const timestampBasis = z.enum(["platform_export", "user_reported"]).nullable();
export const chatgptSpecialty = z.enum(["leetcode", "system_design", "behavioral"]);
const outcome = z.enum(["solved", "solved_after_reviewing_approach", "failed"]).nullable();
const event = z.strictObject({
  command: z.enum(["start", "pause", "resume", "finish"]), at: timestamp,
  timestampBasis: z.enum(["exposed_clock", "platform_export", "user_reported"]).nullable(), evidence: text.nullable(),
}).refine((v) => v.at === null ? v.timestampBasis === null : v.timestampBasis !== null && v.evidence !== null, "Timestamp needs its source");
export const chatgptTimingSchema = z.strictObject({
  state: z.enum(["running", "paused", "finished"]), activeMinutes: z.number().min(0).max(10080).nullable(),
  basis: z.enum(["observed_boundaries", "user_estimate", "unknown"]), evidence: text.nullable(),
  events: z.array(event).max(1000),
}).superRefine((v, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (v.basis === "unknown" ? v.activeMinutes !== null : v.activeMinutes === null || !v.evidence) fail("Timing total and evidence must match its basis");
  let state = "unstarted";
  let last: number | null = null;
  let started: number | null = null;
  let milliseconds = 0;
  for (const e of v.events) {
    const at = e.at === null ? null : Date.parse(e.at);
    if (at !== null && last !== null && at < last) fail("Timer events must be chronological");
    if (at !== null) last = at;
    if (e.command === "start" && state === "unstarted" || e.command === "resume" && state === "paused") {
      state = "running"; started = at;
    } else if (e.command === "pause" && state === "running" || e.command === "finish" && (state === "running" || state === "paused")) {
      if (state === "running" && started !== null && at !== null) milliseconds += at - started;
      state = e.command === "pause" ? "paused" : "finished"; started = null;
    } else fail("Invalid timer transition; repeated commands must be omitted");
  }
  if (v.events.length && state !== v.state) fail("Timer state differs from its final event");
  if (v.basis === "observed_boundaries") {
    if (v.events.length < 2 || v.events.some((e) => e.at === null)) fail("Observed timing needs all boundaries");
    if (Math.abs(milliseconds / 60000 - (v.activeMinutes ?? 0)) > 1 / 60) fail("Active minutes must equal closed intervals, excluding pauses");
  }
});
const turn = z.strictObject({
  turnKey: key, sequence: z.number().int().min(1), speaker: z.enum(["user", "assistant"]),
  text: z.string().min(1).max(100000), occurredAt: timestamp, timestampBasis,
}).refine((v) => (v.occurredAt === null) === (v.timestampBasis === null), "Turn timestamp needs its basis");
const source = z.strictObject({
  sourceChatKey: key, kind: z.enum(["text_chat", "voice_transcript", "mixed_chat", "account_export", "pasted_text", "summary_only"]),
  providedRange: text, coverage: z.enum(["complete_provided_source", "partial", "summary_only"]), gaps: strings, turns: z.array(turn).max(10000),
}).superRefine((v, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if ((v.kind === "summary_only") !== (v.coverage === "summary_only")) fail("Summary coverage must be labeled summary only");
  if (v.coverage === "summary_only" && v.turns.length) fail("A summary is not transcript evidence");
  if (v.coverage !== "complete_provided_source" && !v.gaps.length) fail("Incomplete sources must describe gaps");
  if (v.coverage === "complete_provided_source" && !v.turns.length) fail("Complete source needs turns");
  let sequence = 0; let at = 0;
  for (const t of v.turns) {
    if (t.sequence <= sequence) fail("Source turns must retain increasing sequence");
    sequence = t.sequence;
    if (t.occurredAt) { const next = Date.parse(t.occurredAt); if (next < at) fail("Source timestamps must be chronological"); at = next; }
  }
});
const snapshot = z.strictObject({ snapshotId: key, sourceDescription: text, sourceRevision: text.nullable(), dataAsOf: timestamp });
const publicUrl = z.url({ protocol: /^https?$/ }).max(4000).nullable();
const question = z.strictObject({ specialty: chatgptSpecialty, questionId: key.nullable(), title: text, url: publicUrl, prompt: z.string().min(1).max(20000).nullable() });
export const chatgptAttemptSchema = z.strictObject({
  attemptKey: key, snapshotId: key.nullable(), question, practiceDate: z.iso.date().nullable(),
  dateBasis: z.enum(["user_reported", "source_timestamp"]).nullable(), mode: z.enum(["interviewer", "mentor"]),
  kind: z.enum(["attempt", "walkthrough", "discussion"]), userAttempted: z.boolean().nullable(), outcome,
  outcomeEvidenceTurnKeys: keys, sourceChatKeys: keys.refine((v) => v.length > 0), turnKeys: keys,
  timing: chatgptTimingSchema, summary: z.string().max(20000), review: z.string().max(20000), gaps: strings,
}).superRefine((v, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if ((v.practiceDate === null) !== (v.dateBasis === null)) fail("Practice date needs its basis");
  if (v.outcome !== null && (v.question.specialty !== "leetcode" || v.kind !== "attempt" || v.userAttempted !== true || !v.outcomeEvidenceTurnKeys.length)) fail("Coding result requires an actual attempt and evidence");
  if (v.dateBasis === "source_timestamp") {
    const finish = v.timing.events.find((e) => e.command === "finish");
    if (!finish?.at || practiceDateAt(finish.at) !== v.practiceDate) fail("Practice date must match the Pacific finish date");
  }
});
export const chatgptExportSchema = z.strictObject({
  schemaVersion: z.literal(1), kind: z.literal("practice_export"), packetId: key, exportedAt: timestamp,
  timeZone: z.literal("America/Los_Angeles"), snapshots: z.array(snapshot).max(100), sources: z.array(source).min(1).max(100),
  sessions: z.array(z.strictObject({ sessionKey: key, timing: chatgptTimingSchema, attempts: z.array(chatgptAttemptSchema).min(1).max(100) })).min(1).max(100), gaps: strings,
}).superRefine((v, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  const unique = (values: string[], name: string) => { if (new Set(values).size !== values.length) fail(`Duplicate ${name}`); };
  unique(v.snapshots.map((s) => s.snapshotId), "snapshot identity");
  unique(v.sources.map((s) => s.sourceChatKey), "chat identity");
  unique(v.sessions.map((s) => s.sessionKey), "session identity");
  const attempts = v.sessions.flatMap((s) => s.attempts);
  if (attempts.length > 100) fail("Import at most 100 attempts per packet");
  if (attempts.length * 8 + v.sources.length * 4 + v.sessions.length * 3 > 900) fail("Split this export into fewer sessions or source chats per packet.");
  unique(attempts.map((a) => a.attemptKey), "attempt identity");
  const turns = new Map(v.sources.flatMap((s) => s.turns.map((t) => [t.turnKey, { ...t, sourceChatKey: s.sourceChatKey }] as const)));
  unique(v.sources.flatMap((s) => s.turns.map((t) => t.turnKey)), "turn identity");
  if (turns.size > 2000) fail("Import at most 2000 source turns per packet");
  for (const a of attempts) {
    if (a.snapshotId && !v.snapshots.some((s) => s.snapshotId === a.snapshotId)) fail("Unknown snapshot reference");
    if (a.sourceChatKeys.some((k) => !v.sources.some((s) => s.sourceChatKey === k))) fail("Unknown source chat reference");
    if (a.turnKeys.some((k) => !turns.has(k) || !a.sourceChatKeys.includes(turns.get(k)!.sourceChatKey))) fail("Turn reference outside the attempt's supplied sources");
    if (a.outcomeEvidenceTurnKeys.some((k) => !a.turnKeys.includes(k) || !turns.has(k))) fail("Outcome evidence must resolve within this attempt");
  }
});
export const chatgptImportRequestSchema = z.strictObject({
  action: z.enum(["preview", "apply"]), packet: chatgptExportSchema,
  resolutions: z.array(z.strictObject({ attemptKey: key, questionId: key.optional(), practiceDate: z.iso.date().optional() })).max(100).default([]),
  previewToken: z.string().regex(/^[a-f0-9]{64}$/).optional(), confirmCorrections: z.boolean().default(false),
});
export type ChatgptExport = z.infer<typeof chatgptExportSchema>;
export type ChatgptAttempt = z.infer<typeof chatgptAttemptSchema>;
export type ChatgptTiming = z.infer<typeof chatgptTimingSchema>;
export type ChatgptImportRequest = z.infer<typeof chatgptImportRequestSchema>;
export type ImportedPractice = {
  activityId: string; attemptKey: string; revision: number; fingerprint: string; status: "completed" | "pending";
  reasons: string[]; questionId: string | null; practiceDate: string | null;
  attempt: ChatgptAttempt; session: { sessionKey: string; timing: ChatgptTiming };
  sources: ChatgptExport["sources"]; snapshot: ChatgptExport["snapshots"][number] | null;
  currentSession?: { timing: ChatgptTiming; attemptKeys: string[] };
};
export type ImportPreview = {
  previewToken: string; duplicate: boolean; corrections: boolean;
  records: ImportedPractice[]; warnings: string[];
};
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export async function importFingerprint(value: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
}
export function chatgptTimingLabel(timing: ChatgptTiming) {
  return timing.activeMinutes === null ? "Time unknown" : `${timing.basis === "user_estimate" ? "About " : ""}${Number(timing.activeMinutes.toFixed(1))} min${timing.basis === "user_estimate" ? " · your estimate" : " · recorded boundaries"}`;
}
