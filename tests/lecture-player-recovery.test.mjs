import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import {lecturePlayerHtml} from '../mcp-worker/lecture-player-widget.ts';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
// Run the shipped inline script and its MCP messages with a minimal DOM. The
// host state deliberately changes independently of the widget's cached result.
function fixture(options={}){
  class Element extends EventTarget {
    constructor(){super();this.dataset={};this.value='1';this.textContent='';this.hidden=false;this.disabled=false;this.paused=true;this.attributes=new Map();}
    setAttribute(k,v){this.attributes.set(k,v);}getAttribute(k){return this.attributes.get(k);}
    removeAttribute(k){this.attributes.delete(k);}toggleAttribute(k,on){if(on)this.setAttribute(k,'');else this.removeAttribute(k);}
    replaceChildren(){}appendChild(){}getBoundingClientRect(){return {height:800,left:0,width:390};}load(){}pause(){this.paused=true;}focus(){}
  }
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const document=Object.assign(new EventTarget(),{getElementById:get,querySelector:get,createElement:()=>new Element()});
  const window=new EventTarget(),spoken=[],calls=[],messages=[];
  get('continueMessage').value='Continue';
  let savedState=options.widgetState??{unrelated:'preserved'},replyToMessage,releaseSave;
  window.openai={widgetState:savedState,setWidgetState(state){savedState=state;window.openai.widgetState=state;}};
  const speech={getVoices:()=>[{voiceURI:'local',name:'Local',localService:true,lang:'en-US'}],speak:u=>spoken.push(u.text),cancel(){},addEventListener(){}};
  const text='First sentence. Second sentence.';
  let revision=1,offset=0,readFails=false;
  const payload=()=>({structuredContent:{ready:false,speechConfigured:false,lecture:{lectureId:'isolated-recovery',title:'Recovery',estimatedMinutes:1,fingerprint:'test',cursor:{revision,chunkIndex:0,characterOffset:offset,offsetSeconds:0},chunks:[{index:0,sectionId:'a',sectionTitle:'Section',characterCount:text.length}]}},_meta:{scriptFragment:{index:0,text}}});
  function message(data){const event=new Event('message');Object.assign(event,{data,source:window.parent});window.dispatchEvent(event);}
  window.parent={postMessage(m){if(!m.id)return;queueMicrotask(async()=>{
    if(m.method==='ui/initialize'){message({jsonrpc:'2.0',id:m.id,result:{}});queueMicrotask(()=>message({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:payload()}));return;}
    if(m.method==='ui/message'){messages.push(JSON.parse(JSON.stringify(m.params)));replyToMessage=(result={},error)=>message({jsonrpc:'2.0',id:m.id,result,error});if(!options.holdMessage)replyToMessage(options.messageResult??{});return;}
    const {name,arguments:a}=m.params;calls.push({name,...a});let result={};
    if(name==='open_practice_lecture_player'){
      if(readFails){message({jsonrpc:'2.0',id:m.id,error:{message:'Connection unavailable. Try reloading again.'}});return;}
      result=payload();
    }else if(name==='save_lecture_position'){
      if(options.holdSave)await new Promise(resolve=>{releaseSave=resolve;});
      if(a.expectedRevision!==revision){message({jsonrpc:'2.0',id:m.id,error:{message:"INVALID_ARGUMENT RuntimeException TextContent(text='The saved position changed in another player or chat. Reload it before resuming; no position was overwritten.')"}});return;}
      revision++;offset=a.characterOffset;result={structuredContent:{revision}};
    }
    message({jsonrpc:'2.0',id:m.id,result});
  });}};
  Object.assign(window,{speechSynthesis:speech,SpeechSynthesisUtterance:function(t){this.text=t;}});
  runInNewContext(lecturePlayerHtml.match(/<script>([\s\S]*)<\/script>/)[1],{window,document,SpeechSynthesisUtterance:window.SpeechSynthesisUtterance,ResizeObserver:class{observe(){}},setTimeout,clearTimeout,crypto,URL,Error});
  return {get,spoken,calls,messages,text,reply:(...args)=>replyToMessage(...args),releaseSave:()=>releaseSave(),savedState:()=>savedState,externalSave(n){revision++;offset=n;},failRead(v){readFails=v;},state:()=>({revision,offset})};
}

test('stale ChatGPT tool snapshot can reload safely, retry a failed read, then play',async()=>{
  const f=fixture();await tick();f.externalSave(f.text.length);
  await f.get('forward').onclick();await tick();
  assert.equal(f.get('recover').hidden,false);assert.equal(f.get('touchPlayer').disabled,true);
  assert.match(f.get('error').textContent,/another player/);assert.doesNotMatch(f.get('error').textContent,/INVALID_ARGUMENT|RuntimeException/);
  assert.deepEqual(f.state(),{revision:2,offset:f.text.length});
  f.failRead(true);await f.get('recover').onclick();await tick();
  assert.equal(f.get('recover').hidden,false);assert.equal(f.get('recover').disabled,false);assert.equal(f.get('touchPlayer').disabled,true);
  f.failRead(false);await f.get('recover').onclick();await tick();
  assert.equal(f.get('recover').hidden,true);assert.equal(f.get('touchPlayer').disabled,false);assert.equal(f.get('error').textContent,'');
  assert.deepEqual(f.state(),{revision:2,offset:f.text.length},'Reload is read-only and never replaces newer progress');
  const event=new Event('click');Object.assign(event,{detail:0});f.get('touchPlayer').dispatchEvent(event);await tick();
  assert.equal(f.spoken[0],'First sentence. ');assert.deepEqual(f.state(),{revision:3,offset:0});
  assert.equal(f.calls.filter(c=>c.name==='save_lecture_position').at(-1).expectedRevision,2);
});

test('Continue sends only the default text and suppresses repeated clicks while pending',async()=>{
  const f=fixture({holdMessage:true});await tick();
  assert.deepEqual(f.messages,[],'Rendering does not send a message');
  const first=f.get('continue').onclick();await tick();
  await f.get('continue').onclick();
  assert.equal(f.get('continue').disabled,true);
  assert.deepEqual(f.messages,[{role:'user',content:[{type:'text',text:'Continue'}]}]);
  f.reply();await first;
  assert.equal(f.get('continue').disabled,false);
  assert.equal(f.get('continueStatus').textContent,'Sent to ChatGPT.');
  assert.equal(f.calls.filter(c=>c.name==='save_lecture_position').length,0,'Idle follow-up does not change playback progress');
});

test('custom message preserves exact text, survives remount, and can reset',async()=>{
  const f=fixture();await tick();const custom='  Continue with an example.\nThen explain why.  ';
  f.get('continueMessage').value=custom;f.get('continueMessage').onchange();
  assert.equal(f.savedState().unrelated,'preserved');
  const restored=fixture({widgetState:f.savedState()});await tick();
  assert.equal(restored.get('continueMessage').value,custom);
  await restored.get('continue').onclick();
  assert.deepEqual(restored.messages,[{role:'user',content:[{type:'text',text:custom}]}]);
  restored.get('resetContinue').onclick();assert.equal(restored.savedState().continueMessage,'Continue');
});

test('blank messages stay editable; rejected sends do not claim success or retry',async()=>{
  const f=fixture({messageResult:{isError:true}});await tick();
  f.get('continueMessage').value=' \n ';await f.get('continue').onclick();
  assert.equal(f.messages.length,0);assert.equal(f.get('continueEditor').hidden,false);
  f.get('continueMessage').value='Continue';await f.get('continue').onclick();
  assert.equal(f.messages.length,1);assert.equal(f.get('continue').disabled,false);
  assert.match(f.get('continueStatus').textContent,/Check the chat before retrying/);
  assert.doesNotMatch(f.get('continueStatus').textContent,/Sent to/);
});

test('unsupported host method is a readable failure with no automatic fallback send',async()=>{
  const f=fixture({holdMessage:true});await tick();const sending=f.get('continue').onclick();await tick();
  f.reply(undefined,{code:-32601,message:'Method not found'});await sending;
  assert.equal(f.messages.length,1);assert.equal(f.get('continue').disabled,false);
  assert.match(f.get('continueStatus').textContent,/copy your message/);
});

test('Continue waits for the paused playback position before sending a follow-up',async()=>{
  const f=fixture({holdSave:true});await tick();
  const event=new Event('click');Object.assign(event,{detail:0});f.get('touchPlayer').dispatchEvent(event);await tick();
  assert.equal(f.spoken.length,1);
  const sending=f.get('continue').onclick();await tick();
  assert.equal(f.calls.filter(c=>c.name==='save_lecture_position').length,1);
  assert.equal(f.messages.length,0,'Host cannot remount the widget before the pause save settles');
  f.releaseSave();await sending;assert.equal(f.messages.length,1);
});
