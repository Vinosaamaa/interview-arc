export type ReaderDiagnosticEvent = {
  at: number;
  kind: string;
  surface: string;
  detail?: Record<string, boolean | number | string | null>;
};

export type ReaderDiagnosticSnapshot = {
  version: 1;
  startedAt: string;
  frozen: boolean;
  events: ReaderDiagnosticEvent[];
};

const MAX_EVENTS = 300;
const SAFE_TOKEN = /^[a-z0-9_.:-]{1,80}$/i;
const SESSION_KEY = "interview-arc-reader-trace-v1";
let browserBuffer: ReaderDiagnosticBuffer | null = null;
let pendingNavigation: { destination: string; startedAt: number } | null = null;

function safeToken(value: unknown, fallback = "unknown") {
  return typeof value === "string" && SAFE_TOKEN.test(value) ? value : fallback;
}

function safeDetail(detail: ReaderDiagnosticEvent["detail"]) {
  if (!detail) return undefined;
  return Object.fromEntries(Object.entries(detail).flatMap(([key, value]) => {
    if (!SAFE_TOKEN.test(key)) return [];
    if (typeof value === "string") return [[key, safeToken(value)]];
    if (typeof value === "number" && Number.isFinite(value)) return [[key, Math.round(value * 1000) / 1000]];
    if (typeof value === "boolean" || value === null) return [[key, value]];
    return [];
  }));
}

function safeStartedAt(value: unknown) {
  if (typeof value !== "string") return new Date().toISOString();
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString();
}

export class ReaderDiagnosticBuffer {
  readonly startedAt: string;
  private events: ReaderDiagnosticEvent[] = [];
  private frozen = false;

  constructor(snapshot?: Partial<ReaderDiagnosticSnapshot>) {
    this.startedAt = safeStartedAt(snapshot?.startedAt);
    for (const event of snapshot?.events ?? []) this.record(event);
    this.frozen = snapshot?.frozen === true;
  }

  record(event: ReaderDiagnosticEvent, force = false) {
    if (this.frozen && !force) return;
    this.events.push({
      at: Math.max(0, Math.round(event.at * 1000) / 1000),
      kind: safeToken(event.kind),
      surface: safeToken(event.surface),
      detail: safeDetail(event.detail),
    });
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }

  markFlash(surface: string, automatic = false) {
    if (this.frozen) return;
    this.record({
      at: typeof performance === "undefined" ? 0 : performance.now(),
      kind: automatic ? "flash-marker-auto" : "flash-marker-manual",
      surface,
    }, true);
    this.frozen = true;
  }

  reset() {
    this.events = [];
    this.frozen = false;
  }

  isFrozen() {
    return this.frozen;
  }

  snapshot(): ReaderDiagnosticSnapshot {
    return {
      version: 1,
      startedAt: this.startedAt,
      frozen: this.frozen,
      events: this.events.map((event) => ({
        ...event,
        detail: event.detail ? { ...event.detail } : undefined,
      })),
    };
  }
}

export function readerDiagnosticEnabled(search: string) {
  return new URLSearchParams(search).get("readerDebug") === "1";
}

export function getReaderDiagnosticBuffer() {
  if (!browserBuffer) {
    let restored: Partial<ReaderDiagnosticSnapshot> | undefined;
    if (typeof window !== "undefined") {
      try {
        restored = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) ?? "null") ?? undefined;
      } catch {
        window.sessionStorage.removeItem(SESSION_KEY);
      }
    }
    browserBuffer = new ReaderDiagnosticBuffer(restored);
  }
  if (typeof window !== "undefined") {
    // Expose the buffer by reference for local automation without cloning the
    // rolling event array on every diagnostic event.
    Reflect.set(window, "__INTERVIEW_ARC_READER_TRACE__", browserBuffer);
  }
  return browserBuffer;
}

export function persistReaderDiagnosticBuffer() {
  if (typeof window === "undefined" || !readerDiagnosticEnabled(window.location.search)) return;
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(getReaderDiagnosticBuffer().snapshot()));
}

export function markReaderFlash(surface: string, automatic = false) {
  if (typeof window === "undefined" || !readerDiagnosticEnabled(window.location.search)) return;
  getReaderDiagnosticBuffer().markFlash(safeToken(surface), automatic);
  persistReaderDiagnosticBuffer();
}

export function resetReaderDiagnosticBuffer() {
  if (typeof window === "undefined") return;
  getReaderDiagnosticBuffer().reset();
  window.sessionStorage.removeItem(SESSION_KEY);
}

export function recordReaderDiagnostic(
  kind: string,
  surface: string,
  detail?: ReaderDiagnosticEvent["detail"],
) {
  if (typeof window === "undefined" || !readerDiagnosticEnabled(window.location.search)) return;
  getReaderDiagnosticBuffer().record({ at: performance.now(), kind, surface, detail });
}

export function startNavigationDiagnostic(destination: string, source: string) {
  if (typeof window === "undefined" || !readerDiagnosticEnabled(window.location.search)) return;
  const safeDestination = safeToken(destination);
  pendingNavigation = { destination: safeDestination, startedAt: performance.now() };
  recordReaderDiagnostic("navigation-start", safeDestination, { source: safeToken(source) });
}

export function recordNavigationDiagnostic(phase: "commit" | "paint" | "settled", destination: string) {
  if (typeof window === "undefined" || !readerDiagnosticEnabled(window.location.search)) return;
  const safeDestination = safeToken(destination);
  if (!pendingNavigation || pendingNavigation.destination !== safeDestination) return;
  recordReaderDiagnostic(`navigation-${phase}`, safeDestination, {
    duration: performance.now() - pendingNavigation.startedAt,
  });
  if (phase === "settled") {
    persistReaderDiagnosticBuffer();
    pendingNavigation = null;
  }
}
