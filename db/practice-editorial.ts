import { z } from "zod";
import { canonicalJson, importFingerprint } from "./chatgpt-import-policy.ts";

type Database = Pick<D1Database, "prepare" | "batch">;
const id = z.string().trim().min(1).max(240);
export const practiceEditorialSchema = z.object({
  operationId: id,
  activityId: id,
  questionId: id,
  expectedRevision: z.number().int().min(0),
  source: z.enum(["leetcode_playwright_controller", "chatgpt_browser", "mcp", "owner_supplied"]),
  editorialUrl: z.string().regex(/^https:\/\/leetcode\.com\/problems\/[a-z0-9-]+\/editorial\/?$/),
  accessedAt: z.iso.datetime({ offset: true }),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  approachTitles: z.array(z.string().trim().min(1).max(240)).min(1).max(30),
  explanation: z.string().trim().min(20).max(100_000),
}).strict();
export type PracticeEditorial = z.infer<typeof practiceEditorialSchema> & { revision: number; createdAt: number };
type Stored = { request_fingerprint: string; payload: string };

export async function readPracticeEditorial(db: Database, owner: string, activityId: string, revision?: number): Promise<PracticeEditorial | null> {
  const row = await db.prepare(`SELECT payload FROM practice_editorial_additions WHERE owner_id = ? AND activity_id = ?${revision === undefined ? " ORDER BY revision DESC LIMIT 1" : " AND revision = ?"}`)
    .bind(owner, activityId, ...(revision === undefined ? [] : [revision])).first<{ payload: string }>();
  return row ? JSON.parse(row.payload) as PracticeEditorial : null;
}

export async function savePracticeEditorial(db: Database, owner: string, value: unknown, now = Date.now()) {
  const input = practiceEditorialSchema.parse(value);
  const fingerprint = await importFingerprint(input);
  async function replay() {
    const row = await db.prepare("SELECT request_fingerprint, payload FROM practice_editorial_additions WHERE owner_id = ? AND operation_id = ?")
      .bind(owner, input.operationId).first<Stored>();
    if (!row) return null;
    if (row.request_fingerprint !== fingerprint) throw new Error("This editorial operation ID already belongs to different content.");
    return { saved: true as const, duplicate: true, editorial: JSON.parse(row.payload) as PracticeEditorial };
  }
  const prior = await replay();
  if (prior) return prior;
  const record = await db.prepare("SELECT question_id, specialty, status, payload FROM chatgpt_import_records WHERE owner_id = ? AND activity_id = ?")
    .bind(owner, input.activityId).first<{ question_id: string; specialty: string; status: string; payload: string }>();
  if (!record || record.specialty !== "leetcode" || record.status !== "completed" || record.question_id !== input.questionId) {
    throw new Error("Choose a completed imported LeetCode practice record belonging to this owner and question.");
  }
  const original = JSON.parse(record.payload) as { attempt: { question: { url: string | null } } };
  const problemPath = /^https:\/\/leetcode\.com\/problems\/([a-z0-9-]+)(?:\/|$)/.exec(original.attempt.question.url ?? "");
  if (!problemPath || input.editorialUrl.replace(/\/$/, "") !== `https://leetcode.com/problems/${problemPath[1]}/editorial`) {
    throw new Error("The editorial URL must match the original practice problem URL.");
  }
  const editorial: PracticeEditorial = { ...input, revision: input.expectedRevision + 1, createdAt: now };
  const payload = canonicalJson(editorial);
  try {
    await db.batch([
      db.prepare(`SELECT json(CASE WHEN COALESCE((SELECT MAX(revision) FROM practice_editorial_additions WHERE owner_id = ? AND activity_id = ?), 0) = ?
        AND EXISTS(SELECT 1 FROM chatgpt_import_records WHERE owner_id = ? AND activity_id = ? AND question_id = ? AND specialty = 'leetcode' AND status = 'completed')
        THEN 'true' ELSE 'editorial_conflict' END)`).bind(owner, input.activityId, input.expectedRevision, owner, input.activityId, input.questionId),
      db.prepare("INSERT INTO practice_editorial_additions(owner_id, activity_id, revision, operation_id, request_fingerprint, payload, created_at) VALUES(?,?,?,?,?,?,?)")
        .bind(owner, input.activityId, editorial.revision, input.operationId, fingerprint, payload, now),
    ]);
  } catch {
    const saved = await replay();
    if (saved) return saved;
    throw new Error("Editorial was not confirmed. Read its latest revision before retrying; reuse unchanged operation IDs after uncertainty.");
  }
  const saved = await readPracticeEditorial(db, owner, input.activityId, editorial.revision);
  if (!saved || canonicalJson(saved) !== payload) throw new Error("Editorial readback was not confirmed. Retry the identical operation.");
  return { saved: true as const, duplicate: false, editorial: saved };
}
