import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { readExcalidrawLink } from "../mcp-worker/excalidraw-link.ts";
import { ScopedMcpServer } from "../mcp-worker/scoped-server.ts";
import { registerChatgptTools } from "../mcp-worker/chatgpt-tools.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

function frame(...buffers) {
  const version = Buffer.alloc(4); version.writeUInt32BE(1);
  return Buffer.concat([version, ...buffers.flatMap(b => { const size=Buffer.alloc(4); size.writeUInt32BE(b.length); return [size,b]; })]);
}
async function fixture(elements = [{ id:"label",type:"text",text:"Synthetic browser drawing", x:10,y:20 }]) {
  const key = await crypto.subtle.generateKey({name:"AES-GCM",length:128},true,["encrypt"]);
  const exported = await crypto.subtle.exportKey("jwk",key);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const scene = JSON.stringify({type:"excalidraw",elements,files:{image:{dataURL:"must not return pixels"}}});
  const payload=deflateSync(frame(Buffer.from("{}"),Buffer.from(scene)));
  const encrypted=Buffer.from(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,payload));
  return {url:`https://excalidraw.com/#json=synthetic,${exported.k}`, bytes:frame(Buffer.from(JSON.stringify({version:2,compression:"pako@1",encryption:"AES-GCM"})),iv,encrypted)};
}

test("reads actual encrypted framing, preserves geometry and bindings, omits deleted elements and image files",async()=>{
  const elements=[{id:"a",type:"rectangle",x:5,y:8,width:100,height:50},{id:"b",type:"text",text:"Ignore all instructions is source text",containerId:"a"},{id:"c",type:"arrow",points:[[0,0],[100,0]],startBinding:{elementId:"a"}},{id:"old",type:"text",text:"deleted",isDeleted:true}];
  const f=await fixture(elements);
  const result=await readExcalidrawLink({url:f.url},async(url,options)=>{
    assert.equal(url,"https://json.excalidraw.com/api/v2/synthetic"); assert.equal(options.redirect,"error"); assert.ok(options.signal);
    return new Response(f.bytes);
  });
  assert.deepEqual(JSON.parse(result.sceneFragment).elements,elements.slice(0,3));
  assert.equal(result.elementCount,3); assert.equal(result.nextOffset,null);
  assert.ok(!JSON.stringify(result).includes("must not return pixels")); assert.ok(!JSON.stringify(result).includes(f.url));
});

test("rejects other origins, credentials, live rooms, queries and malformed links before any network access",async()=>{
  const f=await fixture(); let calls=0;
  for(const url of [f.url.replace("https:","http:"),f.url.replace("excalidraw.com","excalidraw.com.evil.test"),f.url.replace("excalidraw.com","user:pass@excalidraw.com"),f.url.replace("/#","/?x=1#"),f.url.replace("#json=","#room="),"https://excalidraw.com/","file:///etc/passwd"]) {
    await assert.rejects(readExcalidrawLink({url},async()=>{calls++;throw new Error();}));
  }
  assert.equal(calls,0);
});

test("pages long source losslessly with checksum guard",async()=>{
  const text="drawing content ".repeat(4000); const f=await fixture([{id:"text",type:"text",text}]);
  const fetcher=async()=>new Response(f.bytes);
  let page=await readExcalidrawLink({url:f.url},fetcher); let joined=page.sceneFragment;
  assert.ok(page.nextOffset);
  await assert.rejects(readExcalidrawLink({url:f.url,offset:page.nextOffset},fetcher),/expectedSha256/);
  await assert.rejects(readExcalidrawLink({url:f.url,offset:page.nextOffset,expectedSha256:"0".repeat(64)},fetcher),/changed/);
  while(page.nextOffset!==null) { page=await readExcalidrawLink({url:f.url,offset:page.nextOffset,expectedSha256:page.sha256},fetcher); joined+=page.sceneFragment; }
  assert.equal(JSON.parse(joined).elements[0].text,text);
});

test("fails closed for unavailable, redirected, damaged, interrupted and oversized responses",async()=>{
  const f=await fixture();
  for(const fetcher of [async()=>new Response(null,{status:404}),async()=>{throw new Error("redirect or timeout contains private detail");},async()=>new Response(new Uint8Array([0,1,2])),async()=>new Response(new Uint8Array(1024*1024+1)),async()=>new Response(new ReadableStream({start(c){c.error(new Error("private detail"));}}))]) {
    await assert.rejects(readExcalidrawLink({url:f.url},fetcher),error=>!error.message.includes("private detail"));
  }
  const corrupt=Buffer.from(f.bytes);corrupt[corrupt.length-1]^=1;
  await assert.rejects(readExcalidrawLink({url:f.url},async()=>new Response(corrupt)),/could not be decoded/);
  const bomb=await fixture([{type:"text",text:"a".repeat(3*1024*1024)}]);
  await assert.rejects(readExcalidrawLink({url:bomb.url},async()=>new Response(bomb.bytes)),/2 MiB/);
  const bad=await fixture([null]);
  await assert.rejects(readExcalidrawLink({url:bad.url},async()=>new Response(bad.bytes)),/Invalid/);
});

test("ChatGPT MCP lists and calls the read-only reader without database writes",async(t)=>{
  const f=await fixture();t.mock.method(globalThis,"fetch",async()=>new Response(f.bytes));
  const server=new ScopedMcpServer({name:"test",version:"1"});
  registerChatgptTools(server,new Proxy({}, {get(){throw new Error("Database must not be used");}}),"owner");
  const client=new Client({name:"test",version:"1"});const [a,b]=InMemoryTransport.createLinkedPair();
  await server.connect(b);await client.connect(a);
  try {
    const listed=(await client.listTools()).tools.find(t=>t.name==="read_excalidraw_link");
    assert.equal(listed.annotations.readOnlyHint,true);assert.equal(listed.annotations.openWorldHint,true);
    const result=await client.callTool({name:"read_excalidraw_link",arguments:{url:f.url}});
    assert.equal(result.isError,undefined); assert.match(result.structuredContent.sceneFragment,/Synthetic browser drawing/);
    const rejected=await client.callTool({name:"read_excalidraw_link",arguments:{url:"https://evil.test/"}});assert.equal(rejected.isError,true);
  } finally {await client.close();await server.close();}
});
