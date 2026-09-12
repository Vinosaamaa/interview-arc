import { chunkLecture, LectureError, lectureHash, lectureWordCount, saveLectureSchema, lectureCursorSchema,
  type LectureInput, type LectureChunk, type LectureCursorInput } from "./lecture-policy.ts";

export type LectureDatabase = Pick<D1Database, "prepare" | "batch">;
type Row = { lecture_id: string; title: string; fingerprint: string; script: string; chunks: string; word_count: number;
  created_at: number; cursor_revision: number; chunk_index: number; offset_seconds: number; character_offset: number };
export type LectureAudioRow = { chunk_index: number; state: "generating" | "ready" | "failed"; lease_id: string;
  lease_until: number; object_key: string | null; size_bytes: number | null; duration_seconds: number | null };
const rowFor = (db: LectureDatabase, owner: string, id: string) => db.prepare("SELECT * FROM professor_lectures WHERE owner_id=? AND lecture_id=?").bind(owner, id).first<Row>();
export async function saveLecture(db: LectureDatabase, owner: string, value: LectureInput) {
  const input = saveLectureSchema.parse(value);
  const fingerprint = await lectureHash(input);
  const old = await rowFor(db, owner, input.lectureId);
  if (old && old.fingerprint !== fingerprint) throw new LectureError("This lecture ID already contains a different script. Save the revision under a new lecture ID; existing audio and positions are preserved.");
  const chunks = chunkLecture(input);
  if (!old) await db.prepare(`INSERT OR IGNORE INTO professor_lectures
    (owner_id,lecture_id,fingerprint,title,script,chunks,word_count,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .bind(owner, input.lectureId, fingerprint, input.title, JSON.stringify(input), JSON.stringify(chunks), lectureWordCount(input), Date.now()).run();
  const saved = await rowFor(db, owner, input.lectureId);
  if (!saved || saved.fingerprint !== fingerprint) throw new LectureError("Lecture save conflicted. Read the existing lecture before retrying.");
  return { lectureId: input.lectureId, fingerprint, duplicate: Boolean(old), chunkCount: chunks.length,
    wordCount: saved.word_count, estimatedMinutes: Math.round(saved.word_count / 120), targetMinutes: 60,
    playerUrl: `https://limitless.vinosama.workers.dev/lectures?id=${encodeURIComponent(input.lectureId)}` };
}
export async function listLectures(db: LectureDatabase, owner: string) {
  const rows = await db.prepare(`SELECT lecture_id,title,word_count,created_at,cursor_revision,chunk_index,offset_seconds
    FROM professor_lectures WHERE owner_id=? ORDER BY created_at DESC LIMIT 100`).bind(owner).all<Row>();
  return rows.results.map(row => ({ lectureId: row.lecture_id, title: row.title, wordCount: row.word_count,
    estimatedMinutes: Math.round(row.word_count / 120), targetMinutes: 60, createdAt: row.created_at }));
}
export async function readLecture(db: LectureDatabase, owner: string, id: string, chunkIndex?: number) {
  const row = await rowFor(db, owner, id);
  if (!row) throw new LectureError("Lecture not found.", 404);
  const input = JSON.parse(row.script) as LectureInput;
  const chunks = JSON.parse(row.chunks) as LectureChunk[];
  const index = chunkIndex ?? row.chunk_index;
  if (!Number.isInteger(index) || index < 0 || index >= chunks.length) throw new LectureError("Chunk is outside this lecture.", 400);
  const audio = await db.prepare(`SELECT chunk_index,state,lease_until,size_bytes,duration_seconds FROM professor_lecture_audio
    WHERE owner_id=? AND lecture_id=? ORDER BY chunk_index`).bind(owner, id).all<LectureAudioRow>();
  return { lectureId: id, title: row.title, fingerprint: row.fingerprint, sources: input.sources,
    wordCount: row.word_count, estimatedMinutes: Math.round(row.word_count / 120), targetMinutes: 60,
    chunks: chunks.map(({ text, ...chunk }) => ({ ...chunk, characterCount: text.length,
      audio: audio.results.find(item => item.chunk_index === chunk.index) ?? null })),
    fragment: chunks[index], nextChunkIndex: index + 1 < chunks.length ? index + 1 : null,
    cursor: { revision: row.cursor_revision, chunkIndex: row.chunk_index, offsetSeconds: row.offset_seconds, characterOffset: row.character_offset },
    playerUrl: `https://limitless.vinosama.workers.dev/lectures?id=${encodeURIComponent(id)}` };
}
export async function saveLectureCursor(db: LectureDatabase, owner: string, value: LectureCursorInput) {
  const input = lectureCursorSchema.parse(value);
  const fingerprint = await lectureHash(input);
  const prior = () => db.prepare("SELECT fingerprint,receipt FROM professor_lecture_operations WHERE owner_id=? AND operation_id=?")
    .bind(owner, input.operationId).first<{fingerprint: string; receipt: string}>();
  const replay = await prior();
  if (replay) {
    if (replay.fingerprint !== fingerprint) throw new LectureError("This operation ID has different cursor content.");
    return { ...JSON.parse(replay.receipt), duplicate: true };
  }
  // Autosaves need only one bounded fragment, not the full script and every
  // audio row. Keep frequent cursor validation independent of lecture length.
  const chunk = await db.prepare(`SELECT json_extract(l.chunks,?) AS text,a.duration_seconds
    FROM professor_lectures l LEFT JOIN professor_lecture_audio a
    ON a.owner_id=l.owner_id AND a.lecture_id=l.lecture_id AND a.chunk_index=?
    WHERE l.owner_id=? AND l.lecture_id=?`)
    .bind(`$[${input.chunkIndex}].text`, input.chunkIndex, owner, input.lectureId)
    .first<{ text: string | null; duration_seconds: number | null }>();
  if (!chunk) throw new LectureError("Lecture not found.", 404);
  if (chunk.text == null) throw new LectureError("Chunk is outside this lecture.", 400);
  if (input.characterOffset > chunk.text.length) throw new LectureError("Reading position is outside this chunk.", 400);
  const duration = chunk.duration_seconds;
  if (duration != null && input.offsetSeconds > duration) throw new LectureError("Playback position is outside this chunk.", 400);
  const receipt = { lectureId: input.lectureId, operationId: input.operationId, revision: input.expectedRevision + 1,
    chunkIndex: input.chunkIndex, offsetSeconds: input.offsetSeconds, characterOffset: input.characterOffset, duplicate: false };
  try {
    await db.batch([
      db.prepare(`SELECT json_extract(CASE WHEN EXISTS(SELECT 1 FROM professor_lectures WHERE owner_id=? AND lecture_id=? AND cursor_revision=?) THEN '{"ok":1}' ELSE 'invalid' END,'$.ok')`)
        .bind(owner, input.lectureId, input.expectedRevision),
      db.prepare(`UPDATE professor_lectures SET cursor_revision=cursor_revision+1,chunk_index=?,offset_seconds=?,character_offset=? WHERE owner_id=? AND lecture_id=? AND cursor_revision=?`)
        .bind(input.chunkIndex, input.offsetSeconds, input.characterOffset, owner, input.lectureId, input.expectedRevision),
      db.prepare("INSERT INTO professor_lecture_operations(owner_id,operation_id,fingerprint,receipt,created_at) VALUES(?,?,?,?,?)")
        .bind(owner, input.operationId, fingerprint, JSON.stringify(receipt), Date.now()),
    ]);
  } catch {
    const raced = await prior();
    if (raced?.fingerprint === fingerprint) return { ...JSON.parse(raced.receipt), duplicate: true };
    throw new LectureError("The saved position changed in another player or chat. Reload it before resuming; no position was overwritten.");
  }
  const saved = await prior();
  if (!saved || saved.fingerprint !== fingerprint) throw new LectureError("Cursor readback was not confirmed. Retry the identical operation.", 503);
  return JSON.parse(saved.receipt);
}
