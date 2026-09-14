import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import {liveChatControlsHtml} from '../mcp-worker/live-chat-controls.ts';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(initial,hold=false){
 class Element{constructor(){this.children=[];this.value='';this.hidden=false;this.attributes={};}replaceChildren(){this.children=[];}appendChild(child){this.children.push(child);}setAttribute(k,v){this.attributes[k]=v;}focus(){}getBoundingClientRect(){return {height:300};}}
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const window=new EventTarget(),messages=[];let state=initial??{other:'preserved'},reply;
 const deliver=data=>{const e=new Event('message');Object.assign(e,{data,source:window.parent});window.dispatchEvent(e);};
 window.openai={widgetState:state,setWidgetState(s){state=JSON.parse(JSON.stringify(s));window.openai.widgetState=state;}};
 window.parent={postMessage(m){if(!m.id)return;queueMicrotask(()=>{if(m.method==='ui/initialize'){deliver({jsonrpc:'2.0',id:m.id,result:{}});return;}assert.equal(m.method,'ui/message');messages.push(JSON.parse(JSON.stringify(m.params)));reply=(result={},error)=>deliver({jsonrpc:'2.0',id:m.id,result,error});if(!hold)reply();});}};
 const document={getElementById:get,createElement:()=>new Element(),querySelector:get,addEventListener(){}};
 runInNewContext(liveChatControlsHtml.match(/<script>([\s\S]*)<\/script>/)[1],{window,document,crypto,ResizeObserver:class{observe(){}},setTimeout,clearTimeout,Error});
 return {get,messages,state:()=>state,reply:(...args)=>reply(...args),submit(label,message){get('label').value=label;get('message').value=message;get('save').onclick();}};
}
test('standalone controls send only the selected message and suppress pending clicks',async()=>{
 const f=fixture(undefined,true);await tick();assert.equal(f.get('buttons').children.length,1);assert.equal(f.messages.length,0);
 const send=f.get('buttons').children[0].onclick();await tick();await f.get('buttons').children[0].onclick();assert.equal(f.messages.length,1);
 assert.deepEqual(f.messages[0],{role:'user',content:[{type:'text',text:'Continue'}]});assert.equal(f.get('add').disabled,true);
 f.reply();await send;assert.equal(f.get('add').disabled,false);assert.equal(f.get('status').textContent,'Sent to ChatGPT.');
});
test('multiple buttons independently edit and persist labels and exact multiline messages',async()=>{
 const f=fixture();await tick();for(const [name,message] of [['Example','Give an example.'],['Custom','  First line.\nSecond line.  ']]){f.get('add').onclick();f.submit(name,message);}
 assert.equal(f.get('buttons').children.length,3);assert.equal(f.messages.length,0);assert.equal(f.state().other,'preserved');
 f.get('edit').onclick();f.get('buttons').children[1].onclick();f.submit('Explain','Explain the example.');assert.equal(f.messages.length,0);
 const restored=fixture(f.state());await tick();assert.deepEqual(restored.get('buttons').children.map(b=>b.textContent),['Continue','Explain','Custom']);
 await restored.get('buttons').children[2].onclick();assert.equal(restored.messages[0].content[0].text,'  First line.\nSecond line.  ');
 await restored.get('buttons').children[1].onclick();assert.equal(restored.messages[1].content[0].text,'Explain the example.');
});
test('cancel, blank input, delete and undo do not accidentally send',async()=>{
 const f=fixture();await tick();f.get('add').onclick();f.submit('',' ');assert.equal(f.get('editor').hidden,false);assert.equal(f.get('buttons').children.length,1);
 f.get('cancel').onclick();f.get('edit').onclick();f.get('buttons').children[0].onclick();f.get('delete').onclick();assert.equal(f.get('buttons').children.length,0);
 f.get('undo').onclick();assert.equal(f.get('buttons').children[0].textContent,'Continue');assert.equal(f.messages.length,0);
});
test('rejected bridge calls remain retryable without an automatic second send',async()=>{
 const f=fixture(undefined,true);await tick();const send=f.get('buttons').children[0].onclick();await tick();f.reply({isError:true});await send;
 assert.equal(f.messages.length,1);assert.match(f.get('status').textContent,/Check the chat/);assert.equal(f.get('buttons').children[0].disabled,false);
});
