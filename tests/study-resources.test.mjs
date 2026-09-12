import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { boundedResourceStream } from '../db/study-resource-body.ts';
import { resourceHash } from '../db/study-resource-policy.ts';
import { saveStudyResource, getStudyResource, searchStudyResources, readStudyOriginal, linkStudyResource } from '../db/study-resources.ts';
import { registerStudyResourceTools } from '../mcp-worker/study-resource-tools.ts';
import { resourceText, resourceHtml, resourcePng, resourcePdf } from './fixtures/study-resource-content.mjs';
test('upload stream preserves bytes at the limit and rejects oversized input; hashes respect view boundaries', async () => {
  const bytes = new Uint8Array([90, 1, 2, 3, 91]);
  const view = bytes.subarray(1, 4);
  assert.equal(await resourceHash(view), await resourceHash(new Uint8Array([1, 2, 3])));
  const allowed = boundedResourceStream(new Response(view).body, 3);
  assert.deepEqual(new Uint8Array(await new Response(allowed.stream).arrayBuffer()), view);
  assert.equal(allowed.exceeded(), false);
  let cancelled = false;
  const source = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array([1, 2])); }, cancel() { cancelled = true; } });
  const rejected = boundedResourceStream(source, 3);
  await assert.rejects(new Response(rejected.stream).arrayBuffer(), /exceeds/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rejected.exceeded(), true);
  assert.equal(cancelled, true);
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
      return { size: bytes.byteLength, body: new Response(part).body, async arrayBuffer() { return bytes.slice().buffer; } }; },
  };
}

const bytes = s => new TextEncoder().encode(s);
const input = { operationId: 'synthetic-upload', title: 'Original study source' };
test('exact originals and every text fragment survive retry, changed uploads and owner isolation', async t => {
 const { db } = database(t), r2 = bucket();
 const first = await saveStudyResource(db,r2,'a',input,{name:'notes.md',bytes:bytes(resourceText)});
 const id = first.resource.resourceId;
 assert.equal((await saveStudyResource(db,r2,'a',input,{name:'notes.md',bytes:bytes(resourceText)})).duplicate,true);
 await assert.rejects(saveStudyResource(db,r2,'a',input,{name:'notes.md',bytes:bytes('Changed')}),/different content/);
 assert.equal(new TextDecoder().decode(await (await readStudyOriginal(db,r2,'a',id)).object.arrayBuffer()),resourceText);
 let chunk=0, text='';do {const page=await getStudyResource(db,'a',id,chunk,first.resource.sourceSha256);text+=page.fragment.text;chunk=page.nextChunk;} while(chunk!==null);
 assert.equal(text,resourceText);
 await assert.rejects(getStudyResource(db,'a',id,1),/exact sourceSha256/);
 await assert.rejects(getStudyResource(db,'a',id,1,'0'.repeat(64)),/exact sourceSha256/);
 await assert.rejects(getStudyResource(db,'b',id),/not found/);
 await assert.rejects(readStudyOriginal(db,r2,'b',id),/not found/);
 assert.equal((await searchStudyResources(db,'b')).resources.length,0);
 assert.equal((await searchStudyResources(db,'a','return 42')).resources.length,1);
 r2.objects.clear();
 await saveStudyResource(db,r2,'a',input,{name:'notes.md',bytes:bytes(resourceText)});
 assert.equal(r2.objects.size,1,'exact retry repairs missing original');
});
test('HTML preserves hidden detail/code, PDF preserves page text, binary originals stay explicit', async t => {
 const { db }=database(t),r2=bucket();
 for (const [name,source,expected] of [['page.html',bytes(resourceHtml),'Collapsed but preserved.'],['paper.pdf',resourcePdf(),'Synthetic complete PDF text']]) {
  const saved=await saveStudyResource(db,r2,'a',{...input,operationId:name},{name,bytes:source});
  const read=await getStudyResource(db,'a',saved.resource.resourceId);
  assert.ok(read.fragment,JSON.stringify(read));assert.ok(read.fragment.text.includes(expected));
  assert.deepEqual(new Uint8Array(await (await readStudyOriginal(db,r2,'a',saved.resource.resourceId)).object.arrayBuffer()),new Uint8Array(source));
  if(name.endsWith('html')){assert.ok(read.fragment.text.includes('if (a < b) {\n  return 42;'));assert.ok(!read.fragment.text.includes('NEVER_EXECUTE'));}
  else assert.equal(read.fragment.location,'Page 1');
 }
 const binary=await saveStudyResource(db,r2,'a',{...input,operationId:'binary'},{name:'archive.zip',bytes:new Uint8Array([1,2,3])});
 const read=await getStudyResource(db,'a',binary.resource.resourceId);assert.equal(read.fragment,null);assert.equal(read.resource.method,'original-only');assert.ok(read.resource.warnings.length);
});
test('connector returns actual image/original bytes and links page copies only within owner', async t => {
 const { db }=database(t),r2=bucket(),tools=new Map();
 registerStudyResourceTools({registerResource(){},registerTool(name,config,handler){tools.set(name,{config,handler});}},db,r2,'a');
 const saved=await saveStudyResource(db,r2,'a',input,{name:'page.png',bytes:resourcePng});
 const image=await tools.get('get_study_resource_image').handler({resourceId:saved.resource.resourceId});
 assert.equal(image.content[1].type,'image');assert.deepEqual(Buffer.from(image.content[1].data,'base64'),resourcePng);
 const original=await tools.get('get_study_resource_original').handler({resourceId:saved.resource.resourceId});
 assert.deepEqual(Buffer.from(original.content[1].resource.blob,'base64'),resourcePng);
 const parent=await saveStudyResource(db,r2,'a',{...input,operationId:'parent'},{name:'paper.pdf',bytes:resourcePdf()});
 const link={resourceId:saved.resource.resourceId,target:'resource',targetId:parent.resource.resourceId,revision:1};
 assert.equal((await linkStudyResource(db,'a',link)).linked,true);
 assert.equal((await linkStudyResource(db,'a',link)).duplicate,true);
 await assert.rejects(linkStudyResource(db,'b',link),/not found/);
 assert.equal((await getStudyResource(db,'a',parent.resource.resourceId)).readingCopies[0].resourceId,saved.resource.resourceId);
 assert.deepEqual(tools.get('save_study_resource_file').config._meta['openai/fileParams'],['file']);
 const denied=await tools.get('save_study_resource_file').handler({...input,file:{download_url:'https://example.test/private',file_id:'file',file_name:'note.txt'}});
 assert.equal(denied.isError,true);assert.match(denied.content[0].text,/supported file download/);
});
