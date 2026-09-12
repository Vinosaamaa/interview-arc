import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const resourceUploaderUri = "ui://interview-arc/study-resource-uploader-v1.html";

// Use host-authorized file handles, never model-invented sandbox paths or URLs.
export const resourceUploaderHtml = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Save original study files</title><style>
:root{color-scheme:light dark;font:15px/1.5 system-ui,sans-serif}*{box-sizing:border-box}body{margin:0}main{padding:20px;max-width:700px;margin:auto}h1{font-size:22px;margin:4px 0 8px}.eyebrow{font-size:12px;letter-spacing:.14em}p{margin:8px 0}button,label.pick{display:inline-block;padding:10px 14px;border:1px solid GrayText;border-radius:8px;background:transparent;color:inherit;font:inherit;cursor:pointer}button:disabled{opacity:.5;cursor:default}.actions{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}[hidden]{display:none!important}label.pick{position:relative}label.pick:has(input:disabled){opacity:.5;cursor:default}label.pick:focus-within{outline:2px solid Highlight;outline-offset:3px}input[type=file]{position:absolute;width:1px;height:1px;opacity:0}li{margin:12px 0;overflow-wrap:anywhere}small{display:block}#status{white-space:pre-wrap;overflow-wrap:anywhere}button:focus-visible,input:focus-visible{outline:2px solid Highlight;outline-offset:3px}@media(prefers-color-scheme:dark){body{background:#111827;color:#f3f4f6}}
</style></head><body><main>
<p class="eyebrow">INTERVIEW ARC · STUDY LIBRARY</p><h1>Save your original files</h1>
<p>Choose files here, or select an existing ChatGPT attachment. HTML, PDF, TXT, Markdown, images and other files, up to 25 MB each.</p>
<p>The original stays unchanged in your private library. Reading support depends on the format; diagrams may need separate images.</p>
<div class="actions"><button id="library" disabled>Select from ChatGPT</button><label class="pick">Choose files <input id="files" type="file" multiple disabled></label><button id="retry" hidden>Retry unfinished</button></div>
<p id="status" role="status">Connecting to ChatGPT…</p><ul id="jobs" aria-label="File uploads"></ul>
</main><script>
const $=id=>document.getElementById(id);let busy=false;let jobs=[];
const state=window.openai?.widgetState; if(Array.isArray(state?.privateContent?.jobs))jobs=state.privateContent.jobs;
function persist(){window.openai?.setWidgetState({modelContent:{savedResources:jobs.filter(j=>j.resourceId).map(j=>({resourceId:j.resourceId,title:j.name,sourceSha256:j.sha256}))},privateContent:{jobs:jobs.map(({file,...j})=>j)}});}
function draw(){
  $('jobs').replaceChildren();for(const job of jobs){const li=document.createElement('li'),name=document.createElement('strong'),detail=document.createElement('small');name.textContent=job.name;detail.textContent=job.status||'Waiting';li.append(name,detail);$('jobs').append(li);}
  $('retry').hidden=busy||!jobs.some(j=>!j.resourceId&&(j.file||j.fileId));ready();
}
function ready(){const host=window.openai;const connected=typeof host?.getFileDownloadUrl==='function'&&typeof host?.callTool==='function';$('files').disabled=busy||!connected||typeof host?.uploadFile!=='function';$('library').disabled=busy||!connected||typeof host?.selectFiles!=='function';return connected;}
async function hash(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),n=>n.toString(16).padStart(2,'0')).join('');}
async function run(){if(busy)return;busy=true;draw();
  for(const job of jobs){if(job.resourceId)continue;try{
    if(job.file){if(!job.file.size||job.file.size>25*1024*1024)throw Error('Choose a non-empty file up to 25 MB.');job.expectedHash??=await hash(await job.file.arrayBuffer());}
    job.status='Authorizing file with ChatGPT…';draw();
    if(!job.fileId){if(!job.file)throw Error('Choose this file again to continue.');const uploaded=await window.openai.uploadFile(job.file);if(!uploaded?.fileId)throw Error('ChatGPT did not return a file handle. Choose the file again.');job.fileId=uploaded.fileId;}
    job.operationId??='chatgpt-file-'+await hash(new TextEncoder().encode(job.fileId));persist();
    const link=await window.openai.getFileDownloadUrl({fileId:job.fileId});if(!link?.downloadUrl)throw Error('ChatGPT did not authorize a download. Select the file again.');
    job.status='Saving exact original…';draw();
    const result=await window.openai.callTool('save_study_resource_file',{operationId:job.operationId,title:job.name.slice(0,300),file:{file_id:job.fileId,download_url:link.downloadUrl,file_name:job.name,mime_type:job.mime||'application/octet-stream'}});
    if(result?.isError)throw Error(result.content?.find(c=>c.type==='text')?.text||'Save was not confirmed. Retry the same file.');
    let data=result?.structuredContent;if(!data){const text=result?.content?.find(c=>c.type==='text')?.text;if(text)try{data=JSON.parse(text);}catch{}}
    const resource=data?.resource;if(!resource?.resourceId||!resource.sourceSha256)throw Error('The server did not confirm the saved original. Retry the same file.');
    if(job.expectedHash&&resource.sourceSha256!==job.expectedHash)throw Error('Original hash mismatch. Do not use this saved resource.');
    job.resourceId=resource.resourceId;job.sha256=resource.sourceSha256;job.status='Saved · '+resource.sourceSha256;delete job.file;
  }catch(error){job.status=error instanceof Error?error.message:'Upload was not confirmed.';}persist();draw();}
  busy=false;draw();$('status').textContent=jobs.every(j=>j.resourceId)?'Originals saved. ChatGPT can now find them with Interview Arc.':'Some uploads need attention. Retry keeps the same original identity.';
}
$('files').onchange=()=>{for(const file of Array.from($('files').files||[]))jobs.push({name:file.name,mime:file.type,file,status:'Waiting'});$('files').value='';void run();};
$('library').onclick=async()=>{if(busy)return;try{const selected=await window.openai.selectFiles();for(const f of selected||[]){if(!f.fileId||jobs.some(j=>j.fileId===f.fileId))continue;jobs.push({name:f.fileName||'Original file',mime:f.mimeType,fileId:f.fileId,status:'Waiting'});}persist();draw();if(selected?.length)void run();}catch(error){$('status').textContent=error instanceof Error?error.message:'File selection was not completed.';}};
$('retry').onclick=()=>void run();
function connected(){draw();if(!busy)$('status').textContent=ready()?'Select the originals to save.':'This ChatGPT host has not exposed file access. Reopen this panel in an updated ChatGPT app, or upload through your Interview Arc website.';}
window.addEventListener('openai:set_globals',connected);
window.addEventListener('message',event=>{if(event.source!==window.parent||event.data?.jsonrpc!=='2.0'||event.data?.id!=='arc-resource-init')return;if(event.data.error){$('status').textContent='ChatGPT could not connect this file picker.';return;}window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}},'*');connected();});
window.parent.postMessage({jsonrpc:'2.0',id:'arc-resource-init',method:'ui/initialize',params:{protocolVersion:'2026-01-26',appInfo:{name:'Interview Arc study library',version:'1.0.0'},appCapabilities:{}}},'*');
new ResizeObserver(()=>window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height:document.querySelector('main').getBoundingClientRect().height}},'*')).observe(document.querySelector('main'));
connected();
</script></body></html>`;

export function registerStudyResourceUploader(server: McpServer) {
  server.registerResource("study-resource-uploader", resourceUploaderUri, {}, async () => ({
    contents: [{ uri: resourceUploaderUri, mimeType: "text/html;profile=mcp-app", text: resourceUploaderHtml,
      _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
        "openai/widgetDescription": "Save exact original files into the private Interview Arc library using ChatGPT's authorized file picker." } }],
  }));
  server.registerTool("open_study_resource_uploader", {
    title: "Save original study files",
    description: "Open a file picker inside this ChatGPT conversation to save exact originals in the owner's Interview Arc library. Use when the owner asks to save attachments and a supported downloadable file input was not supplied automatically. The owner can choose files from their device or ChatGPT file library. Opening does not upload; the picker confirms saved identities. Never invent download URLs or use sandbox paths.",
    inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { resourceUri: resourceUploaderUri, visibility: ["model", "app"] }, "openai/outputTemplate": resourceUploaderUri, "openai/widgetAccessible": true },
  }, async () => ({ structuredContent: { maxFileBytes: 25 * 1024 * 1024 },
    content: [{ type: "text" as const, text: "Choose or select original files in this in-chat panel. No file has been saved merely by opening the picker. After a confirmed save, use search_study_resources and get_study_resource to read it." }] }));
}
