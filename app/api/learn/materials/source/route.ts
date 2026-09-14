import { env } from "cloudflare:workers";
import { resolveOwnerId } from "../../../../../db/owner";
import { getLearningMaterial } from "../../../../../db/learning-materials";
import { readStudyOriginal, resourceImageType } from "../../../../../db/study-resources";
import { ResourceError, resourceHash } from "../../../../../db/study-resource-policy";
export async function GET(request:Request){
  const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Content-Security-Policy":"sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"};
  try{
    const owner=await resolveOwnerId(request),material=await getLearningMaterial(env.DB,owner,new URL(request.url).searchParams.get("materialId")??"");
    const {object,resource}=await readStudyOriginal(env.DB,env.AUDIO,owner,material.resourceId),bytes=new Uint8Array(await object.arrayBuffer());
    if(await resourceHash(bytes)!==material.sourceSha256)throw new ResourceError("Original identity could not be verified.",503);
    const image=resourceImageType(bytes),pdf=new TextDecoder().decode(bytes.slice(0,5))==="%PDF-",html=/\.html?$/i.test(resource.filename);
    const text=resource.method==="text-v1";
    if(!image&&!pdf&&!html&&!text)throw new ResourceError("This format is available as an original download in the library.",415);
    return new Response(bytes,{headers:{...headers,"Content-Type":image??(pdf?"application/pdf":html?"text/html; charset=utf-8":"text/plain; charset=utf-8"),"Content-Disposition":"inline"}});
  }catch(e){return Response.json({error:e instanceof ResourceError?e.message:"Original preview is unavailable."},{status:e instanceof ResourceError?e.status:400,headers});}
}
