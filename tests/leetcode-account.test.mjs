import assert from "node:assert/strict";
import test from "node:test";
import { connectLeetcode,loadLeetcodeCredential,disconnectLeetcode,leetcodeConnectionStatus,leetcodeQuery,validateLeetcodeSession } from "../mcp-worker/leetcode-account.ts";
import { registerLeetcodeTools } from "../mcp-worker/leetcode-tools.ts";
import { ScopedMcpServer } from "../mcp-worker/scoped-server.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
const owner="u_"+"a".repeat(32),other="u_"+"b".repeat(32),session="synthetic_session_".repeat(5),csrf="a".repeat(32);
function bucket(){const data=new Map();return {data,async put(k,v){data.set(k,v);},async get(k){const v=data.get(k);return v?{size:v.length,json:async()=>JSON.parse(v)}:null;},async delete(k){data.delete(k);}};}
const authenticated=async()=>Response.json({data:{userStatus:{username:"SyntheticOwner",isSignedIn:true,isPremium:true}}});
test("credentials stay owner scoped and are never included in status receipts",async()=>{
 const b=bucket();const result=await connectLeetcode(b,owner,session,csrf,authenticated);assert.equal(result.isPremium,true);assert.ok(!JSON.stringify(result).includes(session));
 assert.equal((await loadLeetcodeCredential(b,owner)).session,session);assert.equal(await loadLeetcodeCredential(b,other),null);
 assert.equal((await leetcodeConnectionStatus(b,owner,authenticated)).connected,true);
 await disconnectLeetcode(b,other);assert.equal(b.data.size,1);await disconnectLeetcode(b,owner);assert.equal(b.data.size,0);
 await assert.rejects(connectLeetcode(b,"owner",session,csrf,authenticated),/Sign in/);
});
test("expired or invalid input does not replace a working credential; upstream errors cannot expose secrets",async()=>{
 const b=bucket();await connectLeetcode(b,owner,session,csrf,authenticated);const before=[...b.data.values()][0];
 await assert.rejects(connectLeetcode(b,owner,session+"x",csrf,async()=>Response.json({data:{userStatus:{isSignedIn:false}}})),/expired/);assert.equal([...b.data.values()][0],before);
 assert.throws(()=>validateLeetcodeSession("cookie\r\ninjection",csrf));assert.throws(()=>validateLeetcodeSession(session,"bad;header"));
 for(const upstream of [async()=>new Response(session,{status:403}),async()=>new Response(null,{status:302,headers:{Location:"https://evil.test"}}),async()=>{throw Error(session);},async()=>Response.json({errors:[{message:session}]})]) {
   await assert.rejects(leetcodeQuery("query{}",{},{session,csrf},upstream),e=>!e.message.includes(session));
 }
 assert.equal((await leetcodeConnectionStatus(b,owner,async()=>new Response(null,{status:401}))).reconnectRequired,true);
});
test("hosted MCP retrieves owned source and official editorial, pages losslessly and refuses another user's code",async(t)=>{
 const b=bucket();await connectLeetcode(b,owner,session,csrf,authenticated);let returnedOwner="SyntheticOwner";const content="Official synthetic explanation. ".repeat(1000);
 t.mock.method(globalThis,"fetch",async(url,options)=>{
  assert.equal(url,"https://leetcode.com/graphql/");assert.equal(options.redirect,"manual");assert.match(options.headers.Cookie,/LEETCODE_SESSION=/);const {query}=JSON.parse(options.body);
  if(query.includes("submissionDetails"))return Response.json({data:{submissionDetails:{id:123,code:"class Solution {}",user:{username:returnedOwner}}}});
  return Response.json({data:{question:{title:"Synthetic",solution:{id:"1",content,canSeeDetail:true,paidOnly:true}}}});
 });
 const server=new ScopedMcpServer({name:"test",version:"1"});registerLeetcodeTools(server,b,owner);const client=new Client({name:"test",version:"1"});const[a,c]=InMemoryTransport.createLinkedPair();await server.connect(c);await client.connect(a);
 try{
  const source=await client.callTool({name:"get_leetcode_submission",arguments:{submissionId:123}});assert.equal(source.structuredContent.submission.code,"class Solution {}");
  returnedOwner="AnotherOwner";assert.equal((await client.callTool({name:"get_leetcode_submission",arguments:{submissionId:123}})).isError,true);
  const first=(await client.callTool({name:"get_leetcode_editorial",arguments:{titleSlug:"synthetic"}})).structuredContent;assert.equal(first.status,"available");assert.equal(first.nextOffset,20000);
  const second=(await client.callTool({name:"get_leetcode_editorial",arguments:{titleSlug:"synthetic",offset:first.nextOffset,expectedSha256:first.contentSha256}})).structuredContent;assert.equal(first.contentFragment+second.contentFragment,content);
  assert.equal((await client.callTool({name:"get_leetcode_editorial",arguments:{titleSlug:"synthetic",offset:20000}})).isError,true);
 }finally{await client.close();await server.close();}
});
