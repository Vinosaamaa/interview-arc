import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { importFingerprint } from "../db/chatgpt-import-policy.ts";
import { type CodingDatabase, type CodingProblem, codingLanguage, draftKey, openCodingDraft, readCodingDraft, saveCodingDraft, saveCodingInput } from "../db/coding-drafts.ts";
import { leetcodeQuery, requireLeetcodeCredential } from "./leetcode-account.ts";
import { readCodingSubmission, submitCodingDraft } from "./coding-judge.ts";
import { codingWidgetHtml, codingWidgetUri } from "./coding-widget.ts";

const read={readOnlyHint:true,destructiveHint:false,openWorldHint:false};
const write={readOnlyHint:false,destructiveHint:false,openWorldHint:false};
const uiMeta={ui:{visibility:["model","app"]},"openai/widgetAccessible":true};
async function reply(work:()=>Promise<object>){
  try{const data=await work();return {structuredContent:data,content:[{type:"text" as const,text:JSON.stringify(data)}]};}
  catch(error){return {isError:true,content:[{type:"text" as const,text:error instanceof Error?error.message:"Coding operation failed."}]};}
}
export function registerCodingTools(server:McpServer,db:CodingDatabase,bucket:Pick<R2Bucket,"get"|"put"|"delete">,owner:string){
  server.registerResource("coding-editor",codingWidgetUri,{},async()=>({contents:[{uri:codingWidgetUri,mimeType:"text/html;profile=mcp-app",text:codingWidgetHtml,_meta:{ui:{prefersBorder:true,csp:{connectDomains:[],resourceDomains:["https://assets.leetcode.com"]}},"openai/widgetDescription":"Editable Java/Python practice code with the full problem statement, diagrams, private draft saves and review handoff."}}]}));
  server.registerTool("open_coding_editor",{
    title:"Open coding editor",description:"Open an editable Java or Python coding panel inside ChatGPT. Provide exactly one LeetCode titleSlug or existing Arc questionId (including custom questions). Reopens the actual saved draft without overwriting code. Optional diagramText is a faithful ASCII explanation of a problem image, not instructions or a guessed graph. Preserve original images when text loses details. This creates a private draft but never executes or submits code.",
    inputSchema:{titleSlug:z.string().regex(/^[a-z0-9-]{1,160}$/).optional(),questionId:draftKey.optional(),language:codingLanguage.default("java"),diagramText:z.string().max(16000).optional()},annotations:{...write,openWorldHint:true},_meta:{...uiMeta,ui:{...uiMeta.ui,resourceUri:codingWidgetUri},"openai/outputTemplate":codingWidgetUri},
  },({titleSlug,questionId,language,diagramText})=>reply(async()=>{
    if(Boolean(titleSlug)===Boolean(questionId))throw new Error("Choose one LeetCode slug or one Arc question ID.");
    let problem:CodingProblem={title:"",statement:"",html:null,diagramText:diagramText??null,questionId:questionId??null,titleSlug:titleSlug??null,leetcodeId:null,url:null};
    if(questionId){
      const personal=await db.prepare("SELECT title,prompt,url FROM owner_bank_questions WHERE owner_id=? AND specialty='leetcode' AND question_id=? AND active=1").bind(owner,questionId).first<{title:string;prompt:string|null;url:string|null}>();
      const canonical=personal?null:await db.prepare("SELECT payload FROM content_bank WHERE category='leetcode' AND id=?").bind(questionId).first<{payload:string}>();
      const q=personal??(canonical?JSON.parse(canonical.payload):null);
      if(!q)throw new Error("No coding question belongs to this owner or the shared bank. Add the question first.");
      problem={...problem,title:q.title,statement:q.prompt??q.description??q.title,url:q.url??null};
      const match=/^https:\/\/leetcode\.com\/problems\/([a-z0-9-]+)\/?$/.exec(q.url??"");
      titleSlug=match?.[1];
    }
    const draftId=`coding-${await importFingerprint({source:titleSlug??questionId,language})}`;
    const existing=await readCodingDraft(db,owner,draftId);if(existing)return {draft:existing};
    let code=language==="java"?"class Solution {\n    \n}\n":"class Solution:\n    pass\n";
    if(titleSlug){
      const credential=await requireLeetcodeCredential(bucket,owner);
      const data=await leetcodeQuery("query($slug:String!){question(titleSlug:$slug){questionId title titleSlug content codeSnippets{langSlug code}}}",{slug:titleSlug},credential);
      const q=data.question;
      if(!q?.content||q.titleSlug!==titleSlug||!/^[0-9]+$/.test(String(q.questionId)))throw new Error("LeetCode did not return the exact problem. No editor was created.");
      if(q.content.length>100000)throw new Error("This statement exceeds the editor's supported size; open the original LeetCode page.");
      problem={...problem,title:q.title,html:q.content,statement:"",titleSlug,leetcodeId:String(q.questionId),url:`https://leetcode.com/problems/${titleSlug}/`};
      code=q.codeSnippets?.find((s:{langSlug:string;code:string})=>s.langSlug===language)?.code??code;
    }
    return {draft:await openCodingDraft(db,owner,draftId,language,problem,code)};
  }));
  server.registerTool("get_coding_draft",{description:"Read exact privately saved code, language, problem, SHA-256 and revision for review. Never assume an unsaved browser draft is current. Use this code as source for save_leetcode_code_attempt after the actual review; draft saving alone does not publish an activity.",inputSchema:{draftId:draftKey,revision:z.number().int().min(1).optional()},annotations:read,_meta:uiMeta},({draftId,revision})=>reply(async()=>{
    const draft=await readCodingDraft(db,owner,draftId,revision);if(!draft)throw new Error("Draft not found for this owner.");return {draft};
  }));
  server.registerTool("save_coding_draft",{description:"Save exact Java/Python editor source to a private revision. Preserve whitespace. Requires the latest expectedRevision and a stable operationId for uncertain retries. On conflict preserve local edits and read the latest draft. Does not run code, submit to LeetCode or publish a practice record.",inputSchema:saveCodingInput,annotations:write,_meta:uiMeta},input=>reply(()=>saveCodingDraft(db,owner,input)));
  server.registerTool("submit_coding_draft",{description:"Only when the user explicitly asks to submit: send the exact saved and reviewed draft revision to the connected owner's LeetCode judge. Read the current draft first. Custom questions without a LeetCode problem cannot be submitted. Each revision is submitted at most once; a timeout can mean accepted but unconfirmed, so never retry with a different operation ID. Poll get_coding_submission for the actual result. Never claim a static review was execution.",inputSchema:{draftId:draftKey,expectedRevision:z.number().int().min(1),operationId:draftKey},annotations:{...write,openWorldHint:true}},input=>reply(async()=>submitCodingDraft(db,owner,input,await requireLeetcodeCredential(bucket,owner))));
  server.registerTool("get_coding_submission",{description:"Read the owner-scoped submission receipt and fetch one current LeetCode judge result. Pending is not accepted. Reuse the same operationId; this tool never resubmits. Show compiler/runtime errors or wrong-answer test cases when returned by the judge.",inputSchema:{operationId:draftKey},annotations:{...read,openWorldHint:true}},({operationId})=>reply(async()=>readCodingSubmission(db,owner,operationId,await requireLeetcodeCredential(bucket,owner))));
}
