import { LectureError } from "./lecture-policy.ts";
import { readLecture, type LectureDatabase, type LectureAudioRow } from "./lectures.ts";

type Bucket = Pick<R2Bucket, "head" | "get" | "put" | "delete">;
const audioRow = (db: LectureDatabase, owner: string, id: string, index: number) => db.prepare(
  "SELECT * FROM professor_lecture_audio WHERE owner_id=? AND lecture_id=? AND chunk_index=?",
).bind(owner, id, index).first<LectureAudioRow>();

export async function generateLectureAudio(db: LectureDatabase, bucket: Bucket, owner: string, id: string, index: number,
  apiKey: string | undefined, speechFetch: typeof fetch = fetch) {
  const lecture = await readLecture(db, owner, id, index);
  const old = await audioRow(db, owner, id, index);
  if (old?.state === "ready" && old.object_key && await bucket.head(old.object_key)) return { ready: true, duplicate: true };
  if (!apiKey) throw new LectureError("Lecture audio is not configured. The administrator must set the OPENAI_API_KEY Worker secret. Your script and saved position remain available.", 503);
  const lease = crypto.randomUUID(), now = Date.now();
  const acquired = await db.prepare(`INSERT INTO professor_lecture_audio(owner_id,lecture_id,chunk_index,state,lease_id,lease_until)
    VALUES(?,?,?,'generating',?,?) ON CONFLICT(owner_id,lecture_id,chunk_index) DO UPDATE SET
    state='generating',lease_id=excluded.lease_id,lease_until=excluded.lease_until
    WHERE (professor_lecture_audio.state!='generating' AND professor_lecture_audio.lease_id=?)
    OR (professor_lecture_audio.state='generating' AND professor_lecture_audio.lease_until<?)`)
    .bind(owner, id, index, lease, now + 180000, old?.lease_id ?? "", now).run();
  if (!acquired.meta.changes) throw new LectureError("This chunk is already being prepared. Refresh its status before retrying.");
  const key = `${owner}/lectures/${id}/${lecture.fingerprint}/${index}-${lease}.pcm`;
  let uploaded = false;
  try {
    const response = await speechFetch("https://api.openai.com/v1/audio/speech", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "cedar", response_format: "pcm", speed: 0.9,
        input: lecture.fragment.text, instructions: "Teach as a patient professor. Speak slowly and clearly, with natural sentence pauses. Read the supplied lecture faithfully without adding an introduction or conclusion." }),
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) throw new LectureError(response.status === 429 ? "Speech service is rate limited. Retry this chunk later." : "Speech generation failed. Check the provider configuration and retry this chunk.", 502);
    if (!/^(audio\/|application\/octet-stream)/.test(response.headers.get("content-type") ?? "")) throw new LectureError("Speech service returned an invalid audio response.", 502);
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength % 2 || bytes.byteLength > 32 * 1024 * 1024) throw new LectureError("Speech chunk is empty, malformed or too large.", 502);
    await bucket.put(key, bytes, { httpMetadata: { contentType: "application/octet-stream" } }); uploaded = true;
    const saved = await bucket.head(key);
    if (!saved || saved.size !== bytes.byteLength) throw new LectureError("Audio storage readback failed. Retry this chunk.", 503);
    const committed = await db.prepare(`UPDATE professor_lecture_audio SET state='ready',object_key=?,size_bytes=?,duration_seconds=?,lease_until=0
      WHERE owner_id=? AND lecture_id=? AND chunk_index=? AND state='generating' AND lease_id=?`)
      .bind(key, bytes.byteLength, bytes.byteLength / 48000, owner, id, index, lease).run();
    if (!committed.meta.changes) throw new LectureError("Generation was superseded. Refresh the lecture before retrying.");
    return { ready: true, duplicate: false };
  } catch (error) {
    if (uploaded) await bucket.delete(key).catch(() => undefined);
    await db.prepare(`UPDATE professor_lecture_audio SET state='failed',lease_until=0 WHERE owner_id=? AND lecture_id=? AND chunk_index=? AND lease_id=? AND state='generating'`)
      .bind(owner, id, index, lease).run();
    throw error instanceof LectureError ? error : new LectureError("Audio preparation was interrupted. The script is preserved; retry this chunk.", 503);
  }
}

