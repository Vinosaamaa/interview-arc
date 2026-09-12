import { LectureError } from "./lecture-policy.ts";
import { readLecture, type LectureDatabase, type LectureAudioRow } from "./lectures.ts";

export const PCM_BYTES_PER_SECOND = 48000;
export function lectureWavHeader(bytes: number) {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes % 2 || bytes > 0xffffffff - 36) throw new LectureError("Lecture audio exceeds WAV limits.", 413);
  const header = new Uint8Array(44), view = new DataView(header.buffer);
  for (const [offset, text] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]] as const) header.set(new TextEncoder().encode(text), offset);
  view.setUint32(4, bytes + 36, true); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 24000, true);
  view.setUint32(28, PCM_BYTES_PER_SECOND, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, bytes, true);
  return header;
}
export function lectureByteRange(header: string | null, size: number) {
  if (!header) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || !match[1] && !match[2]) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start < size && end >= start
    ? { start, end, partial: true } : null;
}
// One seekable WAV response spans every PCM object. Playback never needs a
// JavaScript next-track callback or a new conversational response at a boundary.
export async function streamLecture(db: LectureDatabase, bucket: Pick<R2Bucket, "get">, owner: string, id: string, request: Request) {
  const lecture = await readLecture(db, owner, id);
  const audio = (await db.prepare("SELECT * FROM professor_lecture_audio WHERE owner_id=? AND lecture_id=? ORDER BY chunk_index")
    .bind(owner, id).all<LectureAudioRow>()).results;
  if (audio.length !== lecture.chunks.length || audio.some((chunk, index) => chunk.chunk_index !== index || chunk.state !== "ready" || !chunk.object_key || !chunk.size_bytes)) {
    throw new LectureError("Prepare every section before starting continuous playback.");
  }
  const bytes = audio.reduce((sum, chunk) => sum + chunk.size_bytes!, 0), header = lectureWavHeader(bytes), size = bytes + header.length;
  const range = lectureByteRange(request.headers.get("range"), size);
  if (!range) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}`, "cache-control": "private, no-store" } });
  const headers = new Headers({ "content-type": "audio/wav", "accept-ranges": "bytes", "cache-control": "private, no-store",
    "content-length": String(range.end - range.start + 1), "content-disposition": 'inline; filename="professor-lecture.wav"' });
  if (range.partial) headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
  if (request.method === "HEAD") return new Response(null, { status: range.partial ? 206 : 200, headers });
  async function* parts() {
    if (range!.start < header.length) yield header.slice(range!.start, Math.min(header.length, range!.end + 1));
    let offset = header.length;
    for (const chunk of audio) {
      const end = offset + chunk.size_bytes! - 1;
      if (end >= range!.start && offset <= range!.end) {
        const start = Math.max(offset, range!.start), last = Math.min(end, range!.end);
        const object = await bucket.get(chunk.object_key!, { range: { offset: start - offset, length: last - start + 1 } });
        if (!object || object.size !== chunk.size_bytes) throw new LectureError("Lecture audio changed or is unavailable. Reload before resuming.", 503);
        const reader = object.body.getReader();
        try { for (;;) { const part = await reader.read(); if (part.done) break; yield part.value; } }
        finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      }
      offset = end + 1;
      if (offset > range!.end) break;
    }
  }
  const iterator = parts();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) { try { const item = await iterator.next(); if (item.done) controller.close(); else controller.enqueue(item.value); } catch (error) { controller.error(error); } },
    async cancel() { await iterator.return(undefined); },
  });
  // Workers derives Content-Length from the body and ignores a manually set
  // value for an ordinary stream. Preserve the known range length at runtime.
  const body = typeof FixedLengthStream === "function"
    ? stream.pipeThrough(new FixedLengthStream(range.end - range.start + 1)) : stream;
  return new Response(body, { status: range.partial ? 206 : 200, headers });
}
