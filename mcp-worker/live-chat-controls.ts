import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const liveChatControlsUri = "ui://interview-arc/live-chat-controls-v1.html";
export const liveChatControlsHtml = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Live Chat Controls</title>
<style>
:root{color-scheme:light dark;--paper:#fbfcfa;--ink:#102a2a;--muted:#617470;--line:#c8d8d3;--accent:#0f5f5a;--well:#edf3f1}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 system-ui,sans-serif}main{padding:20px;max-width:620px;margin:auto}header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px}h1,h2{font-size:20px;line-height:1.25;margin:0;font-weight:650;letter-spacing:-.025em}button,input,textarea{font:inherit;color:inherit}button{cursor:pointer;min-height:44px;border:1px solid var(--line);border-radius:9px;padding:10px 14px;background:var(--paper)}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid var(--accent);outline-offset:3px}.quiet{border:0;background:transparent;color:var(--accent)}#buttons{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;max-height:390px;overflow:auto;padding:3px;margin:-3px}.shortcut{min-height:64px;background:var(--well);font-weight:550;overflow-wrap:anywhere;white-space:pre-wrap}.shortcut:first-child,#save{background:var(--accent);color:var(--paper);border-color:var(--accent)}#add,#save{width:100%;margin-top:12px}#add{border-color:var(--accent);color:var(--accent)}#hint,#status{font-size:13px;color:var(--muted);margin:12px 0 0}label{display:block;font-size:14px;font-weight:550;margin:16px 0 6px}input,textarea{width:100%;border:1px solid var(--line);border-radius:8px;background:var(--paper);padding:11px}textarea{min-height:124px;resize:vertical}#delete{display:block;margin:10px auto 0;color:#b63823}#status:empty{display:none}[hidden]{display:none!important}@media(prefers-color-scheme:dark){:root{--paper:#122524;--ink:#e8f2ee;--muted:#b1c6bf;--line:#3d5750;--accent:#b9db57;--well:#1d3531}#delete{color:#ffb5a5}}@media(max-width:340px){#buttons{grid-template-columns:1fr}}
</style></head><body><main>
<section id="collection"><header><h1>Live Chat Controls</h1><button id="edit" class="quiet" aria-pressed="false">Edit</button></header><div id="buttons" aria-label="Your buttons"></div><button id="add">+ Add button</button><p id="hint">Tap a button to send its saved message.</p></section>
<section id="editor" hidden><header><h2 id="editorTitle">Edit button</h2><button id="cancel" class="quiet" type="button">Cancel</button></header><label for="label">Button name</label><input id="label" maxlength="80" required autocomplete="off"><label for="message">Message to ChatGPT</label><textarea id="message" maxlength="4000" required></textarea><p id="hintText">Only this text will be sent.</p><button id="save" type="button">Save button</button><button id="delete" class="quiet" type="button">Delete button</button></section>
<p id="status" role="status" aria-live="polite"></p><button id="undo" class="quiet" hidden>Undo delete</button>
</main><script>
const $=id=>document.getElementById(id),pending=new Map();
let nextId=1,buttons=[{id:'continue',label:'Continue',message:'Continue'}],editing=false,editingId=null,sending=false,touched=false,deleted=null;
function restore(state=window.openai?.widgetState){if(touched)return;const saved=state?.liveChatButtons;if(Array.isArray(saved)&&saved.every(b=>b&&typeof b.id==='string'&&typeof b.label==='string'&&b.label.trim()&&b.label.length<=80&&typeof b.message==='string'&&b.message.trim()&&b.message.length<=4000)&&new Set(saved.map(b=>b.id)).size===saved.length)buttons=saved.map(b=>({id:b.id,label:b.label,message:b.message}));}
function persist(){touched=true;const failed=()=>{$('status').textContent='Saved for this visit. This chat could not remember the changes.';};try{if(!window.openai?.setWidgetState){failed();return;}Promise.resolve(window.openai.setWidgetState({...window.openai.widgetState,liveChatButtons:buttons})).catch(failed);}catch{failed();}}
function render(){
 $('buttons').replaceChildren();
 for(const item of buttons){const b=document.createElement('button');b.type='button';b.className='shortcut';b.textContent=item.label;b.disabled=sending;b.setAttribute('aria-label',editing?'Edit '+item.label:item.label);b.onclick=()=>editing?openEditor(item):send(item);$('buttons').appendChild(b);}
 $('edit').textContent=editing?'Done':'Edit';$('edit').setAttribute('aria-pressed',String(editing));$('edit').disabled=sending||buttons.length===0;$('add').disabled=sending;
 $('hint').textContent=editing?'Choose a button to edit.':buttons.length?'Tap a button to send its saved message.':'Add your first button.';
}
function openEditor(item){if(sending)return;touched=true;editingId=item?.id??null;$('label').value=item?.label??'';$('message').value=item?.message??'';$('editorTitle').textContent=item?'Edit button':'Add button';$('delete').hidden=!item;$('collection').hidden=true;$('editor').hidden=false;$('status').textContent='';$('label').focus();}
function closeEditor(){editingId=null;$('editor').hidden=true;$('collection').hidden=false;render();$('add').focus();}
$('edit').onclick=()=>{editing=!editing;render();};$('add').onclick=()=>openEditor();$('cancel').onclick=closeEditor;
$('save').onclick=()=>{const label=$('label').value,message=$('message').value;if(!label.trim()||label.length>80||!message.trim()||message.length>4000){$('status').textContent='Enter a name and a message.';return;}if(editingId){buttons=buttons.map(b=>b.id===editingId?{...b,label,message}:b);}else buttons.push({id:crypto.randomUUID(),label,message});$('status').textContent='';persist();closeEditor();};
$('delete').onclick=()=>{const index=buttons.findIndex(b=>b.id===editingId);if(index<0)return;deleted={item:buttons[index],index};buttons.splice(index,1);persist();closeEditor();$('status').textContent='Button deleted.';$('undo').hidden=false;};
$('undo').onclick=()=>{if(!deleted)return;buttons.splice(deleted.index,0,deleted.item);deleted=null;persist();render();$('undo').hidden=true;$('status').textContent='Button restored.';};
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('editor').hidden)closeEditor();});
function notify(method,params){window.parent.postMessage({jsonrpc:'2.0',method,params},'*');}
function request(method,params){const id=nextId++;return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{pending.delete(id);reject(Error('Timed out'));},15000);pending.set(id,{resolve,reject,timeout});window.parent.postMessage({jsonrpc:'2.0',id,method,params},'*');});}
async function send(item){if(sending||editing)return;sending=true;render();$('status').textContent='Sending…';try{const result=await request('ui/message',{role:'user',content:[{type:'text',text:item.message}]});if(result?.isError)throw Error('Rejected');$('status').textContent='Sent to ChatGPT.';}catch{$('status').textContent='Could not confirm sending. Check the chat before retrying, or copy the message from Edit.';}finally{sending=false;render();}}
window.addEventListener('message',event=>{if(event.source!==window.parent)return;const m=event.data;if(m?.jsonrpc!=='2.0')return;const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timeout);if(m.error)p.reject(Error(m.error.message));else p.resolve(m.result);}});
window.addEventListener('openai:set_globals',event=>{restore(event.detail?.globals?.widgetState);render();});
new ResizeObserver(()=>notify('ui/notifications/size-changed',{height:document.querySelector('main').getBoundingClientRect().height})).observe(document.querySelector('main'));
restore();render();request('ui/initialize',{protocolVersion:'2026-01-26',appInfo:{name:'Live Chat Controls',version:'1.0.0'},appCapabilities:{}}).then(()=>{notify('ui/notifications/initialized',{});restore();render();}).catch(()=>{$('status').textContent='Open this widget inside ChatGPT to send messages.';});
</script></body></html>`;

export function registerLiveChatControls(server: McpServer) {
  server.registerResource("live-chat-controls", liveChatControlsUri, {}, async () => ({contents:[{
    uri:liveChatControlsUri, mimeType:"text/html;profile=mcp-app", text:liveChatControlsHtml,
    _meta:{ui:{prefersBorder:true,csp:{connectDomains:[],resourceDomains:[]}},"openai/widgetDescription":"Standalone Live Chat Controls. Add and edit buttons with individual labels and exact messages. Clicking a button sends its message; this does not detect or control native Voice turn endings."},
  }]}));
  server.registerTool("open_live_chat_controls", {
    title:"Open Live Chat Controls",
    description:"Open the standalone Live Chat Controls widget when the owner asks for chat control buttons, Continue buttons, or custom message shortcuts. Each button has an editable label and exact message. The owner can add more buttons. No lecture, audio, recording, or API credit is required. Opening or editing sends nothing; the owner clicks to send. These are chat follow-ups, not a native Live stop hook, and cannot guarantee a spoken response. Button settings stay with this widget when the host supports widget state.",
    inputSchema:{}, annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
    _meta:{ui:{resourceUri:liveChatControlsUri},"openai/outputTemplate":liveChatControlsUri},
  }, async()=>({content:[{type:"text" as const,text:"Live Chat Controls opened. Use Add button or Edit to customize buttons; click one to send its exact saved message."}],structuredContent:{widget:"live-chat-controls"}}));
}
