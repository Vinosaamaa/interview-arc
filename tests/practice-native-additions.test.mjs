import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {savePracticeEditorial,readPracticeEditorial} from '../db/practice-editorial.ts';
import {savePracticeDrawing,readDrawingFile} from '../db/practice-drawing.ts';
import {exportExcalidrawScene} from '../mcp-worker/excalidraw-proxy.ts';

function database(){
  const sqlite=new DatabaseSync(':memory:');
  for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL(`../drizzle/${f}`,import.meta.url),'utf8'));
  function prepare(sql){let args=[];return {bind(...a){args=a;return this;},async first(){return sqlite.prepare(sql).get(...args)??null;},execute(){const s=sqlite.prepare(sql);return s.columns().length?s.all(...args):s.run(...args);}};}
  return {sqlite,db:{prepare,async batch(ops){sqlite.exec('BEGIN');try{const r=ops.map(o=>o.execute());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}}};
}
function seed(sqlite,id,specialty){
  const payload=JSON.stringify({prompt:{canonicalUrl:'https://leetcode.com/problems/two-sum/'},solutionLink:null,transcript:{turnCount:2}});
  sqlite.prepare('INSERT INTO practice_records(owner_id,activity_id,current_revision,specialty,question_id,title,completed_at,practice_date,solution_revision,record_fingerprint,finalization_operation_id) VALUES(?,?,1,?,?,?,?,?,NULL,?,?)').run('alice',id,specialty,'question','Synthetic',100,'2026-09-10','hash','finish-'+id);
  sqlite.prepare('INSERT INTO practice_record_revisions(owner_id,activity_id,revision,operation_id,request_fingerprint,record_fingerprint,payload,created_at) VALUES(?,?,1,?,?,?,?,1)').run('alice',id,'finish-'+id,'request','hash',payload);
  sqlite.prepare("INSERT INTO activity_finalizations(owner_id,activity_id,specialty,status,payload,revision,practice_record_revision,practice_record_fingerprint) VALUES(?,?,?,'draft','{}',1,1,'hash')").run('alice',id,specialty);
  return payload;
}

test('native editorial additions require promoted owner records and preserve immutable completion bytes',async()=>{
  const {sqlite,db}=database();
  try{
    const original=seed(sqlite,'coding','leetcode');
    const input={operationId:'editorial-1',activityId:'coding',questionId:'question',expectedRevision:0,source:'mcp',editorialUrl:'https://leetcode.com/problems/two-sum/editorial/',accessedAt:'2026-09-10T13:00:00Z',contentSha256:'a'.repeat(64),approachTitles:['Hash table'],explanation:'Synthetic attributed explanation for integration validation only.'};
    await assert.rejects(savePracticeEditorial(db,'alice',input),/completed/);
    sqlite.exec("UPDATE activity_finalizations SET status='ready'");
    await assert.rejects(savePracticeEditorial(db,'bob',input),/completed/);
    await assert.rejects(savePracticeEditorial(db,'alice',{...input,editorialUrl:'https://leetcode.com/problems/three-sum/editorial/'}),/match/);
    const saved=await savePracticeEditorial(db,'alice',input);assert.equal(saved.editorial.revision,1);
    assert.equal((await savePracticeEditorial(db,'alice',input)).duplicate,true);
    await assert.rejects(savePracticeEditorial(db,'alice',{...input,operationId:'stale'}),/not confirmed/);
    assert.equal(await readPracticeEditorial(db,'bob','coding'),null);
    assert.equal(sqlite.prepare('SELECT payload FROM practice_record_revisions').get().payload,original);
    assert.equal(sqlite.prepare('SELECT current_revision FROM practice_records').get().current_revision,1);
  }finally{sqlite.close();}
});

test('native drawing additions preserve editable source and fail closed on unpromoted or foreign records',async()=>{
  const {sqlite,db}=database();const objects=new Map();
  const bucket={async put(k,b){objects.set(k,new Uint8Array(b));},async get(k){const b=objects.get(k);return b?{size:b.length,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}:null;}};
  try{
    const original=seed(sqlite,'design','system_design');
    const scene={type:'excalidraw',version:2,elements:[{id:'label',type:'text',text:'NATIVE DRAWING QA'}],files:{}};
    let uploaded;const url=await exportExcalidrawScene(JSON.stringify(scene),async(_url,init)=>{uploaded=init.body;return Response.json({id:'native-fixture'});});
    const input={operationId:'drawing-1',activityId:'design',expectedRevision:0,url,authorship:'assistant_reference'};
    const fetcher=async()=>new Response(uploaded);
    await assert.rejects(savePracticeDrawing(db,bucket,'alice',input,fetcher),/completed/);assert.equal(objects.size,0);
    sqlite.exec("UPDATE activity_finalizations SET status='ready'");
    await assert.rejects(savePracticeDrawing(db,bucket,'bob',input,fetcher),/completed/);
    assert.equal((await savePracticeDrawing(db,bucket,'alice',input,fetcher)).saved,true);
    assert.equal((await savePracticeDrawing(db,bucket,'alice',input,()=>{throw Error('must replay');})).duplicate,true);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(await readDrawingFile(db,bucket,'alice','design',1))),scene);
    assert.equal(await readDrawingFile(db,bucket,'bob','design',1),null);
    assert.equal(sqlite.prepare('SELECT payload FROM practice_record_revisions').get().payload,original);
  }finally{sqlite.close();}
});

test('nullable-reference migration preserves existing completed record pointers byte for byte',()=>{
  const sqlite=new DatabaseSync(':memory:');
  try{
    const migrations=readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort();
    for(const f of migrations.filter(f=>f<'0054_native_deferred_references.sql'))sqlite.exec(readFileSync(new URL(`../drizzle/${f}`,import.meta.url),'utf8'));
    sqlite.exec("INSERT INTO practice_records VALUES('alice','existing',2,'leetcode','two-sum','Two Sum',100,'2026-09-10','solved',3,'record-hash','finish-existing',200)");
    const before=sqlite.prepare('SELECT * FROM practice_records').get();
    sqlite.exec(readFileSync(new URL('../drizzle/0054_native_deferred_references.sql',import.meta.url),'utf8'));
    assert.deepEqual(sqlite.prepare('SELECT * FROM practice_records').get(),before);
    assert.equal(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='practice_records_owner_date_idx'").get().name,'practice_records_owner_date_idx');
  }finally{sqlite.close();}
});
