(function installCompanionNetwork(global) {
  const API_BASE = "https://limitless-mcp.vinosama.workers.dev";
  const REQUEST_TYPE = "interview-arc-companion-request";
  const REQUEST_TIMEOUT_MS = 15_000;

  function validPath(path) {
    return /^\/companion\/(?:state|mutations)(?:\?|$)/.test(path);
  }

  function requestMessage(path, init = {}, credential = "") {
    return {
      type: REQUEST_TYPE,
      path,
      method: init.method ?? "GET",
      body: init.body ?? null,
      credential,
    };
  }

  async function performRequest(message, fetchImplementation = global.fetch) {
    if (
      message?.type !== REQUEST_TYPE
      || !validPath(message.path ?? "")
      || !["GET", "POST"].includes(message.method ?? "GET")
      || typeof message.credential !== "string"
      || !message.credential.startsWith("ia_")
    ) {
      return {
        kind: "transport-error",
        code: "invalid-request",
        message: "The Companion rejected an invalid internal request.",
      };
    }

    const controller = new AbortController();
    const timeout = global.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImplementation(`${API_BASE}${message.path}`, {
        method: message.method,
        cache: "no-store",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${message.credential}`,
          "content-type": "application/json",
        },
        ...(message.body == null ? {} : { body: message.body }),
      });
      const text = await response.text();
      let body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { error: text || `Interview Arc returned ${response.status}.` };
      }
      return {
        kind: "response",
        ok: response.ok,
        status: response.status,
        body,
      };
    } catch (error) {
      const timedOut = error?.name === "AbortError";
      return {
        kind: "transport-error",
        code: timedOut ? "timeout" : "network",
        message: timedOut
          ? "Interview Arc did not respond in time."
          : "Chrome could not reach the Interview Arc bridge.",
      };
    } finally {
      global.clearTimeout(timeout);
    }
  }

  global.InterviewArcCompanionNetwork = Object.freeze({
    API_BASE,
    REQUEST_TYPE,
    performRequest,
    requestMessage,
  });
})(globalThis);
