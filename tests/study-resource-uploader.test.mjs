import assert from 'node:assert/strict';
import { Script, createContext } from 'node:vm';
import test from 'node:test';
import { resourceUploaderHtml } from '../mcp-worker/study-resource-uploader.ts';

function widget(host){
  const elements=new Map();
  function element(){return {disabled:false,hidden:false,textContent:'',files:[],children:[],append(...children){this.children.push(...children);},replaceChildren(){this.children=[];},getBoundingClientRect(){return {height:400};}};}
  const listeners=new Map(),parent={postMessage(){}};
  const window={openai:host,parent,addEventListener(name,callback){listeners.set(name,callback);}};
  const document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element,querySelector(){return element();}};
  const context=createContext({window,document,crypto,TextEncoder,Uint8Array,Array,Error,JSON,ResizeObserver:class{observe(){}}});
  const script=new Script(resourceUploaderHtml.match(/<script>([\s\S]*)<\/script>/)[1]);script.runInContext(context);
  return {elements,listeners,context};
}
async function settled(context){for(let i=0;i<100;i++){if(!new Script('busy').runInContext(context))return;await new Promise(r=>setTimeout(r,5));}throw Error('Picker did not finish');}
test('host picker preserves original identity across retry without persisting bytes or download URLs',async()=>{
  const payload=new TextEncoder().encode('Exact original\nreturn 42;');
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',payload)),n=>n.toString(16).padStart(2,'0')).join('');
  const calls=[],states=[];let uploads=0,downloads=0;
  const host={
    async uploadFile(file){uploads++;assert.equal(file.name,'original.txt');return {fileId:'file-synthetic-1'};},
    async getFileDownloadUrl({fileId}){assert.equal(fileId,'file-synthetic-1');return {downloadUrl:'https://files.oaiusercontent.com/temporary-'+(++downloads)};},
    async callTool(name,args){calls.push({name,args});return calls.length===1?{isError:true,content:[{type:'text',text:'Temporary save failure'}]}:{structuredContent:{resource:{resourceId:'resource-'+'a'.repeat(40),sourceSha256:sha}}};},
    setWidgetState(value){states.push(JSON.stringify(value));},
  };
  const {elements,context}=widget(host),input=elements.get('files');
  input.files=[{name:'original.txt',type:'text/plain',size:payload.byteLength,async arrayBuffer(){return payload.buffer;}}];input.onchange();await settled(context);
  assert.equal(elements.get('retry').hidden,false);assert.equal(uploads,1);
  await elements.get('retry').onclick();await settled(context);
  assert.equal(calls.length,2);assert.equal(uploads,1);assert.equal(downloads,2);
  assert.equal(calls[0].name,'save_study_resource_file');assert.equal(calls[0].args.operationId,calls[1].args.operationId);
  assert.equal(calls[1].args.file.file_name,'original.txt');assert.match(elements.get('status').textContent,/Originals saved/);
  assert.ok(states.every(s=>!s.includes('https:')&&!s.includes('arrayBuffer')&&!s.includes('Exact original')));
  assert.ok(states.at(-1).includes(sha));
});
test('unsupported hosts and oversized files cannot trigger uploads',async()=>{
  assert.equal(widget(undefined).elements.get('files').disabled,true);
  let uploads=0;const {elements,context}=widget({uploadFile(){uploads++;},getFileDownloadUrl(){},callTool(){},setWidgetState(){}});
  const input=elements.get('files');input.files=[{name:'too-large.bin',size:25*1024*1024+1}];input.onchange();await settled(context);
  assert.equal(uploads,0);assert.match(elements.get('jobs').children[0].children[1].textContent,/25 MB/);
});

test('a structured host rejection identifies the failed boundary without exposing download URLs',async()=>{
  const {elements,context,listeners}=widget({
    async selectFiles(){return [{fileId:'file-synthetic-2',fileName:'original.txt'}];},
    async getFileDownloadUrl(){throw {message:'File access denied at https://files.oaiusercontent.com/private?token=secret'};},
    async callTool(){assert.fail('Unauthorized files must not reach the save tool');},
    setWidgetState(){},
  });
  await elements.get('library').onclick();await settled(context);
  const status=elements.get('jobs').children[0].children[1].textContent;
  assert.match(status,/Get file download access: File access denied/);
  assert.ok(!status.includes('token=secret'));
  assert.match(status,/\[file URL\]/);
  listeners.get('openai:set_globals')();
  assert.match(elements.get('status').textContent,/Some uploads need attention/);
  assert.equal(elements.get('retry').hidden,false);
});
