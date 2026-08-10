export type LiveUpdate = {
  type: "practice_changed";
  revision: number;
  scope: string;
  occurredAt: number;
};

export type LiveUpdateReconciliation = "timers" | "practice";

export function liveUpdateReconciliationMode(update: LiveUpdate): LiveUpdateReconciliation {
  return update.scope === "timer" ? "timers" : "practice";
}

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
  onUpdate: (update: LiveUpdate) => void | Promise<void>;
  onFallback: () => void | Promise<void>;
}) {
  let stopped = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let recoveryAttempt = 0;
  let authoritativeRecoveryNeeded = false;
  let recoverOnNextOpen = false;
  const latestRevisionByScope = new Map<string, number>();
  const pendingRevisionByScope = new Map<string, number>();

  const clearTimers = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (fallbackTimer) clearTimeout(fallbackTimer);
    if (recoveryTimer) clearTimeout(recoveryTimer);
    reconnectTimer = null;
    fallbackTimer = null;
    recoveryTimer = null;
  };

  const markReconciled = (scope: string, revision: number) => {
    const latestRevision = latestRevisionByScope.get(scope) ?? 0;
    if (revision > latestRevision) latestRevisionByScope.set(scope, revision);
    const pendingRevision = pendingRevisionByScope.get(scope) ?? 0;
    if (pendingRevision <= revision) pendingRevisionByScope.delete(scope);
  };

  const recoverAuthoritativeState = async (scheduleFailure = true) => {
    try {
      await onFallback();
      for (const [scope, revision] of pendingRevisionByScope) {
        const latestRevision = latestRevisionByScope.get(scope) ?? 0;
        if (revision > latestRevision) latestRevisionByScope.set(scope, revision);
      }
      pendingRevisionByScope.clear();
      authoritativeRecoveryNeeded = false;
      recoveryAttempt = 0;
    } catch {
      authoritativeRecoveryNeeded = true;
      recoveryAttempt += 1;
      if (scheduleFailure) scheduleRecovery();
    }
  };

  const scheduleRecovery = () => {
    if (stopped
        || recoveryTimer
        || (!authoritativeRecoveryNeeded && pendingRevisionByScope.size === 0)) return;
    recoveryTimer = setTimeout(async () => {
      recoveryTimer = null;
      if (stopped
          || (!authoritativeRecoveryNeeded && pendingRevisionByScope.size === 0)) return;
      await recoverAuthoritativeState();
    }, boundedFallbackDelay(recoveryAttempt, Math.random()));
  };

  const scheduleFallback = () => {
    if (stopped || fallbackTimer) return;
    fallbackTimer = setTimeout(async () => {
      fallbackTimer = null;
      if (stopped || socket?.readyState === WebSocket.OPEN) return;
      await recoverAuthoritativeState(false);
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
      if (recoverOnNextOpen) {
        recoverOnNextOpen = false;
        if (recoveryTimer) clearTimeout(recoveryTimer);
        recoveryTimer = null;
        void recoverAuthoritativeState();
      }
    });
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      const update = parseLiveUpdate(event.data);
      if (!update) return;
      const latestRevision = latestRevisionByScope.get(update.scope) ?? 0;
      if (update.revision <= latestRevision) return;
      void Promise.resolve()
        .then(() => onUpdate(update))
        .then(() => markReconciled(update.scope, update.revision))
        .catch(() => {
          const reconciledRevision = latestRevisionByScope.get(update.scope) ?? 0;
          if (update.revision <= reconciledRevision) return;
          const pendingRevision = pendingRevisionByScope.get(update.scope) ?? 0;
          if (update.revision > pendingRevision) {
            pendingRevisionByScope.set(update.scope, update.revision);
          }
          scheduleRecovery();
        });
    });
    socket.addEventListener("close", () => {
      if (stopped) return;
      authoritativeRecoveryNeeded = true;
      recoverOnNextOpen = true;
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
