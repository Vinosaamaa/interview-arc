import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';

test('actual website GET projects private drawing and editorial additions',async()=>{
 const source=await readFile(new URL('../app/api/practice-record/route.ts',import.meta.url),'utf8');
 const body=stripTypeScriptTypes(source.replace(/^import .*;\n/gm,'')).replace('export async function GET','async function GET');
 const record={turns:[],notes:[],audioClips:[],deliveryAnalyses:[],codeAttempts:[],practiceAssets:[],practiceRecord:{revision:1},drawingAddition:{revision:1,authorship:'assistant_reference',downloadUrl:'/private-drawing'},editorialAddition:{revision:2,explanation:'Source-grounded explanation'},interactionModeTransitions:[],interactionModeClassification:{mode:'mentor'}};
 const calls=[];
 const GET=new Function('readActivityPracticeRecord','resolveOwnerId','codeAttemptReviewForDisplay','toRouteErrorMessage',body+'\nreturn GET;')(async(...args)=>{calls.push(args);return record;},async()=> 'owner-a',x=>x,e=>e.message);
 const response=await GET(new Request('https://arc.example/api/practice-record?activityId=synthetic'));
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
 const payload=await response.json();assert.deepEqual(calls,[['owner-a','synthetic']]);
 for(const key of ['drawingAddition','editorialAddition','practiceRecord','interactionModeTransitions','interactionModeClassification'])assert.deepEqual(payload[key],record[key]);
});
