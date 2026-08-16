/**
 * Keep `vinext dev` alive when a background inspector/fetch parses binary
 * bytes as JSON. Vinext's socket-error backstop absorbs only ECONNRESET /
 * EPIPE / ECONNABORTED and rethrows everything else, which kills the preview.
 */
const GUARD_FLAG = Symbol.for("interview-arc.localPreviewGuards");

export function shouldKeepLocalPreviewAlive(err) {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? err.code : undefined;
  if (code === "ECONNRESET" || code === "EPIPE" || code === "ECONNABORTED") return true;
  return err instanceof SyntaxError && /is not valid JSON/.test(err.message);
}

function guardListener(err) {
  if (process.env.VINEXT_PRERENDER === "1") throw err;
  if (shouldKeepLocalPreviewAlive(err)) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`[interview-arc] local preview kept running after ${detail}`);
    return;
  }
  throw err;
}

function patchResponseJson() {
  if (typeof Response === "undefined" || typeof Response.prototype.json !== "function") return;
  if (Response.prototype.json[GUARD_FLAG]) return;
  const originalJson = Response.prototype.json;
  async function json(...args) {
    try {
      return await originalJson.apply(this, args);
    } catch (err) {
      const url = typeof this?.url === "string" ? this.url : "";
      if (
        shouldKeepLocalPreviewAlive(err)
        && /\/json(?:\/|$|\?)/.test(url)
      ) {
        console.warn(`[interview-arc] ignored non-JSON inspector response from ${url}`);
        return [];
      }
      throw err;
    }
  }
  json[GUARD_FLAG] = true;
  Response.prototype.json = json;
}

export function installLocalPreviewGuards() {
  if (process[GUARD_FLAG]) return;
  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") return;
  process[GUARD_FLAG] = true;
  patchResponseJson();
  for (const event of ["uncaughtException", "unhandledRejection"]) {
    for (const listener of process.listeners(event)) {
      process.removeListener(event, listener);
    }
    process.on(event, guardListener);
  }
}
