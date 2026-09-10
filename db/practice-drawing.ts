import { z } from "zod";
import { canonicalJson, importFingerprint } from "./chatgpt-import-policy.ts";
import { readExcalidrawLink } from "../mcp-worker/excalidraw-link.ts";
import { completedPracticeTargets } from "./practice-addition-target.ts";
type Database=Pick<D1Database,"prepare"|"batch">;
type Bucket=Pick<R2Bucket,"get"|"put">;
export const drawingInput=z.object({operationId:z.string().min(1).max(240),activityId:z.string().min(1).max(240),expectedRevision:z.number().int().min(0),url:z.string().max(512),authorship:z.enum(["owner","assistant_reference"])}).strict();
export type PracticeDrawing={activityId:string;revision:number;url:string;authorship:"owner"|"assistant_reference";sha256:string;byteSize:number;elementCount:number;createdAt:number;downloadUrl:string};
type Stored=PracticeDrawing&{objectKey:string};
export async function readPracticeDrawing(db:Database,owner:string,activityId:string,revision?:number):Promise<PracticeDrawing|null>{
  const row=await db.prepare(`SELECT payload FROM practice_drawing_additions WHERE owner_id=? AND activity_id=?${revision===undefined?" ORDER BY revision DESC LIMIT 1":" AND revision=?"}`).bind(owner,activityId,...(revision===undefined?[]:[revision])).first<{payload:string}>();
  if(!row)return null;const {objectKey: _key,...safe}=JSON.parse(row.payload) as Stored;void _key;return safe;
}
export async function readDrawingFile(db:Database,bucket:Bucket,owner:string,activityId:string,revision:number){
  const row=await db.prepare("SELECT payload FROM practice_drawing_additions WHERE owner_id=? AND activity_id=? AND revision=?").bind(owner,activityId,revision).first<{payload:string}>();
  if(!row)return null;const stored=JSON.parse(row.payload) as Stored;const object=await bucket.get(stored.objectKey);if(!object||object.size!==stored.byteSize)throw new Error("Drawing storage readback failed.");
  const bytes=await object.arrayBuffer();const sha=Buffer.from(await crypto.subtle.digest("SHA-256",bytes)).toString("hex");if(sha!==stored.sha256)throw new Error("Drawing integrity check failed.");return bytes;
}
export async function savePracticeDrawing(db:Database,bucket:Bucket,owner:string,value:unknown,fetcher:typeof fetch=fetch,now=Date.now()){
  const input=drawingInput.parse(value);
  const fingerprint=await importFingerprint(input);
  async function replay(){const row=await db.prepare("SELECT request_fingerprint,payload FROM practice_drawing_additions WHERE owner_id=? AND operation_id=?").bind(owner,input.operationId).first<{request_fingerprint:string;payload:string}>();if(!row)return null;if(row.request_fingerprint!==fingerprint)throw new Error("This drawing operation already belongs to different content.");const drawing=JSON.parse(row.payload) as Stored;await readDrawingFile(db,bucket,owner,drawing.activityId,drawing.revision);return {saved:true,duplicate:true,drawing:await readPracticeDrawing(db,owner,drawing.activityId,drawing.revision)};}
  const prior=await replay();if(prior)return prior;
  const eligible="owner_id=? AND activity_id=? AND specialty='system_design' AND status='completed'";
  if(!await db.prepare(`SELECT activity_id FROM ${completedPracticeTargets} WHERE ${eligible}`).bind(owner,input.activityId).first())throw new Error("Save the completed system-design Practice Record before attaching its drawing.");
  const snapshot=await readExcalidrawLink({url:input.url},fetcher,true);if(!snapshot.sourceScene)throw new Error("Snapshot source unavailable.");
  const bytes=new TextEncoder().encode(snapshot.sourceScene);const sha256=Buffer.from(await crypto.subtle.digest("SHA-256",bytes)).toString("hex");
  const objectKey=`private-practice-drawings/${await importFingerprint(owner)}/${await importFingerprint(input.activityId)}/${sha256}.excalidraw`;
  const revision=input.expectedRevision+1;
  const drawing:Stored={activityId:input.activityId,revision,url:input.url,authorship:input.authorship,sha256,byteSize:bytes.length,elementCount:snapshot.elementCount,createdAt:now,objectKey,downloadUrl:`/api/chatgpt-practice/drawing?activityId=${encodeURIComponent(input.activityId)}&revision=${revision}`};
  await bucket.put(objectKey,bytes,{httpMetadata:{contentType:"application/vnd.excalidraw+json",cacheControl:"private, no-store"}});
  try {await db.batch([
    db.prepare(`SELECT json(CASE WHEN COALESCE((SELECT MAX(revision) FROM practice_drawing_additions WHERE owner_id=? AND activity_id=?),0)=? AND EXISTS(SELECT 1 FROM ${completedPracticeTargets} WHERE ${eligible}) THEN 'true' ELSE 'drawing_conflict' END)`).bind(owner,input.activityId,input.expectedRevision,owner,input.activityId),
    db.prepare("INSERT INTO practice_drawing_additions(owner_id,activity_id,revision,operation_id,request_fingerprint,payload,created_at) VALUES(?,?,?,?,?,?,?)").bind(owner,input.activityId,revision,input.operationId,fingerprint,canonicalJson(drawing),now),
  ]);}catch{const saved=await replay();if(saved)return saved;throw new Error("Drawing was not confirmed. Read its latest revision and retry unchanged after uncertainty.");}
  await readDrawingFile(db,bucket,owner,input.activityId,revision);
  return {saved:true,duplicate:false,drawing:await readPracticeDrawing(db,owner,input.activityId,revision)};
}
