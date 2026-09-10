const UPSTREAM = "https://mcp.excalidraw.com/mcp";
const MAX = 2 * 1024 * 1024;
const TOOLS = new Set(["read_me", "create_view", "export_to_excalidraw", "save_checkpoint", "read_checkpoint"]);
const METHODS = new Set(["initialize", "notifications/initialized", "ping", "tools/list", "tools/call", "resources/list", "resources/templates/list", "resources/read"]);
const reply = (id: unknown, result: unknown) => Response.json({ jsonrpc: "2.0", id, result }, { headers: { "Cache-Control": "no-store" } });

async function bounded(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) throw new Error("Empty response.");
  const reader = response.body.getReader();
  let bytes = new Uint8Array(Math.min(limit, 65536)); let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      const nextSize = size + value.length;
      if (nextSize > limit) { await reader.cancel(); throw new Error("Drawing exceeds the supported size."); }
      if (nextSize > bytes.length) {
        const grown = new Uint8Array(Math.min(limit, Math.max(nextSize, bytes.length * 2)));
        grown.set(bytes.subarray(0, size)); bytes = grown;
      }
      bytes.set(value, size); size = nextSize;
    }
  } finally { reader.releaseLock(); }
  return bytes.subarray(0, size);
}

function frame(...parts: Uint8Array[]): Buffer {
  const version = Buffer.alloc(4); version.writeUInt32BE(1);
  return Buffer.concat([version, ...parts.flatMap(part => {
    const size = Buffer.alloc(4); size.writeUInt32BE(part.length); return [size, part];
  })]);
}

// Same encrypted v2 snapshot format as the official Excalidraw MCP. Only the
// failing upload moves to Cloudflare; canvas rendering and checkpoints remain upstream.
export async function exportExcalidrawScene(json: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (typeof json !== "string" || Buffer.byteLength(json) > MAX) throw new Error("Drawing exceeds the 2 MiB limit.");
  const scene = JSON.parse(json);
  if (scene?.type !== "excalidraw" || !Array.isArray(scene.elements) || !scene.elements.length || scene.elements.length > 10000 || scene.elements.some((e: unknown) => !e || typeof e !== "object" || Array.isArray(e))) throw new Error("Supply a nonempty Excalidraw scene.");
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 128 }, true, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const input = new Response(frame(Buffer.from("{}"), Buffer.from(json))).body!;
  const compressed = await bounded(new Response(input.pipeThrough(new CompressionStream("deflate"))), MAX + 65536);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new Uint8Array(compressed));
  const bytes = frame(Buffer.from(JSON.stringify({ version: 2, compression: "pako@1", encryption: "AES-GCM" })), iv, new Uint8Array(encrypted));
  if (bytes.length > 1024 * 1024) throw new Error("Compressed drawing exceeds the 1 MiB limit.");
  const response = await fetcher("https://json.excalidraw.com/api/v2/post/", { method: "POST", body: bytes, redirect: "manual", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Excalidraw rejected the export.");
  const result = JSON.parse(new TextDecoder().decode(await bounded(response, 4096)));
  if (typeof result.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(result.id)) throw new Error("Excalidraw returned an invalid export receipt.");
  const exported = await crypto.subtle.exportKey("jwk", key);
  return `https://excalidraw.com/#json=${result.id},${exported.k}`;
}

/** Called only after the existing Arc OAuth owner verification succeeds. */
export async function routeExcalidrawProxy(request: Request, fetcher: typeof fetch = fetch): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return new Response(null, { status: 415 });
  let call;
  try {
    call = JSON.parse(new TextDecoder().decode(await bounded(new Response(request.body), MAX + 65536)));
    if (!call || call.jsonrpc !== "2.0" || !METHODS.has(call.method)) throw new Error();
    if (call.method === "tools/call" && !TOOLS.has(call.params?.name)) throw new Error();
    if (call.method === "resources/read" && call.params?.uri !== "ui://excalidraw/mcp-app.html") throw new Error();
  } catch { return Response.json({ error: "Invalid or oversized Excalidraw request." }, { status: 400 }); }
  if (call.method === "tools/call" && call.params.name === "export_to_excalidraw") {
    try { return reply(call.id, { content: [{ type: "text", text: await exportExcalidrawScene(call.params.arguments?.json, fetcher) }] }); }
    catch { return reply(call.id, { isError: true, content: [{ type: "text", text: "Excalidraw export failed or timed out. Your canvas was not changed. Try exporting again." }] }); }
  }
  try {
    // Never forward OAuth, cookies, owner identity, or arbitrary request headers.
    const response = await fetcher(UPSTREAM, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify(call), redirect: "manual", signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error();
    if (response.status === 202 || response.status === 204) return new Response(null, { status: response.status });
    const bytes = await bounded(response, 6 * MAX);
    return new Response(bytes, { headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json", "Cache-Control": "no-store" } });
  } catch { return Response.json({ jsonrpc: "2.0", id: call.id ?? null, error: { code: -32603, message: "Excalidraw service unavailable. Retry the same request." } }, { status: 502 }); }
}
