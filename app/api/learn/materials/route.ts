import { env } from "cloudflare:workers";
import { ZodError } from "zod";
import { resolveOwnerId } from "../../../../db/owner";
import { getLearningMaterial, listLearningMaterials, publishLearningMaterial } from "../../../../db/learning-materials";
import { ResourceError } from "../../../../db/study-resource-policy";
import { boundedResourceBody } from "../../study-resources/route";
const headers={"Cache-Control":"private, no-store"};
function failure(e:unknown){return Response.json({error:e instanceof ResourceError?e.message:e instanceof ZodError||e instanceof SyntaxError?"Invalid learning material request.":"Material request failed. Retry the same operation."},{status:e instanceof ResourceError?e.status:e instanceof ZodError||e instanceof SyntaxError?400:503,headers});}
export async function GET(request:Request){try{const owner=await resolveOwnerId(request),u=new URL(request.url),id=u.searchParams.get("materialId");return Response.json(id?await getLearningMaterial(env.DB,owner,id):await listLearningMaterials(env.DB,owner,u.searchParams.get("query")??"",Number(u.searchParams.get("offset")??0)),{headers});}catch(e){return failure(e);}}
export async function POST(request:Request){try{if(request.headers.get("origin")!==new URL(request.url).origin)throw new ResourceError("Publish from your signed-in Arc page.",403);const owner=await resolveOwnerId(request),input=JSON.parse(new TextDecoder().decode(await boundedResourceBody(request,300000)));return Response.json(await publishLearningMaterial(env.DB,env.AUDIO,owner,input),{headers});}catch(e){return failure(e);}}
