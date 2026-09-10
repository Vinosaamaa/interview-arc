import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {openCodingDraft,readCodingDraft,saveCodingDraft,codingSha256} from '../db/coding-drafts.ts';
import {submitCodingDraft,readCodingSubmission} from '../mcp-worker/coding-judge.ts';
import {codingWidgetHtml} from '../mcp-worker/coding-widget.ts';

function database(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../drizzle/0055_chatgpt_coding_drafts.sql',import.meta.url),'utf8'));
 const prepare=sql=>{let args=[];return {bind(...a){args=a;return this;},async first(){return sqlite.prepare(sql).get(...args)??null;},async run(){return sqlite.prepare(sql).run(...args);},execute(){const stmt=sqlite.prepare(sql);return stmt.columns().length?stmt.all(...args):stmt.run(...args);}};};
 return {sqlite,db:{prepare,async batch(ops){sqlite.exec('BEGIN');try{const result=ops.map(o=>o.execute());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}}};
}
const problem={title:'Two Sum',statement:'Find the pair.',html:null,diagramText:null,questionId:null,titleSlug:'two-sum',leetcodeId:'1',url:'https://leetcode.com/problems/two-sum/'};
const credential={session:'synthetic-session',csrf:'synthetic-csrf',username:'alice',connectedAt:'2026-09-10'};
function judge(){const posts=[];let uncertain=false;return {posts,setUncertain(){uncertain=true;},async fetch(url,init){if(url.endsWith('/graphql/'))return Response.json({data:{userStatus:{isSignedIn:true,username:'alice',isPremium:false}}});if(url.endsWith('/submit/')){posts.push(JSON.parse(init.body));if(uncertain)throw Error('network lost after POST');return Response.json({submission_id:1234});}return Response.json({state:'SUCCESS',status_code:10,status_msg:'Accepted',total_correct:63,total_testcases:63});}};}
test('drafts preserve exact code and immutable revisions across reopen, replay and conflicts',async()=>{
 const {sqlite,db}=database();try{
 const original=await openCodingDraft(db,'alice','draft','java',problem,'class Solution {}');
 const input={draftId:'draft',expectedRevision:1,operationId:'edit-1',code:'class Solution {\n    // whitespace stays\n}\n'};
 const saved=await saveCodingDraft(db,'alice',input);assert.equal(saved.draft.revision,2);assert.equal(saved.draft.code,input.code);assert.equal(saved.draft.codeSha256,await codingSha256(input.code));
 assert.equal((await saveCodingDraft(db,'alice',input)).duplicate,true);
 await assert.rejects(saveCodingDraft(db,'alice',{...input,code:'different'}),/different content/);
 await assert.rejects(saveCodingDraft(db,'alice',{...input,operationId:'stale'}),/changed/);
 await assert.rejects(saveCodingDraft(db,'bob',input),/unavailable/);
 assert.equal(await readCodingDraft(db,'bob','draft'),null);
 assert.deepEqual(await readCodingDraft(db,'alice','draft',1),original);
 assert.equal((await openCodingDraft(db,'alice','draft','java',problem,'replacement')).code,input.code);
 }finally{sqlite.close();}
});
test('submission sends the exact reviewed revision once and returns real judge fields',async()=>{
 const {sqlite,db}=database(),remote=judge();try{
 const code='class Solution { public int[] twoSum(int[] a, int t) { return new int[]{0,1}; } }';
 await openCodingDraft(db,'alice','draft','java',problem,code);
 const input={draftId:'draft',expectedRevision:1,operationId:'submit-1'};
 const result=await submitCodingDraft(db,'alice',input,credential,remote.fetch);assert.equal(result.status,'complete');assert.equal(result.status_msg,'Accepted');assert.equal(result.total_correct,63);
 assert.deepEqual(remote.posts,[{lang:'java',question_id:'1',typed_code:code}]);
 await submitCodingDraft(db,'alice',input,credential,remote.fetch);
 await submitCodingDraft(db,'alice',{...input,operationId:'accidental-new-id'},credential,remote.fetch);assert.equal(remote.posts.length,1);
 await assert.rejects(readCodingSubmission(db,'bob','submit-1',credential,remote.fetch),/No submission/);
 }finally{sqlite.close();}
});
test('uncertain submissions never resend even under a new operation ID',async()=>{
 const {sqlite,db}=database(),remote=judge();remote.setUncertain();try{
 await openCodingDraft(db,'alice','draft','python3',problem,'class Solution:\n    pass\n');
 const input={draftId:'draft',expectedRevision:1,operationId:'submit-1'};
 assert.equal((await submitCodingDraft(db,'alice',input,credential,remote.fetch)).status,'uncertain');
 await submitCodingDraft(db,'alice',{...input,operationId:'retry-new-id'},credential,remote.fetch);assert.equal(remote.posts.length,1);
 assert.equal((await readCodingSubmission(db,'alice','submit-1',credential,remote.fetch)).status,'uncertain');
 }finally{sqlite.close();}
});
test('custom questions, stale revisions and expired authentication do not submit',async()=>{
 const {sqlite,db}=database(),remote=judge();try{
 await openCodingDraft(db,'alice','custom','java',{...problem,titleSlug:null,leetcodeId:null},'class Solution {}');
 await assert.rejects(submitCodingDraft(db,'alice',{draftId:'custom',expectedRevision:1,operationId:'custom'},credential,remote.fetch),/no LeetCode judge/);
 await openCodingDraft(db,'alice','draft','java',problem,'class Solution {}');
 await assert.rejects(submitCodingDraft(db,'alice',{draftId:'draft',expectedRevision:2,operationId:'stale'},credential,remote.fetch),/latest/);
 await assert.rejects(submitCodingDraft(db,'alice',{draftId:'draft',expectedRevision:1,operationId:'expired'},credential,async()=>Response.json({data:{userStatus:{isSignedIn:false}}})),/expired/);
 assert.equal(remote.posts.length,0);assert.equal(sqlite.prepare('SELECT count(*) AS n FROM coding_submissions').get().n,0);
 }finally{sqlite.close();}
});
test('coding resource script parses and remains self-contained',()=>{
 const script=codingWidgetHtml.match(/<script>([\s\S]*?)<\/script>/)[1];new Script(script);
 assert.match(codingWidgetHtml,/ui\/initialize/);assert.match(codingWidgetHtml,/ui\/message/);assert.match(codingWidgetHtml,/Your code/);assert.doesNotMatch(codingWidgetHtml,/<script\s+src=/);
});
test('judge completion requires a verdict and preserves compile errors',async()=>{
 const {sqlite,db}=database(),remote=judge();try{
 await openCodingDraft(db,'alice','draft','java',problem,'class Solution { broken }');
 const fetcher=async(url,init)=>url.endsWith('/check/')?Response.json({state:'SUCCESS'}):remote.fetch(url,init);
 const pending=await submitCodingDraft(db,'alice',{draftId:'draft',expectedRevision:1,operationId:'compile'},credential,fetcher);
 assert.equal(pending.status,'submitted');assert.equal(pending.judgeState,'pending');
 const complete=await readCodingSubmission(db,'alice','compile',credential,async()=>Response.json({state:'SUCCESS',status_code:20,status_msg:'Compile Error',compile_error:'error: expected identifier',unexpected_private_field:'omit'}));
 assert.equal(complete.status,'complete');assert.equal(complete.status_msg,'Compile Error');assert.equal(complete.compile_error,'error: expected identifier');assert.equal(complete.unexpected_private_field,undefined);assert.equal(remote.posts.length,1);
 }finally{sqlite.close();}
});
