import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { generateLectureAudio } from "../db/lecture-audio.ts";
import { LectureError, lectureHash, lectureId } from "../db/lecture-policy.ts";
import { readLecture, type LectureDatabase } from "../db/lectures.ts";
import { streamLecture } from "../db/lecture-stream.ts";
import { lecturePlayerHtml, lecturePlayerUri } from "./lecture-player-widget.ts";

type Bucket = Pick<R2Bucket,"head"|"get"|"put"|"delete">;
const mediaOrigin="https://limitless-mcp.vinosama.workers.dev";
const appMeta={ui:{visibility:["model","app"]},"openai/widgetAccessible":true};
export async function openLecturePlayer(db:LectureDatabase,owner:string,id:string,configured:boolean,origin=mediaOrigin){
  const lecture=await readLecture(db,owner,id);
  const ready=lecture.chunks.every(c=>c.audio?.state==="ready");
  let audioUrl:string|null=null,expiresAt:number|null=null;
  if(ready){
    // Only this lecture's audio is delegated to the sandbox. The random bearer
    // lives in widget-only metadata, never the model transcript or a public R2 key.
    const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,"0")).join("");
    expiresAt=Date.now()+2*60*60*1000;
    await db.batch([
      db.prepare("DELETE FROM professor_lecture_player_tickets WHERE expires_at<?").bind(Date.now()),
      db.prepare("INSERT INTO professor_lecture_player_tickets(token_hash,owner_id,lecture_id,fingerprint,expires_at) VALUES(?,?,?,?,?)")
        .bind(await lectureHash(token),owner,id,lecture.fingerprint,expiresAt),
    ]);
    audioUrl=`${origin}/lecture-media?ticket=${token}`;
  }
  const {fragment: _fragment, playerUrl: _playerUrl, ...data}=lecture;
  void _playerUrl;
  return {structuredContent:{lecture:data,ready,speechConfigured:configured},
    content:[{type:"text" as const,text:JSON.stringify({lectureId:id,title:lecture.title,ready,estimatedMinutes:lecture.estimatedMinutes,speechConfigured:configured,
      instruction:"Use Play free on this device in the player. It reads the saved original using an installed device voice, with no paid speech API or connection to a PC. Do not call paid audio generation for free playback. A script estimate is not measured duration. Mobile background and lock-screen playback depend on the host app."})}],
    _meta:{audioUrl,expiresAt,scriptFragment:_fragment}};
}
export async function routeLectureMedia(db:LectureDatabase,bucket:Pick<R2Bucket,"get">,request:Request){
  const url=new URL(request.url);
  if(url.pathname!=="/lecture-media")return null;
  const fail=(status:number)=>new Response("Lecture playback authorization is unavailable or expired.",{status,headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}});
  if(!["GET","HEAD"].includes(request.method))return fail(405);
  const token=url.searchParams.get("ticket")??"";
  if(!/^[a-f0-9]{64}$/.test(token))return fail(401);
  const grant=await db.prepare(`SELECT t.owner_id,t.lecture_id FROM professor_lecture_player_tickets t JOIN professor_lectures l
    ON l.owner_id=t.owner_id AND l.lecture_id=t.lecture_id AND l.fingerprint=t.fingerprint WHERE t.token_hash=? AND t.expires_at>?`)
    .bind(await lectureHash(token),Date.now()).first<{owner_id:string;lecture_id:string}>();
  if(!grant)return fail(401);
  try{
    const response=await streamLecture(db,bucket,grant.owner_id,grant.lecture_id,request);
    response.headers.set("Referrer-Policy","no-referrer");response.headers.set("X-Content-Type-Options","nosniff");
    return response;
  }catch{return fail(503);}
}
export function registerLecturePlayerTools(server:McpServer,db:LectureDatabase,bucket:Bucket,owner:string,apiKey:string|undefined){
  server.registerResource("lecture-player",lecturePlayerUri,{},async()=>({contents:[{uri:lecturePlayerUri,mimeType:"text/html;profile=mcp-app",text:lecturePlayerHtml,
    _meta:{ui:{prefersBorder:true,csp:{connectDomains:[],resourceDomains:[mediaOrigin]}},"openai/widgetDescription":"Read the original lecture automatically using a free voice installed on this device. No paid API or PC connection. Previously prepared recordings also remain playable."}}]}));
  server.registerTool("open_practice_lecture_player",{
    title:"Open lecture player",description:"Open a saved Professor lecture inside this ChatGPT conversation. Play free on this device uses an installed local voice and automatically reads the original sections with saved word/sentence position. No API credit, paid speech request, or PC connection is needed. The owner presses Play. Host voice availability, background and screen-lock behavior must be verified; do not promise a measured hour from a script estimate. Previously prepared recordings remain available.",
    inputSchema:{lectureId},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},
    _meta:{...appMeta,ui:{...appMeta.ui,resourceUri:lecturePlayerUri},"openai/outputTemplate":lecturePlayerUri},
  },async({lectureId:id})=>{try{return await openLecturePlayer(db,owner,id,Boolean(apiKey));}catch(e){return {isError:true,content:[{type:"text" as const,text:e instanceof LectureError?e.message:"Player could not be opened."}]};}});
  server.registerTool("generate_lecture_audio_section",{
    description:"Legacy PAID speech option. Use only after the owner explicitly authorizes paid speech API usage. Never call this for free playback: open_practice_lecture_player provides a device-local voice without API credit. This tool requests one original script section from OpenAI and can incur charges; ready audio is reused. On uncertainty reread state and preserve lecture identity.",
    inputSchema:{lectureId,chunkIndex:z.number().int().min(0).max(199)},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true},_meta:appMeta,
  },async({lectureId:id,chunkIndex})=>{try{const data=await generateLectureAudio(db,bucket,owner,id,chunkIndex,apiKey);return {structuredContent:data,content:[{type:"text" as const,text:JSON.stringify(data)}]};}catch(e){return {isError:true,content:[{type:"text" as const,text:e instanceof LectureError?e.message:"Audio generation failed. Reread preparation state before retrying."}]};}});
}
