import { z } from "zod";
import { readChatgptBank } from "./chatgpt-bank.ts";
import { chatgptSpecialty, importFingerprint, type ImportPreview } from "./chatgpt-import-policy.ts";
import { ChatgptImportError } from "./chatgpt-import-store.ts";

type Database = Pick<D1Database, "prepare" | "batch">;
export const connectorKey = z.string().min(1).max(160).regex(/^[a-z0-9][a-z0-9._:-]*$/);
export const createQuestionSchema = z.strictObject({
  operationId: connectorKey, specialty: chatgptSpecialty, title: z.string().trim().min(1).max(2000),
  prompt: z.string().trim().min(1).max(20000).nullable(),
  url: z.url({ protocol: /^https?$/ }).max(4000).nullable(),
}).refine((v) => Boolean(v.url || v.prompt), "Supply a public question URL or an original prompt.")
  .refine((v) => !v.url || (!new URL(v.url).username && !new URL(v.url).password), "Do not put credentials in a URL.");

export function compactImportReceipt(receipt: ImportPreview) {
  return { previewToken: receipt.previewToken, duplicate: receipt.duplicate, corrections: receipt.corrections, warnings: receipt.warnings,
    records: receipt.records.map((r) => ({ activityId: r.activityId, attemptKey: r.attemptKey, revision: r.revision, fingerprint: r.fingerprint,
      status: r.status, reasons: r.reasons, questionId: r.questionId, practiceDate: r.practiceDate, title: r.attempt.question.title,
      timing: { state: r.attempt.timing.state, activeMinutes: r.attempt.timing.activeMinutes, basis: r.attempt.timing.basis } })) };
}
const canonicalUrl = (value: string | null) => {
  if (!value) return null;
  const url = new URL(value); url.hash = "";
  if (url.hostname === "leetcode.com" || url.hostname === "www.leetcode.com") {
    const match = url.pathname.match(/^\/problems\/([^/]+)/);
    if (match) return `https://leetcode.com/problems/${match[1]}/`;
  }
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}${url.search}`;
};

// Insert-only variant of the existing owner bank persistence boundary. The
// general specialist upsert can replace personal content and is not exposed.
export async function createChatgptQuestion(db: Database, owner: string, input: z.infer<typeof createQuestionSchema>) {
  const fingerprint = await importFingerprint(input);
  const read = () => db.prepare("SELECT fingerprint, receipt FROM chatgpt_question_operations WHERE owner_id = ? AND operation_id = ?").bind(owner, input.operationId).first<{ fingerprint: string; receipt: string }>();
  const prior = await read();
  if (prior) {
    if (prior.fingerprint !== fingerprint) throw new ChatgptImportError("This operation ID has different content. Use a new ID for another question.");
    return { ...JSON.parse(prior.receipt), duplicate: true };
  }
  const bank = await readChatgptBank(db, owner, input.specialty);
  const url = canonicalUrl(input.url);
  const existing = bank.questions.find((q) => url ? canonicalUrl(q.url) === url : q.title === input.title && q.prompt === input.prompt);
  const questionId = existing?.questionId ?? `chatgpt-${(await importFingerprint({ specialty: input.specialty, identity: url ?? { title: input.title, prompt: input.prompt } })).slice(0, 40)}`;
  const receipt = { operationId: input.operationId, fingerprint, status: existing ? "existing" : "created", specialty: input.specialty, questionId, title: existing?.title ?? input.title, duplicate: false };
  const now = Date.now();
  const writes = [];
  if (!existing) writes.push(db.prepare(`INSERT INTO owner_bank_questions (owner_id,specialty,question_id,title,prompt,url,source,tags,target_minutes,updated_at)
    VALUES (?,?,?,?,?,?,'chatgpt','[]',?,?)`)
    .bind(owner, input.specialty, questionId, input.title, input.prompt, url, input.specialty === "leetcode" ? 40 : 60, now));
  writes.push(db.prepare("INSERT INTO chatgpt_question_operations(owner_id,operation_id,fingerprint,receipt,created_at) VALUES(?,?,?,?,?)")
    .bind(owner, input.operationId, fingerprint, JSON.stringify(receipt), now));
  try { await db.batch(writes); }
  catch {
    const raced = await read();
    if (raced?.fingerprint === fingerprint) return { ...JSON.parse(raced.receipt), duplicate: true };
    throw new ChatgptImportError("Question operation conflicted. Retry identical content and identity; existing questions were preserved.");
  }
  const saved = await read();
  if (!saved || saved.fingerprint !== fingerprint) throw new ChatgptImportError("Question readback was not confirmed. Retry the identical request.", 503);
  const verified = (await readChatgptBank(db, owner, input.specialty)).questions.find((q) => q.questionId === questionId);
  if (!verified || !existing && (verified.title !== input.title || verified.prompt !== input.prompt || canonicalUrl(verified.url) !== url)) throw new ChatgptImportError("Question readback was not confirmed. Read the bank before reporting success.", 503);
  return JSON.parse(saved.receipt);
}
