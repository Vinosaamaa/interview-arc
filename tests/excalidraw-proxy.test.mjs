import test from 'node:test';
import assert from 'node:assert/strict';
import { exportExcalidrawScene, routeExcalidrawProxy } from '../mcp-worker/excalidraw-proxy.ts';
import { readExcalidrawLink } from '../mcp-worker/excalidraw-link.ts';

const scene={type:'excalidraw',version:2,elements:[{id:'label',type:'text',text:'export round trip',x:10,y:20}],files:{image:{dataURL:'data:image/png;base64,c3ludGhldGlj'}}};
const request=(method,params={})=>new Request('https://arc.test/chatgpt/mcp?surface=excalidraw',{method:'POST',headers:{Authorization:'Bearer never-forward',Cookie:'never-forward','Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:42,method,params})});

test('Cloudflare export produces a valid encrypted snapshot preserving the original and embedded files',async()=>{
  let uploaded;
  const url=await exportExcalidrawScene(JSON.stringify(scene),async(url,options)=>{
    assert.equal(url,'https://json.excalidraw.com/api/v2/post/');assert.equal(options.redirect,'manual');assert.ok(options.signal);
    uploaded=options.body;assert.ok(!Buffer.from(uploaded).includes(Buffer.from('export round trip')));
    return Response.json({id:'test-export'});
  });
  const decoded=await readExcalidrawLink({url},async()=>new Response(uploaded),true);
  assert.deepEqual(JSON.parse(decoded.sourceScene),scene);
});

test('widget export is intercepted locally and returns the official tool response shape',async()=>{
  const r=await routeExcalidrawProxy(request('tools/call',{name:'export_to_excalidraw',arguments:{json:JSON.stringify(scene)}}),async(url)=>{
    assert.equal(url,'https://json.excalidraw.com/api/v2/post/');return Response.json({id:'local-export'});
  });
  const body=await r.json();assert.equal(body.id,42);assert.match(body.result.content[0].text,/^https:\/\/excalidraw.com\/#json=local-export,/);
});

test('official renderer, checkpoint and discovery requests are preserved without forwarding credentials',async()=>{
  for(const [method,params] of [['resources/read',{uri:'ui://excalidraw/mcp-app.html'}],['tools/call',{name:'read_checkpoint',arguments:{id:'fixture'}}],['tools/list',{}],['initialize',{}]]){
    const r=await routeExcalidrawProxy(request(method,params),async(url,options)=>{
      assert.equal(url,'https://mcp.excalidraw.com/mcp');assert.equal(options.redirect,'manual');
      assert.equal(new Headers(options.headers).get('authorization'),null);assert.equal(new Headers(options.headers).get('cookie'),null);
      assert.equal(JSON.parse(options.body).method,method);assert.deepEqual(JSON.parse(options.body).params,params);
      return new Response('event: message\ndata: {"jsonrpc":"2.0","id":42,"result":{}}\n\n',{headers:{'Content-Type':'text/event-stream'}});
    });
    assert.equal(r.headers.get('content-type'),'text/event-stream');assert.match(await r.text(),/event: message/);
  }
});

test('rejects arbitrary methods, resources, tools and oversized input before network access',async()=>{
  const noFetch=async()=>{assert.fail('network request must not occur');};
  for(const r of [request('custom/admin'),request('tools/call',{name:'delete_everything'}),request('resources/read',{uri:'file:///private'}),new Request('https://arc.test',{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(3*1024*1024)})])assert.equal((await routeExcalidrawProxy(r,noFetch)).status,400);
  assert.equal((await routeExcalidrawProxy(new Request('https://arc.test',{method:'POST',body:'{}'}),noFetch)).status,415);
  await assert.rejects(exportExcalidrawScene(JSON.stringify({...scene,elements:[]}),noFetch));
  await assert.rejects(exportExcalidrawScene('x'.repeat(3*1024*1024),noFetch));
});

test('export failures return safe errors and never leak upstream details or key material',async()=>{
  for(const fetcher of [async()=>{throw new Error('SECRET upstream detail');},async()=>new Response('SECRET',{status:302,headers:{location:'https://evil.test'}}),async()=>Response.json({id:'../bad'})]){
    const r=await routeExcalidrawProxy(request('tools/call',{name:'export_to_excalidraw',arguments:{json:JSON.stringify(scene)}}),fetcher);
    const body=await r.json();assert.equal(body.result.isError,true);assert.ok(!JSON.stringify(body).includes('SECRET'));assert.match(body.result.content[0].text,/failed or timed out/);
  }
});

test('fragmented upstream responses remain exact and stop when the byte limit is exceeded',async()=>{
  const chunk = new Uint8Array(32768).fill(120);
  const response = await routeExcalidrawProxy(request('resources/read',{uri:'ui://excalidraw/mcp-app.html'}),async()=>new Response(new ReadableStream({start(controller){for(let i=0;i<5;i++)controller.enqueue(chunk);controller.close();}})));
  assert.equal((await response.text()),'x'.repeat(chunk.length*5));
  let cancelled=false;
  const oversized=await routeExcalidrawProxy(request('resources/read',{uri:'ui://excalidraw/mcp-app.html'}),async()=>new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}})));
  assert.equal(oversized.status,502);assert.equal(cancelled,true);
});
