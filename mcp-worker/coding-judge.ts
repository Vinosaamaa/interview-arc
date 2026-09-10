import { type CodingDatabase, readCodingDraft } from "../db/coding-drafts.ts";
import { LeetcodeAccountError, type LeetcodeCredential, verifyLeetcodeSession } from "./leetcode-account.ts";

type SubmissionRow = { operation_id:string; draft_id:string; draft_revision:number; code_sha256:string; status:string; submission_id:number|null; payload:string };
// LeetCode owns execution. This module never runs untrusted Java/Python on Arc.
async function requestJudge(path:string, credential:LeetcodeCredential, body:object|undefined, fetcher:typeof fetch) {
  const response=await fetcher(`https://leetcode.com${path}`,{
    method:body ? "POST":"GET",redirect:"manual",signal:AbortSignal.timeout(15000),
    headers:{"Content-Type":"application/json",Origin:"https://leetcode.com",Referer:"https://leetcode.com/",Cookie:`LEETCODE_SESSION=${credential.session}; csrftoken=${credential.csrf}`,"x-csrftoken":credential.csrf},
    ...(body?{body:JSON.stringify(body)}:{}),
  });
  if(!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
    throw new LeetcodeAccountError("LeetCode did not confirm the request. Reconnect if signed out; hosted requests may also be blocked.");
  }
  if(!response.body)throw new Error("Empty judge response");
  const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>256000){await reader.cancel();throw new Error("Judge response too large");}chunks.push(value);}}
  finally{reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
const receipt=(row:SubmissionRow)=>({operationId:row.operation_id,draftId:row.draft_id,draftRevision:row.draft_revision,codeSha256:row.code_sha256,status:row.status,submissionId:row.submission_id,...(row.status==="reserved"?{message:"Submission is in progress or its confirmation was interrupted. Do not resend this revision; check your recent LeetCode submissions if it remains unconfirmed."}:{}),...JSON.parse(row.payload)});
export async function submitCodingDraft(db:CodingDatabase,owner:string,input:{operationId:string;draftId:string;expectedRevision:number},credential:LeetcodeCredential,fetcher:typeof fetch=fetch){
  const prior=await db.prepare("SELECT * FROM coding_submissions WHERE owner_id=? AND operation_id=?").bind(owner,input.operationId).first<SubmissionRow>();
  if(prior){if(prior.draft_id!==input.draftId||prior.draft_revision!==input.expectedRevision)throw new Error("Submission ID belongs to another draft revision.");return receipt(prior);}
  const draft=await readCodingDraft(db,owner,input.draftId);
  if(!draft||draft.revision!==input.expectedRevision)throw new Error("Read and review the latest saved draft before submitting. No code was sent.");
  if(!draft.problem.titleSlug||!draft.problem.leetcodeId)throw new Error("This custom question has no LeetCode judge. ChatGPT can review its saved code; no submission was sent.");
  if(!draft.code.trim())throw new Error("Write and save code before submitting.");
  const existing=await db.prepare("SELECT * FROM coding_submissions WHERE owner_id=? AND draft_id=? AND draft_revision=?").bind(owner,input.draftId,input.expectedRevision).first<SubmissionRow>();
  if(existing)return receipt(existing);
  const account=await verifyLeetcodeSession(credential,fetcher);
  if(account.username.toLowerCase()!==credential.username.toLowerCase())throw new Error("Reconnect LeetCode before submitting; the account identity changed.");
  const now=Date.now();
  try{await db.batch([
    db.prepare("SELECT json(CASE WHEN (SELECT MAX(revision) FROM coding_draft_revisions WHERE owner_id=? AND draft_id=?)=? THEN 'true' ELSE 'draft_conflict' END)").bind(owner,input.draftId,input.expectedRevision),
    db.prepare("INSERT INTO coding_submissions(owner_id,operation_id,draft_id,draft_revision,code_sha256,status,payload,created_at,updated_at) VALUES(?,?,?,?,?,'reserved','{}',?,?)").bind(owner,input.operationId,input.draftId,input.expectedRevision,draft.codeSha256,now,now),
  ]);}catch{
    const raced=await db.prepare("SELECT * FROM coding_submissions WHERE owner_id=? AND draft_id=? AND draft_revision=?").bind(owner,input.draftId,input.expectedRevision).first<SubmissionRow>();
    if(raced)return receipt(raced);throw new Error("Submission was not reserved. Read the latest draft. No request was sent by this call.");
  }
  try{
    const result=await requestJudge(`/problems/${draft.problem.titleSlug}/submit/`,credential,{lang:draft.language,question_id:draft.problem.leetcodeId,typed_code:draft.code},fetcher);
    if(!Number.isSafeInteger(result.submission_id)||result.submission_id<1)throw new Error("No submission ID");
    await db.prepare("UPDATE coding_submissions SET status='submitted',submission_id=?,updated_at=? WHERE owner_id=? AND operation_id=? AND status='reserved'").bind(result.submission_id,Date.now(),owner,input.operationId).run();
  }catch{
    // A timeout can occur after LeetCode accepts the code. Never repeat the POST.
    await db.prepare("UPDATE coding_submissions SET status='uncertain',payload=?,updated_at=? WHERE owner_id=? AND operation_id=? AND status='reserved'").bind(JSON.stringify({message:"LeetCode did not return a confirmed submission ID. Do not resubmit this revision; check your recent LeetCode submissions first."}),Date.now(),owner,input.operationId).run();
  }
  return readCodingSubmission(db,owner,input.operationId,credential,fetcher);
}
export async function readCodingSubmission(db:CodingDatabase,owner:string,operationId:string,credential:LeetcodeCredential,fetcher:typeof fetch=fetch){
  const row=await db.prepare("SELECT * FROM coding_submissions WHERE owner_id=? AND operation_id=?").bind(owner,operationId).first<SubmissionRow>();
  if(!row)throw new Error("No submission belongs to this owner and operation.");
  if(row.status!=="submitted"||!row.submission_id)return receipt(row);
  const result=await requestJudge(`/submissions/detail/${row.submission_id}/check/`,credential,undefined,fetcher);
  if(result.state!=="SUCCESS")return {...receipt(row),judgeState:typeof result.state==="string"?result.state:"pending"};
  if(!Number.isInteger(result.status_code)||typeof result.status_msg!=="string"||!result.status_msg.trim()){
    return {...receipt(row),judgeState:"pending",message:"LeetCode returned no complete verdict. Poll this same submission again; no code was resent."};
  }
  const verdict:Record<string,unknown>={judgeState:"SUCCESS",source:"leetcode_judge"};
  for(const key of ["status_code","status_msg","total_correct","total_testcases","status_runtime","status_memory","runtime_percentile","memory_percentile","last_testcase","expected_output","code_output","std_output","compile_error","full_compile_error","runtime_error","full_runtime_error"]){
    const value=result[key];if(typeof value==="string"||typeof value==="number"||typeof value==="boolean")verdict[key]=typeof value==="string"?value.slice(0,32000):value;
  }
  await db.prepare("UPDATE coding_submissions SET status='complete',payload=?,updated_at=? WHERE owner_id=? AND operation_id=? AND status='submitted'").bind(JSON.stringify(verdict),Date.now(),owner,operationId).run();
  return {...receipt(row),...verdict,status:"complete"};
}
