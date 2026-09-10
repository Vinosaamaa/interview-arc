import { env } from "cloudflare:workers";
import { resolveOwnerId } from "../../../../db/owner";
import { readDrawingFile } from "../../../../db/practice-drawing";
export async function GET(request:Request){
  const url=new URL(request.url);const id=url.searchParams.get("activityId");const revision=Number(url.searchParams.get("revision"));
  if(!id||id.length>240||!Number.isSafeInteger(revision)||revision<1)return new Response("Invalid drawing reference.",{status:400});
  try{const bytes=await readDrawingFile(env.DB,env.AUDIO,await resolveOwnerId(request),id,revision);if(!bytes)return new Response("Drawing not found.",{status:404});return new Response(bytes,{headers:{"Content-Type":"application/vnd.excalidraw+json","Content-Disposition":"attachment; filename=practice-drawing.excalidraw","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});}
  catch{return new Response("Drawing could not be verified.",{status:503});}
}
