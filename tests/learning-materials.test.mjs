import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { publishLearningMaterial,getLearningMaterial,listLearningMaterials,getLearningMaterialSource } from '../db/learning-materials.ts';
import { saveStudyResource,getStudyResource,readStudyOriginal } from '../db/study-resources.ts';
import { registerLearningMaterialTools } from '../mcp-worker/learning-material-tools.ts';
import { importLearningSource, publicSourceUrl } from '../db/learning-source-import.ts';

function fixture(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 function prepare(sql){let args=[];return {bind(...v){args=v;return this;},async first(){return sqlite.prepare(sql).get(...args)??null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return {meta:sqlite.prepare(sql).run(...args)};}};}
 const db={prepare,async batch(list){sqlite.exec('BEGIN');try{const result=[];for(const s of list)result.push(await s.run());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const objects=new Map(),bucket={async put(k,b){objects.set(k,new Uint8Array(b).slice());},async head(k){return objects.has(k)?{size:objects.get(k).length}:null;},async get(k){const b=objects.get(k);return b?{size:b.length,body:new Response(b).body,async arrayBuffer(){return b.slice().buffer;}}:null;}};
 return {db,bucket,objects};
}
const summary={overview:'A detailed source-grounded overview explains the entire synthetic lesson and its intended use.',sections:[{heading:'How retries work',body:'The source explains why retrying a timed-out request needs a stable operation identity. The saved response is returned for the exact same payload. Changed payloads are rejected to preserve earlier work.',sourceLocation:'00:00–04:30'}],keyNotes:['Keep the same operation identity when retrying.','Use a new identity when changing the material.']};
async function source(f,owner='a',operationId='source'){return saveStudyResource(f.db,f.bucket,owner,{operationId,title:'Synthetic complete source'},{name:'lesson.txt',bytes:new TextEncoder().encode('00:00 Stable operations preserve intent.\n'.repeat(600)+'04:30 LAST SOURCE LINE')});}
const input=s=>({operationId:'publish-test',title:'Understanding retries',kind:'youtube',sourceUrl:'https://www.youtube.com/watch?v=synthetic01',resourceId:s.resource.resourceId,sourceSha256:s.resource.sourceSha256,coverage:'complete',limitations:[],summary});
test('publication keeps full source, exact retries replay, changed writes and other owners fail',async t=>{
 const f=fixture(t),s=await source(f),v=input(s),first=await publishLearningMaterial(f.db,f.bucket,'a',v);
 assert.equal(first.duplicate,false);assert.match(first.url,/learn=materials/);assert.equal((await publishLearningMaterial(f.db,f.bucket,'a',v)).duplicate,true);
 await assert.rejects(publishLearningMaterial(f.db,f.bucket,'a',{...v,title:'Changed'}),/different material/);
 await assert.rejects(publishLearningMaterial(f.db,f.bucket,'b',v),/not found/);
 await assert.rejects(getLearningMaterial(f.db,'b',first.materialId),/not found/);
 assert.equal((await listLearningMaterials(f.db,'b')).materials.length,0);
 assert.deepEqual((await getLearningMaterial(f.db,'a',first.materialId)).summary,summary);
 const found=await listLearningMaterials(f.db,'a','stable operation');assert.equal(found.materials.length,1);
 let next=0,text='';do{const page=await getStudyResource(f.db,'a',s.resource.resourceId,next,s.resource.sourceSha256);text+=page.fragment.text;next=page.nextChunk;}while(next!==null);
 assert.ok(text.endsWith('LAST SOURCE LINE'));assert.equal(text,new TextDecoder().decode(await (await readStudyOriginal(f.db,f.bucket,'a',s.resource.resourceId)).object.arrayBuffer()));
 const full=await getLearningMaterialSource(f.db,'a',first.materialId);assert.equal(full.fragments.map(f=>f.text).join(''),text);assert.equal(full.nextChunk,null);
 await assert.rejects(getLearningMaterialSource(f.db,'b',first.materialId),/not found/);
});
test('source integrity, required coverage and URL identity are validated before publication',async t=>{
 const f=fixture(t),v=input(await source(f));
 await assert.rejects(publishLearningMaterial(f.db,f.bucket,'a',{...v,sourceSha256:'0'.repeat(64)}),/identity|sourceSha256/);
 await assert.rejects(publishLearningMaterial(f.db,f.bucket,'a',{...v,coverage:'partial'}));
 await assert.rejects(publishLearningMaterial(f.db,f.bucket,'a',{...v,sourceUrl:'javascript:alert(1)'}));
 await assert.rejects(publishLearningMaterial(f.db,f.bucket,'a',{...v,sourceUrl:'https://example.com'}),/YouTube/);
 f.objects.clear();await assert.rejects(publishLearningMaterial(f.db,f.bucket,'a',v));assert.equal((await listLearningMaterials(f.db,'a')).materials.length,0);
});
test('ChatGPT tool flow saves exact transcript, publishes detailed notes, and reads them back',async t=>{
 const f=fixture(t),tools=new Map();registerLearningMaterialTools({registerTool(n,c,h){tools.set(n,{config:c,handler:h});}},f.db,f.bucket,'a');
 const text='00:00\nThe original complete transcript is separate from the summary.\n01:20\nPreserve every word.';
 const saved=await tools.get('save_learning_source_text').handler({operationId:'chat-upload',title:'Transcript',text});assert.ok(!saved.isError);
 const v={...input(saved.structuredContent),coverage:'partial',limitations:['This synthetic fixture covers two timestamped passages.']};
 const published=await tools.get('publish_learning_material').handler(v);assert.ok(!published.isError,JSON.stringify(published));
 const read=await tools.get('query_learning_materials').handler({materialId:published.structuredContent.materialId});assert.deepEqual(read.structuredContent.summary,summary);
 assert.equal((await getStudyResource(f.db,'a',v.resourceId)).fragment.text,text);
 const changed=await tools.get('publish_learning_material').handler({...v,summary:{...summary,overview:'Changed summary must not replace any previously published source or notes.'}});assert.equal(changed.isError,true);
});
test('public URL intake preserves article bytes and refuses credentials, private targets and video descriptions',async t=>{
 const f=fixture(t),html='<!doctype html><h1>All details</h1><details><summary>More</summary>Exact hidden example.</details>';
 const imported=await importLearningSource(f.db,f.bucket,'a',{operationId:'article-url',title:'Article',url:'https://example.com/article'},async(url,options)=>{assert.equal(options.redirect,'manual');assert.equal(options.headers.Cookie,undefined);return new Response(html,{headers:{'content-type':'text/html'}});});
 assert.equal(new TextDecoder().decode(await (await readStudyOriginal(f.db,f.bucket,'a',imported.resource.resourceId)).object.arrayBuffer()),html);
 for(const url of ['https://127.0.0.1','https://user:pass@example.com','http://example.com','https://localhost','https://[::1]'])assert.throws(()=>publicSourceUrl(url));
 await assert.rejects(importLearningSource(f.db,f.bucket,'a',{operationId:'youtube',title:'Video',url:'https://www.youtube.com/watch?v=synthetic01'},async()=>new Response('<p>Description only.</p>')),/actual captions/);
});
test('public video captions preserve complete WebVTT and unavailable or redirected tracks fail closed',async t=>{
 const f=fixture(t),vtt='WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nExact first words.\n\n00:59:59.000 --> 01:00:00.000\nExact final words.\n';
 const track={baseUrl:'https://www.youtube.com/api/timedtext?v=synthetic01&sig=synthetic',languageCode:'en',kind:'asr'};
 const v={operationId:'video-captions',title:'Video',url:'https://youtu.be/synthetic01'};
 const saved=await importLearningSource(f.db,f.bucket,'a',v,async(url,opts)=>{assert.equal(opts.redirect,'manual');return String(url).includes('/watch?')?new Response(JSON.stringify({captionTracks:[track]})):new Response(vtt);});
 assert.equal(saved.automatic,true);assert.equal(saved.resource.filename,'youtube-captions.vtt');assert.equal((await getStudyResource(f.db,'a',saved.resource.resourceId)).fragment.text,vtt);
 await assert.rejects(importLearningSource(f.db,f.bucket,'a',{...v,operationId:'bad-caption'},async()=>new Response(JSON.stringify({captionTracks:[{...track,baseUrl:'https://private.example/secret'}]}))),/not publicly retrievable/);
});

