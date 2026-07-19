/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
  // Passcode gate (set as Wrangler secrets in production). When either is
  // absent — e.g. local `vinext dev` — the gate is disabled so development
  // needs no secrets.
  SITE_PASSCODE?: string;
  SESSION_SECRET?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const SESSION_COOKIE = "ia_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function base64Url(bytes: ArrayBuffer): string {
  let binary = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Deterministic opaque session token derived from the secret. Rotating
// SESSION_SECRET invalidates every existing cookie.
async function sessionToken(secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("v1:authed"));
  return base64Url(sig);
}

// Constant-time string comparison to avoid leaking length/content via timing.
function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const length = Math.max(aBytes.length, bBytes.length);
  let mismatch = aBytes.length ^ bBytes.length;
  for (let i = 0; i < length; i++) {
    mismatch |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return mismatch === 0;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

function loginPage(error?: string, status = 200): Response {
  const message = error
    ? `<p class="err">${error}</p>`
    : `<p class="hint">Enter the passcode to continue.</p>`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Interview Arc</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    background: radial-gradient(1200px 600px at 50% -10%, #1e293b, #0b1120); color: #e2e8f0; }
  .card { width: min(360px, 92vw); padding: 32px; border-radius: 16px;
    background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(148, 163, 184, 0.18);
    box-shadow: 0 20px 60px rgba(0,0,0,0.45); }
  h1 { margin: 0 0 4px; font-size: 20px; letter-spacing: -0.01em; }
  .hint { margin: 0 0 20px; color: #94a3b8; font-size: 14px; }
  .err { margin: 0 0 20px; color: #fca5a5; font-size: 14px; }
  label { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; margin-bottom: 8px; }
  input { width: 100%; padding: 12px 14px; border-radius: 10px; border: 1px solid rgba(148,163,184,0.25);
    background: #0b1120; color: #e2e8f0; font-size: 16px; }
  input:focus { outline: 2px solid #38bdf8; outline-offset: 1px; }
  button { margin-top: 16px; width: 100%; padding: 12px 14px; border: 0; border-radius: 10px;
    background: linear-gradient(180deg, #38bdf8, #0ea5e9); color: #04283b; font-weight: 650; font-size: 15px; cursor: pointer; }
  button:hover { filter: brightness(1.05); }
</style>
</head>
<body>
  <form class="card" method="POST" action="/login">
    <h1>Interview Arc</h1>
    ${message}
    <label for="passcode">Passcode</label>
    <input id="passcode" name="passcode" type="password" autocomplete="current-password" autofocus required />
    <button type="submit">Enter</button>
  </form>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function sessionCookie(token: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

// Returns a Response when the request should be intercepted by the gate
// (login page, redirect, or 401); returns null when the request is authorized
// and should proceed to the app. Disabled entirely when secrets are absent.
async function passcodeGate(request: Request, env: Env): Promise<Response | null> {
  if (!env.SITE_PASSCODE || !env.SESSION_SECRET) return null;

  const url = new URL(request.url);
  const token = await sessionToken(env.SESSION_SECRET);

  if (url.pathname === "/login") {
    if (request.method === "POST") {
      const form = await request.formData();
      const submitted = String(form.get("passcode") ?? "");
      if (timingSafeEqual(submitted, env.SITE_PASSCODE)) {
        return new Response(null, {
          status: 303,
          headers: { Location: "/", "Set-Cookie": sessionCookie(token, SESSION_MAX_AGE) },
        });
      }
      return loginPage("Incorrect passcode.", 401);
    }
    return loginPage();
  }

  if (url.pathname === "/logout") {
    return new Response(null, {
      status: 303,
      headers: { Location: "/login", "Set-Cookie": sessionCookie("", 0) },
    });
  }

  const cookie = readCookie(request, SESSION_COOKIE);
  if (cookie && timingSafeEqual(cookie, token)) return null;

  if (request.headers.get("accept")?.includes("text/html")) {
    return Response.redirect(new URL("/login", request.url).toString(), 302);
  }
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const gated = await passcodeGate(request, env);
    if (gated) return gated;

    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
