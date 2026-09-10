import {
  canonicalJson, importFingerprint,
  type ChatgptExport, type ChatgptImportRequest, type ImportedPractice, type ImportPreview,
} from "./chatgpt-import-policy.ts";

// This adapter accepts a D1 binding so its actual SQL/transaction behavior can
// be tested without booting unrelated specialist services.
type Database = Pick<D1Database, "prepare" | "batch">;
export type ImportCatalogQuestion = { specialty: string; questionId: string; title: string; active: boolean };
type Stored = { payload: string; fingerprint: string };
export class ChatgptImportError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) { super(message); this.status = status; }
}
const parseRecord = (row: Stored) => JSON.parse(row.payload) as ImportedPractice;

export async function readImportedPractice(db: Database, owner: string, activityId: string, revision?: number) {
  const row = revision === undefined
    ? await db.prepare("SELECT payload, fingerprint FROM chatgpt_import_records WHERE owner_id = ? AND activity_id = ?").bind(owner, activityId).first<Stored>()
    : await db.prepare(`SELECT v.payload, v.fingerprint FROM chatgpt_import_revisions v JOIN chatgpt_import_records r ON r.owner_id = v.owner_id AND r.attempt_key = v.attempt_key
      WHERE r.owner_id = ? AND r.activity_id = ? AND v.revision = ?`).bind(owner, activityId, revision).first<Stored>();
  if (!row) return null;
  const record = parseRecord(row);
  const session = await db.prepare("SELECT payload FROM chatgpt_import_sessions WHERE owner_id = ? AND session_key = ?").bind(owner, record.session.sessionKey).first<{ payload: string }>();
  return { ...record, ...(session ? { currentSession: JSON.parse(session.payload) as NonNullable<ImportedPractice["currentSession"]> } : {}) };
}
export async function listImportedPractice(db: Database, owner: string, offset = 0, status: "completed" | "pending" = "completed") {
  const rows = await db.prepare(`SELECT activity_id, revision, fingerprint, status, specialty, question_id, practice_date,
    json_extract(payload, '$.attempt.question.title') AS title,
    json_extract(payload, '$.attempt.timing') AS timing,
    json_extract(payload, '$.reasons') AS reasons
    FROM chatgpt_import_records WHERE owner_id = ? AND status = ?
    ORDER BY practice_date DESC, activity_id LIMIT 51 OFFSET ?`).bind(owner, status, offset).all<{
      activity_id: string; revision: number; fingerprint: string; status: "completed" | "pending";
      specialty: string; question_id: string | null; practice_date: string | null; title: string; timing: string; reasons: string;
    }>();
  return { records: rows.results.slice(0, 50).map((r) => ({
    activityId: r.activity_id, revision: r.revision, fingerprint: r.fingerprint, status: r.status,
    specialty: r.specialty, questionId: r.question_id, practiceDate: r.practice_date, title: r.title,
    timing: JSON.parse(r.timing) as ImportedPractice["attempt"]["timing"], reasons: JSON.parse(r.reasons) as string[],
  })), nextOffset: rows.results.length > 50 ? offset + 50 : null };
}

async function existingPacket(db: Database, owner: string, packetId: string, fingerprint: string) {
  const row = await db.prepare("SELECT fingerprint, receipt FROM chatgpt_import_packets WHERE owner_id = ? AND packet_id = ?").bind(owner, packetId).first<{ fingerprint: string; receipt: string }>();
  if (!row) return null;
  if (row.fingerprint !== fingerprint) throw new ChatgptImportError("This packet ID was already saved with different content. Export a new packet for an explicit correction.");
  return JSON.parse(row.receipt) as ImportPreview;
}

export async function prepareChatgptImport(db: Database, owner: string, input: ChatgptImportRequest, catalog: ImportCatalogQuestion[]) {
  const fingerprint = await importFingerprint({ packet: input.packet, resolutions: input.resolutions });
  const prior = await existingPacket(db, owner, input.packet.packetId, fingerprint);
  if (prior) return { preview: { ...prior, duplicate: true }, fingerprint, sourceUpdates: [], sessionUpdates: [], recordUpdates: [] };
  const attempts = input.packet.sessions.flatMap((s) => s.attempts);
  if (new Set(input.resolutions.map((r) => r.attemptKey)).size !== input.resolutions.length || input.resolutions.some((r) => !attempts.some((a) => a.attemptKey === r.attemptKey))) throw new ChatgptImportError("Question/date resolutions must refer to distinct attempts in this packet.", 400);
  const sourceUpdates: { sourceKey: string; oldHash: string | null; hash: string; payload: string }[] = [];
  for (const source of input.packet.sources) {
    const old = await db.prepare("SELECT fingerprint, payload FROM chatgpt_import_sources WHERE owner_id = ? AND source_key = ?").bind(owner, source.sourceChatKey).first<Stored>();
    const previous = old ? JSON.parse(old.payload) as ChatgptExport["sources"][number]["turns"] : [];
    const merged = new Map(previous.map((t) => [t.turnKey, t]));
    for (const turn of source.turns) {
      const priorTurn = merged.get(turn.turnKey);
      if (priorTurn && canonicalJson(priorTurn) !== canonicalJson(turn)) throw new ChatgptImportError(`Source turn ${turn.turnKey} changed. Preserve original text and append correction evidence.`);
      if ([...merged.values()].some((t) => t.sequence === turn.sequence && t.turnKey !== turn.turnKey)) throw new ChatgptImportError("A source sequence already belongs to a different turn.");
      merged.set(turn.turnKey, turn);
    }
    const foreign = await db.prepare(`SELECT 1 FROM chatgpt_import_sources s, json_each(s.payload) t
      WHERE s.owner_id = ? AND s.source_key != ? AND json_extract(t.value, '$.turnKey') IN (SELECT json_extract(value, '$.turnKey') FROM json_each(?)) LIMIT 1`)
      .bind(owner, source.sourceChatKey, JSON.stringify(source.turns)).first();
    if (foreign) throw new ChatgptImportError("A turn identity already belongs to another source chat.");
    const ordered = [...merged.values()].sort((a, b) => a.sequence - b.sequence);
    let lastTimestamp: number | null = null;
    for (const turn of ordered) if (turn.occurredAt !== null) {
      const timestamp = Date.parse(turn.occurredAt);
      if (lastTimestamp !== null && timestamp < lastTimestamp) throw new ChatgptImportError("New source timestamps contradict the previously saved conversation order.");
      lastTimestamp = timestamp;
    }
    const payload = canonicalJson(ordered);
    if (new TextEncoder().encode(payload).length > 1_500_000) throw new ChatgptImportError("This source is too large. Start a new source capture key for the next conversation range.", 413);
    sourceUpdates.push({ sourceKey: source.sourceChatKey, oldHash: old?.fingerprint ?? null, hash: await importFingerprint(JSON.parse(payload)), payload });
  }
  const recordUpdates: { record: ImportedPractice; oldHash: string | null }[] = [];
  const records: ImportedPractice[] = [];
  let receiptBytes = new TextEncoder().encode(canonicalJson(input.packet)).length;
  const addRecord = (record: ImportedPractice) => {
    receiptBytes += new TextEncoder().encode(canonicalJson(record)).length;
    // D1 limits a row including all text columns, not each column separately.
    // Bound expansion before constructing a large receipt or starting writes.
    if (receiptBytes > 1_500_000) throw new ChatgptImportError("The linked evidence is too large for one import receipt. Split it into smaller session packets while preserving source identities.", 413);
    records.push(record);
  };
  const reserved = new Set<string>();
  let corrections = false;
  const sessionUpdates: { sessionKey: string; oldHash: string | null; hash: string; payload: string }[] = [];
  for (const session of input.packet.sessions) {
    const old = await db.prepare("SELECT payload, fingerprint FROM chatgpt_import_sessions WHERE owner_id = ? AND session_key = ?").bind(owner, session.sessionKey).first<Stored>();
    const previous = old ? JSON.parse(old.payload) as { timing: ChatgptExport["sessions"][number]["timing"]; attemptKeys: string[] } : null;
    if (previous?.timing.state === "finished" && (session.timing.state !== "finished" || session.attempts.some((a) => !previous.attemptKeys.includes(a.attemptKey)))) throw new ChatgptImportError("A finished source session cannot be resumed or acquire new attempts. Start a new session key.");
    const value = { timing: session.timing, attemptKeys: [...new Set([...(previous?.attemptKeys ?? []), ...session.attempts.map((a) => a.attemptKey)])].sort() };
    const hash = await importFingerprint(value);
    if (old && old.fingerprint !== hash) corrections = true;
    sessionUpdates.push({ sessionKey: session.sessionKey, oldHash: old?.fingerprint ?? null, hash, payload: canonicalJson(value) });
  }
  for (const session of input.packet.sessions) for (const attempt of session.attempts) {
    const row = await db.prepare("SELECT fingerprint, payload FROM chatgpt_import_records WHERE owner_id = ? AND attempt_key = ?").bind(owner, attempt.attemptKey).first<Stored>();
    const old = row ? parseRecord(row) : null;
    const resolution = input.resolutions.find((r) => r.attemptKey === attempt.attemptKey);
    const questionId = resolution?.questionId ?? old?.questionId ?? attempt.question.questionId;
    const practiceDate = resolution?.practiceDate ?? old?.practiceDate ?? attempt.practiceDate;
    const matched = catalog.find((q) => q.questionId === questionId && q.specialty === attempt.question.specialty);
    const reasons: string[] = [];
    if (!matched) reasons.push("Choose an exact question from the current bank.");
    if (matched && !matched.active) reasons.push("This question is inactive in the current bank.");
    if (!practiceDate) reasons.push("Supply the Pacific practice date.");
    if (attempt.timing.state !== "finished") reasons.push("This question is still a practice checkpoint.");
    if (attempt.kind === "discussion") reasons.push("Discussion evidence is saved without counting as a completed attempt.");
    if (attempt.kind === "attempt" && attempt.userAttempted !== true) reasons.push("Confirm that you actually attempted this question in the source export.");
    if (!attempt.turnKeys.length || !input.packet.sources.some((s) => attempt.sourceChatKeys.includes(s.sourceChatKey) && s.turns.some((t) => attempt.turnKeys.includes(t.turnKey)))) reasons.push("Only summary evidence was supplied; a completed record needs source conversation turns.");
    if (attempt.question.specialty === "leetcode" && attempt.kind === "attempt" && !attempt.outcome) reasons.push("A coding result and its evidence are still missing.");
    const dayKey = `${attempt.question.specialty}:${questionId}:${practiceDate}`;
    if (questionId && practiceDate) {
      const occupied = await db.prepare(`SELECT 1 FROM chatgpt_import_records WHERE owner_id = ? AND specialty = ? AND question_id = ? AND practice_date = ? AND status = 'completed' AND attempt_key != ?
        UNION ALL SELECT 1 FROM extra_activities WHERE owner_id = ? AND json_extract(payload, '$.type') = ? AND json_extract(payload, '$.questionId') = ? AND date = ?
        UNION ALL SELECT 1 FROM practice_records WHERE owner_id = ? AND specialty = ? AND question_id = ? AND practice_date = ? LIMIT 1`)
        .bind(owner, attempt.question.specialty, questionId, practiceDate, attempt.attemptKey, owner, attempt.question.specialty, questionId, practiceDate, owner, attempt.question.specialty, questionId, practiceDate).first();
      if (occupied || reserved.has(dayKey)) reasons.push("This question already has an activity on this Pacific day. Evidence is retained pending reconciliation.");
    }
    const sources = input.packet.sources.filter((s) => attempt.sourceChatKeys.includes(s.sourceChatKey)).map((s) => ({ ...s,
      gaps: [...new Set([...(old?.sources.find((previous) => previous.sourceChatKey === s.sourceChatKey)?.gaps ?? []), ...s.gaps])],
      turns: s.turns.filter((t) => attempt.turnKeys.includes(t.turnKey)) }));
    // Preserve the captured source order even if ChatGPT listed references out of order.
    const value = { questionId, practiceDate, attempt, session: { sessionKey: session.sessionKey, timing: session.timing }, sources,
      snapshot: input.packet.snapshots.find((s) => s.snapshotId === attempt.snapshotId) ?? null };
    const hash = await importFingerprint({ ...value, status: reasons.length ? "pending" : "completed", reasons });
    if (old && old.fingerprint === hash) { addRecord(old); if (old.status === "completed") reserved.add(dayKey); continue; }
    if (old) {
      corrections = true;
      if (old.status === "completed" && (reasons.length || old.questionId !== questionId || old.practiceDate !== practiceDate)) throw new ChatgptImportError("A completed import cannot be reopened, moved to another question/day, or downgraded by a smaller capture.");
      if (old.attempt.question.prompt !== attempt.question.prompt || old.attempt.question.specialty !== attempt.question.specialty || old.session.sessionKey !== session.sessionKey || old.attempt.turnKeys.some((k) => !attempt.turnKeys.includes(k))) throw new ChatgptImportError("A revision must preserve the original prompt, specialty, session and previously saved source turns.");
    }
    const record: ImportedPractice = { ...value, activityId: old?.activityId ?? `chatgpt-${(await importFingerprint({ owner, attemptKey: attempt.attemptKey })).slice(0, 40)}`,
      attemptKey: attempt.attemptKey, revision: (old?.revision ?? 0) + 1, fingerprint: hash, status: reasons.length ? "pending" : "completed", reasons };
    if (record.status === "completed") reserved.add(dayKey);
    addRecord(record); recordUpdates.push({ record, oldHash: row?.fingerprint ?? null });
  }
  const warnings = [...input.packet.gaps, ...input.packet.sources.flatMap((s) => s.gaps), ...attempts.flatMap((a) => a.gaps)];
  if (input.packet.sessions.length > 1) warnings.push("Session totals are shown separately; overlap has not been ruled out, so no daily time total is inferred.");
  const previewToken = await importFingerprint({ owner, fingerprint, records, catalog, sourceUpdates: sourceUpdates.map(({ sourceKey, oldHash }) => ({ sourceKey, oldHash })), sessionUpdates });
  return { fingerprint, sourceUpdates, sessionUpdates, recordUpdates, preview: { previewToken, duplicate: false, corrections, records, warnings } satisfies ImportPreview };
}

export async function applyChatgptImport(db: Database, owner: string, input: ChatgptImportRequest, catalog: ImportCatalogQuestion[], now = Date.now()) {
  const prepared = await prepareChatgptImport(db, owner, input, catalog);
  const { preview, fingerprint } = prepared;
  if (preview.duplicate) return verifyImportReceipt(db, owner, preview);
  if (!input.previewToken || input.previewToken !== preview.previewToken) throw new ChatgptImportError("The preview changed. Preview again before saving.");
  if (preview.corrections && !input.confirmCorrections) throw new ChatgptImportError("Confirm the previewed revisions before saving changed attempts.");
  const statements: D1PreparedStatement[] = [];
  const guard = (query: string, args: (string | number | null)[]) => statements.push(db.prepare(`SELECT json(CASE WHEN ${query} THEN 'true' ELSE 'import_conflict' END)`).bind(...args));
  for (const source of prepared.sourceUpdates) {
    guard("COALESCE((SELECT fingerprint FROM chatgpt_import_sources WHERE owner_id = ? AND source_key = ?), '') = ?", [owner, source.sourceKey, source.oldHash ?? ""]);
    statements.push(db.prepare(`INSERT INTO chatgpt_import_sources(owner_id, source_key, fingerprint, payload) VALUES(?,?,?,?)
      ON CONFLICT(owner_id, source_key) DO UPDATE SET fingerprint=excluded.fingerprint, payload=excluded.payload`).bind(owner, source.sourceKey, source.hash, source.payload));
  }
  for (const session of prepared.sessionUpdates) {
    guard("COALESCE((SELECT fingerprint FROM chatgpt_import_sessions WHERE owner_id = ? AND session_key = ?), '') = ?", [owner, session.sessionKey, session.oldHash ?? ""]);
    statements.push(db.prepare(`INSERT INTO chatgpt_import_sessions(owner_id, session_key, fingerprint, payload) VALUES(?,?,?,?)
      ON CONFLICT(owner_id, session_key) DO UPDATE SET fingerprint=excluded.fingerprint, payload=excluded.payload`).bind(owner, session.sessionKey, session.hash, session.payload));
  }
  for (const { record: r, oldHash } of prepared.recordUpdates) {
    guard("COALESCE((SELECT fingerprint FROM chatgpt_import_records WHERE owner_id = ? AND attempt_key = ?), '') = ?", [owner, r.attemptKey, oldHash ?? ""]);
    if (r.status === "completed") {
      guard("NOT EXISTS(SELECT 1 FROM extra_activities WHERE owner_id = ? AND date = ? AND json_extract(payload, '$.type') = ? AND json_extract(payload, '$.questionId') = ?)", [owner, r.practiceDate, r.attempt.question.specialty, r.questionId]);
      guard("NOT EXISTS(SELECT 1 FROM practice_records WHERE owner_id = ? AND practice_date = ? AND specialty = ? AND question_id = ?)", [owner, r.practiceDate, r.attempt.question.specialty, r.questionId]);
    }
    const payload = canonicalJson(r);
    statements.push(db.prepare("INSERT INTO chatgpt_import_revisions(owner_id, attempt_key, revision, fingerprint, payload, created_at) VALUES(?,?,?,?,?,?)").bind(owner, r.attemptKey, r.revision, r.fingerprint, payload, now));
    statements.push(db.prepare(`INSERT INTO chatgpt_import_records(owner_id, attempt_key, activity_id, revision, fingerprint, status, specialty, question_id, practice_date, payload, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(owner_id, attempt_key) DO UPDATE SET revision=excluded.revision, fingerprint=excluded.fingerprint, status=excluded.status, question_id=excluded.question_id, practice_date=excluded.practice_date, payload=excluded.payload, updated_at=excluded.updated_at`)
      .bind(owner, r.attemptKey, r.activityId, r.revision, r.fingerprint, r.status, r.attempt.question.specialty, r.questionId, r.practiceDate, payload, now));
  }
  statements.push(db.prepare("INSERT INTO chatgpt_import_packets(owner_id, packet_id, fingerprint, payload, receipt, created_at) VALUES(?,?,?,?,?,?)")
    .bind(owner, input.packet.packetId, fingerprint, canonicalJson(input.packet), canonicalJson(preview), now));
  try { await db.batch(statements); }
  catch {
    const saved = await existingPacket(db, owner, input.packet.packetId, fingerprint);
    if (saved) return verifyImportReceipt(db, owner, saved);
    throw new ChatgptImportError("Import was not confirmed. Preview again; any identical saved packet will return its receipt.");
  }
  return verifyImportReceipt(db, owner, preview);
}

async function verifyImportReceipt(db: Database, owner: string, receipt: ImportPreview) {
  for (const r of receipt.records) {
    const row = await db.prepare("SELECT fingerprint, payload FROM chatgpt_import_revisions WHERE owner_id = ? AND attempt_key = ? AND revision = ?").bind(owner, r.attemptKey, r.revision).first<Stored>();
    if (!row || row.fingerprint !== r.fingerprint || row.payload !== canonicalJson(r)) throw new ChatgptImportError("Import readback is incomplete. Retry the exact packet to reconcile.", 503);
  }
  return receipt;
}
