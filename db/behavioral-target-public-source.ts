const MAX_POSTING_BYTES = 1_000_000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const STALE_AFTER_MS = 7 * 86_400_000;

export class BehavioralTargetPublicSourceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BehavioralTargetPublicSourceError";
    this.code = code;
  }
}

function unsafeHostname(hostnameValue: string) {
  const hostname = hostnameValue.toLowerCase().replace(/^\[|\]$/g, "");
  return hostname === "localhost"
    || hostname === "metadata.google.internal"
    || hostname === "metadata.google.com"
    || hostname === "100.100.100.200"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || hostname.endsWith(".home.arpa")
    || hostname.includes(":")
    || /^\d+(?:\.\d+){3}$/.test(hostname);
}

export function normalizePublicPostingUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || unsafeHostname(url.hostname)) throw new Error();
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    const normalized = url.toString().replace(/\?$/, "");
    if (normalized.length > 240) throw new Error();
    return normalized;
  } catch {
    throw new BehavioralTargetPublicSourceError(
      "behavioral_target_public_url_invalid",
      "Enter a public HTTPS job-posting URL without credentials or a private-network host.",
    );
  }
}

function decodeHtml(value: string) {
  const entities: Record<string, string> = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : " ";
    }
    return entities[entity.toLowerCase()] ?? " ";
  });
}

export function extractPostingText(value: string) {
  const text = decodeHtml(value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    throw new BehavioralTargetPublicSourceError(
      "behavioral_target_public_content_empty",
      "The public page did not contain usable job-posting text.",
    );
  }
  return text.slice(0, 100_000);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function postingChangeState(expectedFingerprint: string | undefined, actualFingerprint: string) {
  if (!expectedFingerprint) return "new" as const;
  return expectedFingerprint === actualFingerprint ? "unchanged" as const : "changed" as const;
}

export function classifyPostingFreshness(capturedAt: number, nowMs = Date.now()) {
  return nowMs - capturedAt > STALE_AFTER_MS ? "stale" as const : "current" as const;
}

async function boundedBody(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_POSTING_BYTES) throw new BehavioralTargetPublicSourceError(
    "behavioral_target_public_content_too_large",
    "The public posting is larger than the protected import limit.",
  );
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_POSTING_BYTES) throw new BehavioralTargetPublicSourceError(
        "behavioral_target_public_content_too_large",
        "The public posting is larger than the protected import limit.",
      );
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function fetchPublicBehavioralTargetSource(input: {
  url: string;
  expectedFingerprint?: string;
}, fetcher: typeof fetch = fetch, nowMs = Date.now()) {
  let currentUrl = normalizePublicPostingUrl(input.url);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetcher(currentUrl, {
        headers: { accept: "text/html,text/plain;q=0.9" },
        redirect: "manual",
        signal: controller.signal,
      });
    } catch {
      throw new BehavioralTargetPublicSourceError(
        "behavioral_target_public_unavailable",
        "The public posting could not be reached. Paste the job description instead.",
      );
    } finally {
      clearTimeout(timeout);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) throw new BehavioralTargetPublicSourceError(
        "behavioral_target_public_redirect_unavailable",
        "The public posting redirected outside the protected import limit.",
      );
      currentUrl = normalizePublicPostingUrl(new URL(location, currentUrl).toString());
      continue;
    }
    if (!response.ok) throw new BehavioralTargetPublicSourceError(
      "behavioral_target_public_unavailable",
      "The public posting is unavailable. Paste the job description instead.",
    );
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType && !contentType.includes("text/html") && !contentType.includes("text/plain")) {
      throw new BehavioralTargetPublicSourceError(
        "behavioral_target_public_content_unsupported",
        "The public posting did not return readable text or HTML.",
      );
    }
    const jdText = extractPostingText(await boundedBody(response));
    const fingerprint = await sha256(jdText.trim());
    return {
      status: "available" as const,
      change: postingChangeState(input.expectedFingerprint, fingerprint),
      freshness: "current" as const,
      source: {
        kind: "public_posting" as const,
        displayLocator: currentUrl,
        capturedAt: nowMs,
        jdText,
        fingerprint,
      },
    };
  }
  throw new BehavioralTargetPublicSourceError(
    "behavioral_target_public_unavailable",
    "The public posting is unavailable. Paste the job description instead.",
  );
}
