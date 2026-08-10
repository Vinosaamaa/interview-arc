// Turns a thrown database error into an actionable message. The most common
// first-run failure is a missing table because migrations have not been applied
// to the real D1 database yet.
export function toRouteErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const detail = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const combined = `${message}\n${detail}`;

  if (combined.includes("no such table") || combined.includes("D1 binding")) {
    return "Live-state tables are unavailable. For local development run `pnpm dev:prepare`; production applies migrations through the deployment workflow.";
  }

  return message;
}

export class RouteBodyTooLargeError extends Error {
  constructor() {
    super("The request body is too large.");
    this.name = "RouteBodyTooLargeError";
  }
}

export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new RouteBodyTooLargeError();
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new RouteBodyTooLargeError();
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel("request body rejected").catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
