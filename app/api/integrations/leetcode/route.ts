import { env } from "cloudflare:workers";
import { resolveOwnerId, TRUSTED_EMAIL_HEADER } from "../../../../db/owner";
import { connectLeetcode, disconnectLeetcode, leetcodeConnectionStatus, LeetcodeAccountError } from "../../../../mcp-worker/leetcode-account";
import { readBoundedJson } from "../../route-helpers";
const reply=(body: object,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
export async function GET(request: Request) {
  if(!request.headers.get(TRUSTED_EMAIL_HEADER)) return reply({connected:false,reconnectRequired:true,message:"Sign in to Arc with your account."},401);
  try {return reply(await leetcodeConnectionStatus(env.AUDIO,await resolveOwnerId(request)));}
  catch {return reply({connected:false,reconnectRequired:true});}
}
export async function POST(request: Request) {
  if(!request.headers.get(TRUSTED_EMAIL_HEADER)) return reply({error:"Sign in to Arc with your account."},401);
  if(request.headers.get("origin")!==new URL(request.url).origin) return reply({error:"Open the connection page in Arc."},403);
  if(!request.headers.get("content-type")?.startsWith("application/json")) return reply({error:"JSON required."},415);
  try {
    const input=await readBoundedJson(request,8192) as {action?:string;session?:unknown;csrf?:unknown}; const owner=await resolveOwnerId(request);
    return reply(input.action==="disconnect" ? await disconnectLeetcode(env.AUDIO,owner) : await connectLeetcode(env.AUDIO,owner,input.session,input.csrf));
  } catch(error) {return reply({error:error instanceof LeetcodeAccountError?error.message:"Could not save the connection."},400);}
}
