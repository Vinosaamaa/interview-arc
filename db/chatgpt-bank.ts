import type { QuestionBankItem } from "../app/content-types";
import { importFingerprint } from "./chatgpt-import-policy.ts";

type Database = Pick<D1Database, "prepare">;
type Specialty = "leetcode" | "system_design" | "behavioral";
const safeUrl = (url: string | null | undefined) => {
  try { const parsed = new URL(url ?? ""); return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password ? url! : null; } catch { return null; }
};
export async function readChatgptBank(db: Database, owner: string, specialty?: Specialty, now = Date.now()) {
  const [catalog, personal, attempts, reviews] = await Promise.all([
    db.prepare("SELECT category, payload FROM content_bank ORDER BY category, ord").all<{ category: string; payload: string }>(),
    db.prepare("SELECT specialty, question_id, title, prompt, url, topics, active FROM owner_bank_questions WHERE owner_id = ? ORDER BY specialty, question_id").bind(owner).all<{ specialty: Specialty; question_id: string; title: string; prompt: string | null; url: string | null; topics: string; active: number }>(),
    db.prepare(`WITH completed AS (
      SELECT activity_id AS id, specialty, question_id, practice_date, completed_at, outcome FROM practice_records WHERE owner_id = ?
      UNION ALL
      SELECT e.id, json_extract(e.payload, '$.type'), json_extract(e.payload, '$.questionId'), e.date, t.completed_at, o.outcome
        FROM extra_activities e JOIN timers t ON t.owner_id = e.owner_id AND t.subject_id = e.id AND t.kind = 'activity' AND t.completed = 1
        LEFT JOIN outcomes o ON o.owner_id = e.owner_id AND o.activity_id = e.id
        WHERE e.owner_id = ? AND NOT EXISTS (SELECT 1 FROM practice_records r WHERE r.owner_id = e.owner_id AND r.activity_id = e.id)
      UNION ALL
      SELECT activity_id, specialty, question_id, practice_date,
        (SELECT CAST(strftime('%s', json_extract(value, '$.at')) AS INTEGER) * 1000 FROM json_each(payload, '$.attempt.timing.events') WHERE json_extract(value, '$.command') = 'finish'), json_extract(payload, '$.attempt.outcome')
        FROM chatgpt_import_records WHERE owner_id = ? AND status = 'completed'
    ) SELECT * FROM completed ORDER BY practice_date DESC, completed_at DESC, id`).bind(owner, owner, owner).all<{ id: string; specialty: Specialty; question_id: string; practice_date: string; completed_at: number | null; outcome: "solved" | "solved_after_reviewing_approach" | "failed" | null }>(),
    db.prepare("SELECT specialty, question_id, due_date FROM review_schedules WHERE owner_id = ? AND status IN ('scheduled','due') ORDER BY due_date").bind(owner).all<{ specialty: Specialty; question_id: string; due_date: string }>(),
  ]);
  const bank = new Map<string, { specialty: Specialty; questionId: string; title: string; prompt: string | null; url: string | null; topics: string[]; availability: "active" | "inactive" }>();
  for (const row of catalog.results) {
    const type = row.category === "systemDesign" ? "system_design" : row.category as Specialty;
    if (!["leetcode", "system_design", "behavioral"].includes(type)) continue;
    const q = JSON.parse(row.payload) as QuestionBankItem;
    bank.set(`${type}:${q.id}`, { specialty: type, questionId: q.id, title: q.title, prompt: q.prompt || null, url: safeUrl(q.url), topics: q.topics ?? [], availability: q.active ? "active" : "inactive" });
  }
  for (const q of personal.results) bank.set(`${q.specialty}:${q.question_id}`, { specialty: q.specialty, questionId: q.question_id, title: q.title, prompt: q.prompt || null, url: safeUrl(q.url), topics: JSON.parse(q.topics), availability: q.active ? "active" : "inactive" });
  const questions = [...bank.values()].filter((q) => !specialty || q.specialty === specialty).map((q) => {
    const history = attempts.results.filter((a) => a.specialty === q.specialty && a.question_id === q.questionId);
    const latest = history[0];
    return { ...q, progress: { attemptCount: history.length, lastOutcome: q.specialty === "leetcode" ? latest?.outcome ?? null : null,
      lastCompletedAt: latest?.completed_at ? new Date(latest.completed_at).toISOString() : null,
      reviewDueDate: reviews.results.find((r) => r.specialty === q.specialty && r.question_id === q.questionId)?.due_date ?? null } };
  });
  const revision = await importFingerprint(questions);
  return { schemaVersion: 1 as const, kind: "bank_snapshot" as const,
    snapshot: { snapshotId: `bank-${crypto.randomUUID()}`, sourceDescription: "Interview Arc authenticated bank and durable completed-practice snapshot", sourceRevision: revision, dataAsOf: new Date(now).toISOString() },
    timeZone: "America/Los_Angeles" as const, visibility: "owner_private" as const, scope: specialty ? "selected" as const : "all" as const, questions };
}
