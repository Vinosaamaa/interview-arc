import { ResourceError } from "./study-resource-policy.ts";

// Bound the stream without retaining a second complete copy of the upload.
export function boundedResourceStream(body: ReadableStream<Uint8Array>, limit: number) {
  let size = 0, exceeded = false;
  const stream = body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > limit) { exceeded = true; throw new ResourceError("Upload exceeds the supported size.", 413); }
      controller.enqueue(chunk);
    },
  }));
  return { stream, exceeded: () => exceeded };
}

export async function boundedResourceBody(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit) throw new ResourceError("Upload exceeds the supported size.",413);
  const reader = request.body?.getReader(); if (!reader) throw new ResourceError("Upload body is missing.");
  const chunks: Uint8Array[] = []; let size=0;
  try { while (true) { const {done,value}=await reader.read(); if(done)break; size+=value.length; if(size>limit)throw new ResourceError("Upload exceeds the supported size.",413); chunks.push(value); } }
  catch(e) { await reader.cancel().catch(()=>undefined); throw e; } finally { reader.releaseLock(); }
  const bytes=new Uint8Array(size); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;} return bytes;
}
