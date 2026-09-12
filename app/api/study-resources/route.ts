import { env } from "cloudflare:workers";
import { ZodError } from "zod";
import { resolveOwnerId } from "../../../db/owner";
import { MAX_RESOURCE_BYTES, ResourceError, resourceIdSchema } from "../../../db/study-resource-policy";
import { getStudyResource, linkStudyResource, readStudyOriginal, resourceImageType, saveStudyResource, searchStudyResources } from "../../../db/study-resources";

const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  return Response.json({ error: error instanceof ResourceError ? error.message : error instanceof ZodError || error instanceof SyntaxError ? "Invalid resource request." : "Resource operation was not confirmed. Retry the same upload." }, { status: error instanceof ResourceError ? error.status : error instanceof ZodError || error instanceof SyntaxError ? 400 : 503, headers });
}
export async function boundedResourceBody(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit) throw new ResourceError("Upload exceeds the supported size.",413);
  const reader = request.body?.getReader(); if (!reader) throw new ResourceError("Upload body is missing.");
  const chunks: Uint8Array[] = []; let size=0;
  try { while (true) { const {done,value}=await reader.read(); if(done)break; size+=value.length; if(size>limit)throw new ResourceError("Upload exceeds the supported size.",413); chunks.push(value); } }
  catch(e) { await reader.cancel().catch(()=>undefined); throw e; } finally { reader.releaseLock(); }
  const bytes=new Uint8Array(size); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;} return bytes;
}
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) throw new ResourceError("Upload from your signed-in Arc page.",403);
    const owner=await resolveOwnerId(request);
    const type=request.headers.get("content-type")??"";
    if(type.startsWith("application/json")) {
      const value=JSON.parse(new TextDecoder().decode(await boundedResourceBody(request,4000)));
      return Response.json(await linkStudyResource(env.DB,owner,value),{headers});
    }
    if(!type.startsWith("multipart/form-data;"))throw new ResourceError("Choose a file to upload.");
    const body=await boundedResourceBody(request,MAX_RESOURCE_BYTES+12*1024*1024);
    const form=await new Request(request.url,{method:"POST",headers:{"content-type":type},body}).formData();
    const file=form.get("file");if(!(file instanceof File))throw new ResourceError("Choose a file to upload.");
    const result=await saveStudyResource(env.DB,env.AUDIO,owner,{operationId:form.get("operationId"),title:form.get("title")},
      {name:file.name,bytes:new Uint8Array(await file.arrayBuffer())});
    return Response.json(result,{status:result.duplicate?200:201,headers});
  } catch(e){return failure(e);}
}
export async function GET(request: Request) {
  try {
    const owner=await resolveOwnerId(request), url=new URL(request.url), id=url.searchParams.get("resourceId");
    if(id) {
      resourceIdSchema.parse(id);
      if(url.searchParams.get("image")==="1") {
        const {object}=await readStudyOriginal(env.DB,env.AUDIO,owner,id);
        const bytes=await object.arrayBuffer(), type=resourceImageType(new Uint8Array(bytes));
        if(!type)throw new ResourceError("This resource is not a supported image.");
        return new Response(bytes,{headers:{...headers,"Content-Type":type,"X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox; default-src 'none'"}});
      }
      if(url.searchParams.get("original")==="1") {
        const {object,resource}=await readStudyOriginal(env.DB,env.AUDIO,owner,id);
        return new Response(object.body,{headers:{...headers,"Content-Type":"application/octet-stream","Content-Length":String(resource.sizeBytes),"X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox; default-src 'none'","Content-Disposition":`attachment; filename="resource.bin"; filename*=UTF-8''${encodeURIComponent(resource.filename).replace(/['()*]/g,c=>`%${c.charCodeAt(0).toString(16)}`)}`}});
      }
      const chunk=Number(url.searchParams.get("chunk")??0);if(!Number.isSafeInteger(chunk)||chunk<0)throw new ResourceError("Invalid fragment.");
      return Response.json(await getStudyResource(env.DB,owner,id,chunk,url.searchParams.get("sha256")??undefined),{headers});
    }
    const offset=Number(url.searchParams.get("offset")??0),query=url.searchParams.get("query")??"";
    if(!Number.isSafeInteger(offset)||offset<0||offset>100000||query.length>300)throw new ResourceError("Invalid resource search.");
    return Response.json(await searchStudyResources(env.DB,owner,query,offset),{headers});
  }catch(e){return failure(e);}
}
