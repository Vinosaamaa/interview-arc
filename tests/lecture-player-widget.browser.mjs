import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright-core';
import { lecturePlayerHtml } from '../mcp-worker/lecture-player-widget.ts';
import { lectureWavHeader } from '../db/lecture-stream.ts';

// A sandboxed MCP Apps bridge reproduction. This tests our widget, not the
// consumer ChatGPT host or physical mobile background/lock-screen behavior.
const media=Buffer.concat([Buffer.from(lectureWavHeader(6*48000)),Buffer.alloc(6*48000)]);
const host=`<!doctype html><html><body><iframe title="Lecture" sandbox="allow-scripts" allow="autoplay" src="/widget" style="width:100%;height:900px;border:0"></iframe><script>
let revision=0,position=0,ready=false,generated=[];
function payload(){return {structuredContent:{ready,speechConfigured:true,lecture:{lectureId:'synthetic-widget',title:'Synthetic lecture in ChatGPT',wordCount:7200,estimatedMinutes:60,cursor:{revision,chunkIndex:position>=3?1:0,offsetSeconds:position%3},chunks:[0,1].map(index=>({index,sectionId:'section-'+index,sectionTitle:'Section '+(index+1),audio:ready?{state:'ready',duration_seconds:3}:null}))}},_meta:{audioUrl:ready?'https://limitless-mcp.vinosama.workers.dev/lecture-media?ticket=synthetic':null}};}
window.addEventListener('message',event=>{const m=event.data;if(!m?.id)return;let result={};if(m.method==='tools/call'){const {name,arguments:a}=m.params;if(name==='generate_lecture_audio_section'){generated.push(a.chunkIndex);if(generated.length===2)ready=true;result={structuredContent:{ready:true}};}else if(name==='open_practice_lecture_player')result=payload();else if(name==='save_lecture_position'){if(a.expectedRevision!==revision)result={isError:true,content:[{type:'text',text:'Stale cursor'}]};else{revision++;position=a.chunkIndex*3+a.offsetSeconds;result={structuredContent:{revision}};}}}event.source.postMessage({jsonrpc:'2.0',id:m.id,result},'*');if(m.method==='ui/initialize')setTimeout(()=>event.source.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:payload()},'*'),10);});window.testState=()=>({revision,position,generated});
</script></body></html>`;
const server=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(req.url==='/widget'?lecturePlayerHtml:host);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let context;
try{
 await mkdir('.cache/lecture',{recursive:true});
 context=await chromium.launchPersistentContext(join(process.env.LOCALAPPDATA??join(homedir(),'AppData','Local'),'JobApplyChrome'),{executablePath:process.env.ARC_BROWSER_EXECUTABLE??'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',headless:true,viewport:{width:1100,height:1000},args:['--remote-debugging-port=9224']});
 await context.route('https://limitless-mcp.vinosama.workers.dev/lecture-media?*',async route=>{
   const range=route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);let start=0,end=media.length-1;if(range){start=Number(range[1]);if(range[2])end=Math.min(Number(range[2]),end);}
   await route.fulfill({status:range?206:200,headers:{'content-type':'audio/wav','accept-ranges':'bytes','access-control-allow-origin':'*',...(range?{'content-range':`bytes ${start}-${end}/${media.length}`}:{})},body:media.subarray(start,end+1)});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);
 const frame=page.frameLocator('iframe');
 await frame.getByRole('button',{name:'Generate lecture audio',exact:true}).click();
 await frame.getByText('Audio ready. Press Play.',{exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>window.testState().generated),[0,1]);
 const child=page.frames().find(f=>f.url().endsWith('/widget'));
 await child.waitForFunction(()=>document.querySelector('audio').readyState>=1);
 assert.equal(await child.evaluate(()=>document.querySelector('audio').duration),6);
 await page.screenshot({path:'.cache/lecture/chat-widget-desktop.png'});
 await page.setViewportSize({width:390,height:1000});
 assert.equal(await child.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'.cache/lecture/chat-widget-mobile.png'});
 await child.evaluate(()=>document.querySelector('audio').play());
 await child.waitForFunction(()=>document.querySelector('audio').currentTime>3.3);
 await child.evaluate(()=>document.querySelector('audio').pause());
 await page.waitForFunction(()=>window.testState().position>3);
 const saved=await page.evaluate(()=>window.testState().position);
 await frame.getByRole('button',{name:'Refresh / reconnect'}).click();
 await child.waitForFunction(p=>Math.abs(document.querySelector('audio').currentTime-p)<.1,saved);
 await child.evaluate(()=>document.querySelector('audio').play());
 await child.waitForFunction(()=>document.querySelector('audio').ended);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({sandboxBridge:'pass',generationControls:'pass',continuousBoundary:'pass',savedResume:'pass',ended:'pass',desktop:'pass',mobile390:'pass',physicalChatgptHost:'not exercised'}));
}finally{await context?.close();await new Promise(resolve=>server.close(resolve));}
