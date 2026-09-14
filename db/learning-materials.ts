import { z } from "zod";
import { getStudyResource, readStudyOriginal, type ResourceDatabase, type ResourceBucket } from "./study-resources.ts";
import { resourceHash, ResourceError, resourceIdSchema, resourceUploadSchema } from "./study-resource-policy.ts";

export const materialIdSchema=z.string().regex(/^material-[a-f0-9]{40}$/);
export const materialSummarySchema=z.strictObject({
  overview:z.string().trim().min(40).max(10000),
  sections:z.array(z.strictObject({heading:z.string().trim().min(1).max(200),body:z.string().trim().min(40).max(20000),sourceLocation:z.string().trim().min(1).max(300)})).min(1).max(60),
  keyNotes:z.array(z.string().trim().min(1).max(2000)).min(1).max(40),
});
export const publishMaterialSchema=z.strictObject({
  ...resourceUploadSchema.shape,
  kind:z.enum(["youtube","article","upload"]),
  sourceUrl:z.string().url().max(2000).optional(),
  resourceId:resourceIdSchema,sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),
  coverage:z.enum(["complete","partial"]),limitations:z.array(z.string().trim().min(1).max(1000)).max(30),
  summary:materialSummarySchema,
}).refine(v=>v.kind==="upload"||Boolean(v.sourceUrl),"A web material needs its source URL.")
  .refine(v=>v.coverage!=="partial"||v.limitations.length>0,"State what is missing from a partial source.");
type Row={material_id:string;fingerprint:string;title:string;kind:"youtube"|"article"|"upload";source_url:string|null;resource_id:string;source_sha256:string;summary_json:string;coverage:"complete"|"partial";limitations:string;created_at:number};
export type MaterialSummary=z.infer<typeof materialSummarySchema>;
function item(row:Row){return {materialId:row.material_id,title:row.title,kind:row.kind,sourceUrl:row.source_url,resourceId:row.resource_id,sourceSha256:row.source_sha256,coverage:row.coverage,limitations:JSON.parse(row.limitations) as string[],createdAt:row.created_at,url:`/?view=learn&learn=materials&material=${row.material_id}`};}
export type LearningMaterial=ReturnType<typeof item>&{summary:MaterialSummary};
const hash=(v:unknown)=>resourceHash(new TextEncoder().encode(JSON.stringify(v)));
function sourceUrl(value:string|undefined,kind:string){
  if(!value)return null;const u=new URL(value);
  if(u.protocol!=="https:"||u.username||u.password)throw new ResourceError("Use a public HTTPS source URL without credentials.");
  if(kind==="youtube"&&!/^(www\.|m\.)?youtube\.com$|^youtu\.be$/.test(u.hostname))throw new ResourceError("Use the original YouTube video URL.");
  return u.href;
}
export async function publishLearningMaterial(db:ResourceDatabase,bucket:ResourceBucket,owner:string,input:unknown){
  const v=publishMaterialSchema.parse(input),url=sourceUrl(v.sourceUrl,v.kind);
  if(JSON.stringify(v.summary).length>180000)throw new ResourceError("Summary exceeds 180,000 characters; split the material into focused publications.",413);
  const source=await getStudyResource(db,owner,v.resourceId,0,v.sourceSha256);
  if(source.resource.sourceSha256!==v.sourceSha256)throw new ResourceError("The original identity does not match. Read the resource again.",409);
  const {object}=await readStudyOriginal(db,bucket,owner,v.resourceId);
  if(await resourceHash(new Uint8Array(await object.arrayBuffer()))!==v.sourceSha256)throw new ResourceError("Original verification failed. Restore the original before publishing.",503);
  if(v.kind==="youtube"&&source.resource.chunkCount===0)throw new ResourceError("Save an actual readable transcript before publishing this video.");
  const materialId=`material-${(await hash({owner,operationId:v.operationId})).slice(0,40)}`,fingerprint=await hash({...v,sourceUrl:url});
  const prior=await db.prepare("SELECT * FROM learning_materials WHERE owner_id=? AND material_id=?").bind(owner,materialId).first<Row>();
  if(prior){if(prior.fingerprint!==fingerprint)throw new ResourceError("This publish identity already contains different material. Use a new operation for a revised publication; the original is preserved.",409);return {...item(prior),duplicate:true};}
  await db.prepare("INSERT OR IGNORE INTO learning_materials(owner_id,material_id,operation_id,fingerprint,title,kind,source_url,resource_id,source_sha256,summary_json,coverage,limitations,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(owner,materialId,v.operationId,fingerprint,v.title,v.kind,url,v.resourceId,v.sourceSha256,JSON.stringify(v.summary),v.coverage,JSON.stringify(v.limitations),Date.now()).run();
  const saved=await db.prepare("SELECT * FROM learning_materials WHERE owner_id=? AND material_id=?").bind(owner,materialId).first<Row>();
  if(!saved||saved.fingerprint!==fingerprint)throw new ResourceError("Publication conflicted. Read the existing material before retrying.",409);
  return {...item(saved),duplicate:false};
}
export async function getLearningMaterial(db:ResourceDatabase,owner:string,id:string):Promise<LearningMaterial>{
  materialIdSchema.parse(id);const row=await db.prepare("SELECT * FROM learning_materials WHERE owner_id=? AND material_id=?").bind(owner,id).first<Row>();
  if(!row)throw new ResourceError("Learning material not found.",404);return {...item(row),summary:JSON.parse(row.summary_json)};
}
export async function listLearningMaterials(db:ResourceDatabase,owner:string,query="",offset=0){
  if(query.length>300||!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new ResourceError("Invalid material search.");
  const rows=await db.prepare("SELECT * FROM learning_materials WHERE owner_id=? AND (?='' OR instr(lower(title),lower(?))>0 OR instr(lower(summary_json),lower(?))>0) ORDER BY created_at DESC,material_id LIMIT 21 OFFSET ?").bind(owner,query,query,query,offset).all<Row>();
  return {materials:rows.results.slice(0,20).map(item),nextOffset:rows.results.length>20?offset+20:null};
}
