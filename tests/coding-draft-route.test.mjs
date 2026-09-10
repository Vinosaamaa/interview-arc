import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';
import {CodingDraftConflictError} from '../db/coding-drafts.ts';

test('browser draft endpoint binds owner, rejects cross-origin saves and preserves exact payload',async()=>{
 const source=await readFile(new URL('../app/api/coding-draft/route.ts',import.meta.url),'utf8');
 const body=stripTypeScriptTypes(source.replace(/^import .*;\n/gm,'')).replaceAll('export async function','async function');
 const calls=[];
 const route=new Function('env','resolveOwnerId','readCodingDraft','saveCodingDraft','readBoundedJson','CodingDraftConflictError',body+'\nreturn {GET,POST};')({DB:'db'},async()=> 'alice',async(db,owner,id)=>{calls.push({db,owner,id});return id==='mine'?{draftId:id,revision:1}:null;},async(db,owner,input)=>{calls.push({db,owner,input});if(input.operationId==='stale')throw new CodingDraftConflictError({draftId:'mine',revision:2,code:'newer'});return {saved:true,draft:input};},async request=>request.json(),CodingDraftConflictError);
 const response=await route.GET(new Request('https://arc.example/api/coding-draft?draftId=mine'));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.deepEqual(calls.pop(),{db:'db',owner:'alice',id:'mine'});
 assert.equal((await route.GET(new Request('https://arc.example/api/coding-draft?draftId=foreign'))).status,404);
 const input={draftId:'mine',expectedRevision:1,operationId:'edit',code:'class Solution {\n}\n'};
 const request=origin=>new Request('https://arc.example/api/coding-draft',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)});
 assert.equal((await route.POST(request('https://other.example'))).status,403);
 assert.equal((await route.POST(request('https://arc.example'))).status,200);assert.deepEqual(calls.pop(),{db:'db',owner:'alice',input});
 input.operationId='stale';const conflict=await route.POST(request('https://arc.example'));assert.equal(conflict.status,409);assert.deepEqual((await conflict.json()).latest,{draftId:'mine',revision:2,code:'newer'});
});
