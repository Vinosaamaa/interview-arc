import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync,readdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { savePracticeDrawing,readPracticeDrawing,readDrawingFile } from "../db/practice-drawing.ts";
function database(){const sqlite=new DatabaseSync(":memory:");for(const f of readdirSync(new URL("../drizzle/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../drizzle/${f}`,import.meta.url),"utf8"));function prepare(sql){let args=[];return {bind(...a){args=a;return this;},async first(){return sqlite.prepare(sql).get(...args)??null;},execute(){const s=sqlite.prepare(sql);return s.columns().length?s.all(...args):s.run(...args);}};}return {sqlite,db:{prepare,async batch(ops){sqlite.exec("BEGIN");try{const r=ops.map(o=>o.execute());sqlite.exec("COMMIT");return r;}catch(e){sqlite.exec("ROLLBACK");throw e;}}}};}
function frame(...pieces){const v=Buffer.alloc(4);v.writeUInt32BE(1);return Buffer.concat([v,...pieces.flatMap(p=>{const n=Buffer.alloc(4);n.writeUInt32BE(p.length);return [n,p];})]);}
async function snapshot(){const source={type:"excalidraw",version:2,elements:[{type:"text",text:"Original diagram"}],files:{asset:{dataURL:"data:image/png;base64,c3ludGhldGlj"}}};const key=await crypto.subtle.generateKey({name:"AES-GCM",length:128},true,["encrypt"]);const iv=crypto.getRandomValues(new Uint8Array(12));const data=deflateSync(frame(Buffer.from("{}"),Buffer.from(JSON.stringify(source))));const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,data);const bytes=frame(Buffer.from(JSON.stringify({version:2,compression:"pako@1",encryption:"AES-GCM"})),iv,Buffer.from(encrypted));return {source,url:`https://excalidraw.com/#json=synthetic,${(await crypto.subtle.exportKey("jwk",key)).k}`,fetcher:async()=>new Response(bytes)};}
test("publishing retains editable bytes, image data and immutable owner-scoped drawing receipts",async()=>{
 const {db,sqlite}=database();const store=new Map();const bucket={async put(k,b){store.set(k,new Uint8Array(b));},async get(k){const b=store.get(k);return b?{size:b.length,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}:null;}};
 try {
  sqlite.exec("INSERT INTO chatgpt_import_records(owner_id,attempt_key,activity_id,revision,fingerprint,status,specialty,question_id,practice_date,payload,updated_at) VALUES('alice','attempt','activity',1,'fingerprint','completed','system_design','question','2026-09-10','{}',1)");
  const f=await snapshot();const input={operationId:"save1",activityId:"activity",expectedRevision:0,url:f.url,authorship:"owner"};
  await assert.rejects(savePracticeDrawing(db,bucket,"bob",input,f.fetcher),/completed/);assert.equal(store.size,0);
  const result=await savePracticeDrawing(db,bucket,"alice",input,f.fetcher);assert.equal(result.saved,true);assert.equal(result.drawing.revision,1);assert.equal(result.drawing.objectKey,undefined);
  assert.equal(await readPracticeDrawing(db,"bob","activity"),null);assert.equal(await readDrawingFile(db,bucket,"bob","activity",1),null);
  const bytes=await readDrawingFile(db,bucket,"alice","activity",1);assert.deepEqual(JSON.parse(new TextDecoder().decode(bytes)),f.source);
  assert.equal((await savePracticeDrawing(db,bucket,"alice",input,()=>{throw Error("must not refetch");})).duplicate,true);
  await assert.rejects(savePracticeDrawing(db,bucket,"alice",{...input,authorship:"assistant_reference"},f.fetcher),/different/);
  await assert.rejects(savePracticeDrawing(db,bucket,"alice",{...input,operationId:"stale"},f.fetcher),/not confirmed/);
  const next=await savePracticeDrawing(db,bucket,"alice",{...input,operationId:"revision2",expectedRevision:1,authorship:"assistant_reference"},f.fetcher);assert.equal(next.drawing.revision,2);assert.equal((await readPracticeDrawing(db,"alice","activity",1)).authorship,"owner");
  store.set([...store.keys()][0],new Uint8Array(bytes.byteLength));await assert.rejects(readDrawingFile(db,bucket,"alice","activity",1),/integrity/);
 }finally{sqlite.close();}
});
