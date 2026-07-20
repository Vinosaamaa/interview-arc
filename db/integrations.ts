import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "./index";
import { integrationTokens } from "./schema";

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createIntegrationToken(ownerId: string, label: string, nowMs = Date.now()) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = `ia_${base64Url(bytes)}`;
  const tokenHash = await sha256Hex(token);
  await getDb().insert(integrationTokens).values({
    tokenHash,
    ownerId,
    label: label.trim().slice(0, 80) || "Personal integration",
    createdAt: nowMs,
  });
  return token;
}

export async function resolveIntegrationOwner(token: string, nowMs = Date.now()) {
  if (!token.startsWith("ia_") || token.length < 32) return null;
  const tokenHash = await sha256Hex(token);
  const rows = await getDb()
    .select()
    .from(integrationTokens)
    .where(and(eq(integrationTokens.tokenHash, tokenHash), isNull(integrationTokens.revokedAt)));
  const row = rows[0];
  if (!row) return null;
  await getDb()
    .update(integrationTokens)
    .set({ lastUsedAt: nowMs })
    .where(eq(integrationTokens.tokenHash, tokenHash));
  return row.ownerId;
}

export async function listIntegrationTokens(ownerId: string) {
  return getDb().select().from(integrationTokens).where(eq(integrationTokens.ownerId, ownerId));
}

export async function revokeIntegrationToken(ownerId: string, tokenHash: string, nowMs = Date.now()) {
  await getDb()
    .update(integrationTokens)
    .set({ revokedAt: nowMs })
    .where(and(eq(integrationTokens.ownerId, ownerId), eq(integrationTokens.tokenHash, tokenHash)));
}
