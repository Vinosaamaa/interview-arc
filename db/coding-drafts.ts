import { z } from "zod";
import { canonicalJson, importFingerprint } from "./chatgpt-import-policy.ts";

export type CodingDatabase = Pick<D1Database, "prepare" | "batch">;
export const codingLanguage = z.enum(["java", "python3"]);
export const draftKey = z.string().min(1).max(240);
export const codingSha256 = async (code: string) => Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(code))).toString("hex");
export const saveCodingInput = z.object({
  draftId: draftKey, expectedRevision: z.number().int().min(1),
  operationId: draftKey, code: z.string().max(64000),
}).strict();
export type CodingProblem = {
  title: string; statement: string; html: string | null; diagramText: string | null;
  questionId: string | null; titleSlug: string | null; leetcodeId: string | null;
  url: string | null;
};
export type CodingDraft = {
  draftId: string; revision: number; language: "java" | "python3";
  code: string; codeSha256: string; problem: CodingProblem; updatedAt: number;
};
export class CodingDraftConflictError extends Error {
  latest: CodingDraft | null;
  constructor(latest: CodingDraft | null) {
    super("Draft changed or is unavailable. Compare the saved code before choosing which edits to keep.");
    this.latest = latest;
  }
}
export async function readCodingDraft(db: CodingDatabase, owner: string, draftId: string, revision?: number): Promise<CodingDraft | null> {
  const row = await db.prepare(`SELECT current.payload, original.payload AS original_payload FROM coding_draft_revisions current JOIN coding_draft_revisions original ON original.owner_id=current.owner_id AND original.draft_id=current.draft_id AND original.revision=1 WHERE current.owner_id=? AND current.draft_id=? ${revision === undefined ? "" : "AND current.revision=?"} ORDER BY current.revision DESC LIMIT 1`)
    .bind(...(revision === undefined ? [owner, draftId] : [owner, draftId, revision])).first<{payload: string; original_payload:string}>();
  if (!row) return null;
  const draft = JSON.parse(row.payload);
  return {...draft, problem:draft.problem ?? JSON.parse(row.original_payload).problem};
}
export async function openCodingDraft(db: CodingDatabase, owner: string, draftId: string, language: CodingDraft["language"], problem: CodingProblem, code: string): Promise<CodingDraft> {
  const current = await readCodingDraft(db, owner, draftId); if (current) return current;
  const payload: CodingDraft = {draftId, revision: 1, language, code, codeSha256: await codingSha256(code), problem, updatedAt: Date.now()};
  await db.prepare("INSERT OR IGNORE INTO coding_draft_revisions(owner_id,draft_id,revision,operation_id,request_fingerprint,payload,created_at) VALUES(?,?,1,?,?,?,?)")
    .bind(owner, draftId, `open:${draftId}`, await importFingerprint(payload), canonicalJson(payload), payload.updatedAt).run();
  const saved = await readCodingDraft(db, owner, draftId); if (!saved) throw new Error("Draft was not confirmed. Reopen the same question.");
  return saved;
}
export async function saveCodingDraft(db: CodingDatabase, owner: string, value: unknown) {
  const input = saveCodingInput.parse(value); const fingerprint = await importFingerprint(input);
  const replay = async () => {
    const row = await db.prepare("SELECT request_fingerprint,payload FROM coding_draft_revisions WHERE owner_id=? AND operation_id=?").bind(owner,input.operationId).first<{request_fingerprint:string;payload:string}>();
    if (!row) return null;
    if (row.request_fingerprint !== fingerprint) throw new Error("That draft save ID belongs to different content. Read the current draft.");
    const saved = JSON.parse(row.payload) as CodingDraft;
    return {saved:true,duplicate:true,draft:(await readCodingDraft(db,owner,saved.draftId,saved.revision))!};
  };
  const prior = await replay(); if (prior) return prior;
  const current = await readCodingDraft(db,owner,input.draftId);
  if (!current || current.revision !== input.expectedRevision) throw new CodingDraftConflictError(current);
  const draft = {...current,code:input.code,codeSha256:await codingSha256(input.code),revision:current.revision+1,updatedAt:Date.now()};
  // Problem metadata is immutable and lives once in revision 1. Later revisions
  // retain exact source without repeating a potentially large statement.
  const storedDraft: Partial<CodingDraft> = {...draft}; delete storedDraft.problem;
  try {
    await db.batch([
      db.prepare("SELECT json(CASE WHEN (SELECT MAX(revision) FROM coding_draft_revisions WHERE owner_id=? AND draft_id=?)=? THEN 'true' ELSE 'draft_conflict' END)").bind(owner,input.draftId,input.expectedRevision),
      db.prepare("INSERT INTO coding_draft_revisions(owner_id,draft_id,revision,operation_id,request_fingerprint,payload,created_at) VALUES(?,?,?,?,?,?,?)").bind(owner,input.draftId,draft.revision,input.operationId,fingerprint,canonicalJson(storedDraft),draft.updatedAt),
    ]);
  } catch {const existing=await replay();if(existing)return existing;const latest=await readCodingDraft(db,owner,input.draftId);if(latest?.revision!==input.expectedRevision)throw new CodingDraftConflictError(latest);throw new Error("Draft save was not confirmed. Keep your edits and retry the same save ID after checking the current revision.");}
  return {saved:true,duplicate:false,draft};
}
