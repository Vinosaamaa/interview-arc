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
