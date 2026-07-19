// Resolves a stable, non-PII owner id for the current request. On the deployed
// (OpenAI Sites / Access-protected) site the authenticated email arrives in a
// request header; we hash it so raw email never lands in the database. Local
// development without the header falls back to a single shared owner.
const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const LOCAL_OWNER_ID = "local-default";

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
