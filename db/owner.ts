// Resolves a stable, non-PII owner id for the current request.
//
// The Cloudflare deployment is single-user (protected by a passcode gate in
// `worker/index.ts`), so every request maps to one constant owner. The legacy
// OpenAI Sites deployment still passes an authenticated email header while it
// runs in parallel; when present we hash it so raw email never lands in the
// database and that deployment keeps its own scoping.
const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const LOCAL_OWNER_ID = "owner";

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function resolveOwnerId(request: Request): Promise<string> {
  const email = request.headers.get(USER_EMAIL_HEADER)?.trim().toLowerCase();
  if (!email) return LOCAL_OWNER_ID;
  return `u_${(await sha256Hex(email)).slice(0, 32)}`;
}
