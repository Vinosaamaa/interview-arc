export function parseLoopPayloadResponse<T extends { error?: string }>(
  status: number,
  contentType: string,
  bodyText: string,
): T {
  const json = contentType.toLowerCase().includes("application/json");
  if (!json) {
    throw new Error(`Loops could not be loaded (${status || "network"}).`);
  }
  let body: T;
  try {
    body = JSON.parse(bodyText) as T;
  } catch {
    throw new Error(`Loops could not be loaded (${status || "network"}).`);
  }
  if (status < 200 || status >= 300) {
    throw new Error(body.error || `Loops could not be loaded (${status}).`);
  }
  return body;
}

export function isAbortError(cause: unknown) {
  return (cause instanceof DOMException && cause.name === "AbortError")
    || (cause instanceof Error && cause.name === "AbortError");
}
