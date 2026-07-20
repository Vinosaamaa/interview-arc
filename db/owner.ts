// Resolves a stable, non-PII owner id for the current request.
//
// worker/index.ts writes this header only after independently verifying the
// Cloudflare Access JWT. Incoming copies are always removed first, so app
// routes can safely use it as the authenticated identity.
export const TRUSTED_EMAIL_HEADER = "x-interview-arc-authenticated-email";
const OPENAI_USER_EMAIL_HEADER = "oai-authenticated-user-email";
const LOCAL_OWNER_ID = "owner";

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function resolveOwnerId(request: Request): Promise<string> {
  const email = (request.headers.get(TRUSTED_EMAIL_HEADER) ?? request.headers.get(OPENAI_USER_EMAIL_HEADER))
    ?.trim()
    .toLowerCase();
  if (!email) return LOCAL_OWNER_ID;
  return `u_${(await sha256Hex(email)).slice(0, 32)}`;
}
