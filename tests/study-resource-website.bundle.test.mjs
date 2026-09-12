import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { acquireMcpIntegrationLock } from './helpers/mcp-integration-lock.mjs';
import { availableMcpPort, runMcpCommand, startMcpWorker, stopMcpWorker } from './helpers/mcp-worker-harness.mjs';

test('built website preserves large multipart originals and still enforces upload boundaries', {timeout:120000}, async t => {
  const project=fileURLToPath(new URL('..',import.meta.url));
  const config=fileURLToPath(new URL('./fixtures/wrangler.study-resource-website.jsonc',import.meta.url));
  const release=await acquireMcpIntegrationLock();
  const persistence=await mkdtemp(join(tmpdir(),'arc-resource-website-'));
  let worker;
  t.after(async()=>{try{await stopMcpWorker(worker?.child);}finally{await rm(persistence,{recursive:true,force:true,maxRetries:10,retryDelay:100});await release();}});
  await runMcpCommand('wrangler',['d1','migrations','apply','DB','--local','--persist-to',persistence,'--config',config],project);
  const port=await availableMcpPort(),base=`http://127.0.0.1:${port}`;
  worker=startMcpWorker({config,persistence,project,port});
  let available=false;
  for(let i=0;i<150;i++){
    if(worker.child.exitCode!==null)throw Error(worker.readDiagnosticTail());
    try{if((await fetch(base+'/api/study-resources')).ok){available=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(available,true,worker.readDiagnosticTail());
  const send=(bytes,operationId,origin=base)=>{
    const form=new FormData();form.set('file',new Blob([bytes]),'synthetic-original.bin');form.set('title','Synthetic large original');form.set('operationId',operationId);
    return fetch(base+'/api/study-resources',{method:'POST',headers:{origin},body:form});
  };
  const bytes=Buffer.alloc(2*1024*1024,37);bytes[bytes.length-1]=92;
  const response=await send(bytes,'large-original');
  assert.equal(response.status,201,await response.clone().text());
  const saved=await response.json();
  assert.equal(saved.resource.sourceSha256,createHash('sha256').update(bytes).digest('hex'));
  const original=await fetch(`${base}/api/study-resources?resourceId=${saved.resource.resourceId}&original=1`);
  assert.deepEqual(Buffer.from(await original.arrayBuffer()),bytes);
  const retry=await send(bytes,'large-original');
  assert.equal(retry.status,200);assert.equal((await retry.json()).resource.resourceId,saved.resource.resourceId);
  // Origin validation precedes body parsing. Probe it without an unread body:
  // the local proxy can otherwise break the next request after early rejection.
  // Accepted and oversized multipart bodies are exercised separately here.
  const foreign=await fetch(base+'/api/study-resources',{method:'POST',headers:{origin:'https://unrelated.example'}});
  assert.equal(foreign.status,403,await foreign.text());
  // Read the complete oversized-file rejection with a native HTTP client.
  // The whole multipart body remains below the separate request-body limit.
  const oversizedForm=new FormData();oversizedForm.set('file',new Blob([Buffer.alloc(25*1024*1024+1,37)]),'oversized.bin');
  const encoded=new Response(oversizedForm),body=Buffer.from(await encoded.arrayBuffer());
  const oversized=await new Promise((resolve,reject)=>{
    let received=false;
    const req=request(base+'/api/study-resources',{method:'POST',headers:{origin:base,'content-type':encoded.headers.get('content-type'),'content-length':body.length}},res=>{
      received=true;const parts=[];res.on('data',part=>parts.push(part));res.on('error',error=>reject(Error(`HTTP ${res.statusCode}: ${error.message}; ${Buffer.concat(parts).toString()}\n${worker.readDiagnosticTail()}`)));res.on('end',()=>resolve({status:res.statusCode,text:Buffer.concat(parts).toString()}));
    });
    req.on('error',error=>{if(!received)reject(Error(error.message+'\n'+worker.readDiagnosticTail()));});req.end(body);
  });
  assert.equal(oversized.status,413,oversized.text+'\n'+worker.readDiagnosticTail());assert.match(JSON.parse(oversized.text).error,/25 MB|supported size/);
  const list=await (await fetch(base+'/api/study-resources')).json();
  assert.equal(list.resources.length,1,'failed and retried uploads do not create extra resources');
});
