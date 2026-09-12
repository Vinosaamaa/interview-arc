import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { saveLecture, readLecture, listLectures, saveLectureCursor } from '../db/lectures.ts';
import { chunkLecture, lectureSectionsFromMarkdown } from '../db/lecture-policy.ts';
import { generateLectureAudio } from '../db/lecture-audio.ts';
import { openLecturePlayer, routeLectureMedia } from '../mcp-worker/lecture-player-tools.ts';
import { lectureWavHeader, streamLecture } from '../db/lecture-stream.ts';

test('script chapters preserve fenced code, nested shorter fences and unfinished examples', () => {
  const example = '````md\n# A code example\n```\n## Still code\n````';
  const source = '# First\nBefore\n' + example + '\nAfter\n## Second\n~~~text\n# Tilde example\n~~~\nDone';
  const sections = lectureSectionsFromMarkdown(source);
  assert.deepEqual(sections.map(s => s.title), ['First', 'Second']);
  assert.equal(sections[0].text, 'Before\n' + example + '\nAfter');
  assert.equal(sections[1].text, '~~~text\n# Tilde example\n~~~\nDone');
  assert.equal(lectureSectionsFromMarkdown('# Start\n```\n# Unfinished')[0].text, '```\n# Unfinished');
});

function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  for (const name of readdirSync(new URL('../drizzle/', import.meta.url)).filter(n => n.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(`../drizzle/${name}`, import.meta.url), 'utf8'));
  function prepare(sql) {
    let args = [];
    return { bind(...values) { args = values; return this; },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...args), success: true }; },
      async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }; },
      execute() { const statement = sqlite.prepare(sql); return statement.columns().length ? statement.all(...args) : statement.run(...args); } };
  }
  return { sqlite, db: { prepare, async batch(statements) {
    sqlite.exec('BEGIN IMMEDIATE');
    try { const result = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } } };
}
function bucket() {
  const objects = new Map(), reads = [];
  return { objects, reads,
    async head(key) { return objects.has(key) ? { size: objects.get(key).byteLength } : null; },
    async put(key, bytes) { objects.set(key, new Uint8Array(bytes).slice()); },
    async delete(key) { objects.delete(key); },
    async get(key, options) { reads.push(key); const bytes = objects.get(key); if (!bytes) return null;
      const range = options?.range; const part = range ? bytes.slice(range.offset, range.offset + range.length) : bytes;
      return { size: bytes.byteLength, body: new Response(part).body }; },
  };
}
const input = { lectureId: 'synthetic-lecture', title: 'Synthetic lecture', sources: [{ label: 'Public reference', url: 'https://example.com/reference' }], sections: [{ id: 'intro', title: 'Introduction', text: 'Original synthetic lecture script.' }] };
const cursor = { lectureId: input.lectureId, operationId: 'cursor-one', expectedRevision: 0, chunkIndex: 0, offsetSeconds: 1, characterOffset: 2 };

test('immutable private scripts survive exact retries and reject changes; chunking preserves all text', async t => {
  const { db } = database(t);
  const first = await saveLecture(db, 'owner-a', input);
  assert.equal((await saveLecture(db, 'owner-a', input)).duplicate, true);
  await assert.rejects(saveLecture(db, 'owner-a', { ...input, title: 'Changed' }), /different script/);
  assert.equal((await readLecture(db, 'owner-a', input.lectureId)).fingerprint, first.fingerprint);
  assert.deepEqual(await listLectures(db, 'owner-b'), []);
  await assert.rejects(readLecture(db, 'owner-b', input.lectureId), /not found/);
  await saveLecture(db, 'owner-b', { ...input, title: 'Independent owner' });
  assert.equal((await readLecture(db, 'owner-a', input.lectureId)).title, input.title);
  const text = ('A detailed example 😀 followed by a calculation.\n').repeat(400);
  const chunks = chunkLecture({ ...input, sections: [{ ...input.sections[0], text }] });
  assert.equal(chunks.map(c => c.text).join(''), text);
  assert.ok(chunks.every(c => c.text.length <= 3500 && !/[\uD800-\uDBFF]$/.test(c.text)));
});

test('cursor retries are exact and concurrent stale writers cannot overwrite a confirmed position', async t => {
  const { db } = database(t); await saveLecture(db, 'owner-a', input);
  const results = await Promise.allSettled([saveLectureCursor(db, 'owner-a', cursor), saveLectureCursor(db, 'owner-a', { ...cursor, operationId: 'competing', offsetSeconds: 2 })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const saved = await readLecture(db, 'owner-a', input.lectureId);
  assert.equal(saved.cursor.revision, 1);
  assert.equal((await saveLectureCursor(db, 'owner-a', cursor)).duplicate, true);
  await assert.rejects(saveLectureCursor(db, 'owner-a', { ...cursor, offsetSeconds: 9 }), /different cursor/);
  await assert.rejects(saveLectureCursor(db, 'owner-a', { ...cursor, operationId: 'stale' }), /changed in another/);
  await assert.rejects(saveLectureCursor(db, 'owner-b', cursor), /not found/);
  assert.deepEqual((await readLecture(db, 'owner-a', input.lectureId)).cursor, saved.cursor);
});

test('audio generation has a single owner-scoped lease, verified storage and retryable failures', async t => {
  const { db } = database(t), storage = bucket(); await saveLecture(db, 'owner-a', input);
  let calls = 0, release;
  const pending = new Promise(resolve => { release = resolve; });
  const provider = async (url, options) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/audio/speech');
    const request = JSON.parse(options.body); assert.equal(request.input, input.sections[0].text); assert.equal(request.response_format, 'pcm');
    await pending; return new Response(new Uint8Array(96000), { headers: { 'content-type': 'audio/pcm' } });
  };
  const first = generateLectureAudio(db, storage, 'owner-a', input.lectureId, 0, 'synthetic-key', provider);
  while (!calls) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(generateLectureAudio(db, storage, 'owner-a', input.lectureId, 0, 'synthetic-key', provider), /already being prepared/);
  release(); await first;
  assert.equal((await generateLectureAudio(db, storage, 'owner-a', input.lectureId, 0, undefined, provider)).duplicate, true);
  assert.equal(calls, 1);
  const view = await readLecture(db, 'owner-a', input.lectureId);
  assert.equal(view.chunks[0].audio.duration_seconds, 2);
  assert.ok(!JSON.stringify(view).includes('object_key'));
  await assert.rejects(generateLectureAudio(db, storage, 'owner-b', input.lectureId, 0, 'synthetic-key', provider), /not found/);
  await assert.rejects(saveLectureCursor(db, 'owner-a', { ...cursor, offsetSeconds: 3 }), /outside this chunk/);
  storage.objects.clear();
  await assert.rejects(generateLectureAudio(db, storage, 'owner-a', input.lectureId, 0, undefined, provider), /not configured/);
  await assert.rejects(generateLectureAudio(db, storage, 'owner-a', input.lectureId, 0, 'synthetic-key', async () => new Response('bad', { status: 429 })), /rate limited/);
  await generateLectureAudio(db, storage, 'owner-a', input.lectureId, 0, 'synthetic-key', provider);
  assert.equal(storage.objects.size, 1);
});

test('one seekable WAV crosses chunk boundaries, handles suffix/HEAD/range errors, and denies other owners', async t => {
  const { db } = database(t), storage = bucket();
  await saveLecture(db, 'owner-a', { ...input, sections: [...input.sections, { id: 'end', title: 'Conclusion', text: 'The ending.' }] });
  for (let i = 0; i < 2; i++) await generateLectureAudio(db, storage, 'owner-a', input.lectureId, i, 'synthetic-key', async () => new Response(Uint8Array.from([i + 1, 0, i + 2, 0]), { headers: { 'content-type': 'audio/pcm' } }));
  const request = (range, method = 'GET') => new Request('https://example.test/audio', { method, headers: range ? { range } : {} });
  const full = await streamLecture(db, storage, 'owner-a', input.lectureId, request());
  const bytes = new Uint8Array(await full.arrayBuffer());
  assert.equal(bytes.length, 52); assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF');
  assert.deepEqual([...bytes.slice(44)], [1, 0, 2, 0, 2, 0, 3, 0]);
  const crossing = await streamLecture(db, storage, 'owner-a', input.lectureId, request('bytes=46-49'));
  assert.equal(crossing.status, 206); assert.equal(crossing.headers.get('content-range'), 'bytes 46-49/52');
  assert.deepEqual([...new Uint8Array(await crossing.arrayBuffer())], [2, 0, 2, 0]);
  const suffix = await streamLecture(db, storage, 'owner-a', input.lectureId, request('bytes=-2'));
  assert.deepEqual([...new Uint8Array(await suffix.arrayBuffer())], [3, 0]);
  const count = storage.reads.length;
  assert.equal((await streamLecture(db, storage, 'owner-a', input.lectureId, request(null, 'HEAD'))).body, null);
  assert.equal(storage.reads.length, count);
  for (const range of ['bytes=52-', 'bytes=9-2', 'bytes=0-1,5-6', 'bytes=-0']) assert.equal((await streamLecture(db, storage, 'owner-a', input.lectureId, request(range))).status, 416);
  await assert.rejects(streamLecture(db, storage, 'owner-b', input.lectureId, request()), /not found/);
  const hour = new DataView(lectureWavHeader(3600 * 48000).buffer);
  assert.equal(hour.getUint32(40, true) / hour.getUint32(28, true), 3600, 'measured sample duration supports a full hour without turn boundaries');
});


test('in-chat media grants expire, bind immutable owner audio, and never enter model-visible output', async t => {
  const { db, sqlite } = database(t), storage = bucket();
  await saveLecture(db, 'owner-a', input);
  await generateLectureAudio(db, storage, 'owner-a', input.lectureId, 0, 'synthetic-key', async () => new Response(new Uint8Array(48000), { headers: { "content-type": "audio/pcm" } }));
  await assert.rejects(openLecturePlayer(db, 'owner-b', input.lectureId, true), /not found/);
  const opened = await openLecturePlayer(db, 'owner-a', input.lectureId, true);
  const url = opened._meta.audioUrl;
  assert.ok(url);
  assert.ok(!JSON.stringify(opened.content).includes('ticket='));
  assert.ok(!JSON.stringify(opened.structuredContent).includes('ticket='));
  const request = new Request(url, { method: 'HEAD' });
  assert.equal((await routeLectureMedia(db, storage, request)).status, 200);
  sqlite.exec("UPDATE professor_lecture_player_tickets SET expires_at=0");
  assert.equal((await routeLectureMedia(db, storage, request)).status, 401);
  const next = await openLecturePlayer(db, 'owner-a', input.lectureId, true);
  sqlite.exec("UPDATE professor_lectures SET fingerprint='changed'");
  assert.equal((await routeLectureMedia(db, storage, new Request(next._meta.audioUrl))).status, 401);
});
