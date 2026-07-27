export type LiveUpdate = {
  type: "practice_changed";
  revision: number;
  scope: string;
  occurredAt: number;
};

export function parseLiveUpdate(value: string): LiveUpdate | null {
  try {
    const parsed = JSON.parse(value) as Partial<LiveUpdate>;
    if (
      parsed.type !== "practice_changed"
      || !Number.isInteger(parsed.revision)
      || Number(parsed.revision) <= 0
      || typeof parsed.scope !== "string"
      || !Number.isFinite(parsed.occurredAt)
    ) return null;
    return parsed as LiveUpdate;
  } catch {
    return null;
  }
}

export function boundedFallbackDelay(attempt: number, jitter: number): number {
  const base = Math.min(120_000, 15_000 * (2 ** Math.max(0, attempt)));
  return Math.round(base * (1 + Math.max(0, Math.min(1, jitter)) * 0.15));
}

export function subscribeToLiveUpdates({
  url,
  protocols,
  onUpdate,
  onFallback,
}: {
  url: string;
  protocols?: string[];
  onUpdate: (update: LiveUpdate) => void;
  onFallback: () => void | Promise<void>;
}) {
  let stopped = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let latestRevision = 0;

  const clearTimers = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (fallbackTimer) clearTimeout(fallbackTimer);
    reconnectTimer = null;
    fallbackTimer = null;
  };

  const scheduleFallback = () => {
    if (stopped || fallbackTimer) return;
    fallbackTimer = setTimeout(async () => {
      fallbackTimer = null;
      if (stopped || socket?.readyState === WebSocket.OPEN) return;
      await onFallback();
      attempt += 1;
      scheduleFallback();
    }, boundedFallbackDelay(attempt, Math.random()));
  };

  const connect = () => {
    if (stopped) return;
    socket = protocols?.length ? new WebSocket(url, protocols) : new WebSocket(url);
    socket.addEventListener("open", () => {
      attempt = 0;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      fallbackTimer = null;
    });
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      const update = parseLiveUpdate(event.data);
      if (!update || update.revision <= latestRevision) return;
      latestRevision = update.revision;
      onUpdate(update);
    });
    socket.addEventListener("close", () => {
      if (stopped) return;
      scheduleFallback();
      const reconnectDelay = Math.min(30_000, 1_000 * (2 ** Math.min(attempt, 5)));
      reconnectTimer = setTimeout(connect, reconnectDelay);
    });
    socket.addEventListener("error", () => socket?.close());
  };

  connect();
  return () => {
    stopped = true;
    clearTimers();
    socket?.close(1000, "client closed");
    socket = null;
  };
}
