export type LiveUpdateScope =
  | "timer"
  | "focus"
  | "practice"
  | "voice_intent"
  | "voice_capture"
  | "publication";

export type LiveUpdateNamespace = DurableObjectNamespace;

export class OwnerLiveUpdateHub {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/connect") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("WebSocket upgrade required.", { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server);
      const revision = Number(await this.state.storage.get<number>("revision") ?? 0);
      server.send(JSON.stringify({ type: "connected", revision }));
      const requestedProtocols = request.headers.get("sec-websocket-protocol") ?? "";
      const selectedProtocol = requestedProtocols.split(",").map((value) => value.trim())
        .find((value) => value === "interview-arc-live");
      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: selectedProtocol ? { "sec-websocket-protocol": selectedProtocol } : undefined,
      });
    }
    if (url.pathname === "/publish" && request.method === "POST") {
      const input = (await request.json()) as { scope?: LiveUpdateScope };
      const revision = Number(await this.state.storage.get<number>("revision") ?? 0) + 1;
      await this.state.storage.put("revision", revision);
      const event = JSON.stringify({
        type: "practice_changed",
        revision,
        scope: input.scope ?? "practice",
        occurredAt: Date.now(),
      });
      let attempted = 0;
      let delivered = 0;
      for (const socket of this.state.getWebSockets()) {
        attempted += 1;
        try {
          socket.send(event);
          delivered += 1;
        } catch {
          try { socket.close(1011, "delivery failed"); } catch {}
        }
      }
      return Response.json({
        revision,
        attempted,
        delivered,
        signalDelivered: delivered > 0,
      }, { status: delivered > 0 ? 200 : 503 });
    }
    return new Response("Not found.", { status: 404 });
  }

  webSocketMessage() {}
  webSocketClose() {}
}

function ownerStub(namespace: LiveUpdateNamespace, ownerId: string) {
  return namespace.get(namespace.idFromName(ownerId));
}

export function connectOwnerLiveUpdates(
  namespace: LiveUpdateNamespace,
  ownerId: string,
  request: Request,
) {
  const url = new URL("/connect", request.url);
  return ownerStub(namespace, ownerId).fetch(new Request(url, {
    method: "GET",
    headers: request.headers,
  }));
}

export async function publishOwnerLiveUpdate(
  namespace: LiveUpdateNamespace | undefined,
  ownerId: string,
  scope: LiveUpdateScope,
  options: { executionContext?: ExecutionContext; awaitDelivery?: boolean } = {},
) {
  const publish = async () => {
    if (!namespace) return false;
    const response = await ownerStub(namespace, ownerId).fetch("https://live-update.internal/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope }),
    });
    if (!response.ok) return false;
    const payload = await response.json() as { signalDelivered?: boolean };
    return payload.signalDelivered === true;
  };

  if (options.awaitDelivery || !options.executionContext) {
    try {
      return await publish();
    } catch {
      // D1/REST mutations are authoritative. A best-effort invalidation failure
      // must never make an already-committed mutation look unsuccessful; clients
      // recover through the bounded snapshot fallback.
      return false;
    }
  }

  options.executionContext.waitUntil(publish().catch(() => false));
  return true;
}
