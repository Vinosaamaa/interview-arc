import { boundedResourceStream } from "./study-resource-body.ts";
import { ResourceError,MAX_RESOURCE_BYTES } from "./study-resource-policy.ts";
import { saveStudyResource,type ResourceDatabase,type ResourceBucket } from "./study-resources.ts";

export function publicSourceUrl(value:string){
 const url=new URL(value);
 if(url.protocol!=="https:"||url.username||url.password||url.port||!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(url.hostname)||/\.(localhost|local|internal|test|invalid)$/i.test(url.hostname))throw new ResourceError("Use a public HTTPS article URL without credentials.");
 return url;
}
// Production Workers also use global_fetch_strictly_public to reject private DNS destinations.
export async function importLearningSource(db:ResourceDatabase,bucket:ResourceBucket,owner:string,input:{url:string;title:string;operationId:string},fetcher:typeof fetch=fetch){
 const url=publicSourceUrl(input.url);
 if(/(^|\.)youtube\.com$|^youtu\.be$/.test(url.hostname))throw new ResourceError("This is a video, not an article. Retrieve its actual captions with available transcript/browser tools, then save_learning_source_text; if unavailable, upload its transcript export. A video description is not the transcript.");
 const response=await fetcher(url,{redirect:"error",signal:AbortSignal.timeout(30000),headers:{Accept:"text/html,text/plain,application/pdf"}});
 if(!response.ok||!response.body)throw new ResourceError("The source could not be read publicly. Upload the saved HTML/PDF or use the final public URL. No subscription access was attempted.");
 const type=(response.headers.get("content-type")??"").split(";")[0].toLowerCase();
 const extension=type==="text/html"?"html":type==="application/pdf"?"pdf":type==="text/plain"?"txt":null;
 if(!extension)throw new ResourceError("This URL did not return an article or PDF. Upload the original file instead.");
 if(Number(response.headers.get("content-length"))>MAX_RESOURCE_BYTES)throw new ResourceError("Source exceeds 25 MB.",413);
 const limited=boundedResourceStream(response.body,MAX_RESOURCE_BYTES),bytes=new Uint8Array(await new Response(limited.stream).arrayBuffer());
 return {...await saveStudyResource(db,bucket,owner,{operationId:input.operationId,title:input.title},{name:`source.${extension}`,bytes}),sourceUrl:url.href,acquisition:"public_url",notice:"Read every source fragment and inspect available originals before summarizing. A successful download can still be a login page, excerpt or missing external assets; report actual coverage."};
}
