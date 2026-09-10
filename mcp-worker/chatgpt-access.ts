import { resolveOwnerId, TRUSTED_EMAIL_HEADER } from "../db/owner.ts";

export type ChatgptAccessConfig = { CHATGPT_ACCESS_TEAM_DOMAIN?: string; CHATGPT_ACCESS_AUD?: string };
type AccessKey = JsonWebKey & { kid?: string };
const cache = new Map<string, { keys: AccessKey[]; until: number }>();
function decode(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}

// Managed OAuth runs at Cloudflare Access. The origin accepts only the signed
// assertion for this separate app audience, never an unverified identity header
// or an Arc personal token. Missing configuration fails closed.
export async function resolveChatgptAccessOwner(request: Request, config: ChatgptAccessConfig, fetchKeys: typeof fetch = fetch, now = Date.now()) {
  try {
    const issuer = config.CHATGPT_ACCESS_TEAM_DOMAIN?.replace(/\/$/, "");
    if (!issuer || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) || !config.CHATGPT_ACCESS_AUD) return null;
    const jwt = request.headers.get("cf-access-jwt-assertion") ?? "";
    if (jwt.length > 16384) return null;
    const pieces = jwt.split("."); if (pieces.length !== 3) return null;
    const [head, body, signature] = pieces;
    const header = JSON.parse(new TextDecoder().decode(decode(head))) as { alg?: string; kid?: string };
    const payload = JSON.parse(new TextDecoder().decode(decode(body))) as { iss?: string; aud?: string[] | string; exp?: number; nbf?: number; email?: string };
    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (header.alg !== "RS256" || !header.kid || payload.iss !== issuer || !audience.includes(config.CHATGPT_ACCESS_AUD)) return null;
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp * 1000 <= now || payload.nbf !== undefined && (typeof payload.nbf !== "number" || payload.nbf * 1000 > now)) return null;
    if (typeof payload.email !== "string" || !payload.email.trim() || payload.email.length > 320) return null;
    let keys = cache.get(issuer);
    if (!keys || keys.until <= now || !keys.keys.some((k) => k.kid === header.kid)) {
      const response = await fetchKeys(`${issuer}/cdn-cgi/access/certs`);
      if (!response.ok) return null;
      const data = await response.json() as { keys?: AccessKey[] };
      if (!Array.isArray(data.keys)) return null;
      keys = { keys: data.keys, until: now + 3600000 }; cache.set(issuer, keys);
    }
    const jwk = keys.keys.find((k) => k.kid === header.kid && k.kty === "RSA");
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decode(signature), new TextEncoder().encode(`${head}.${body}`))) return null;
    return resolveOwnerId(new Request(request.url, { headers: { [TRUSTED_EMAIL_HEADER]: payload.email } }));
  } catch { return null; }
}
