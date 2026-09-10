// Synthetic authentication provider used only by the isolated local test.
import worker from "../../mcp-worker/index";
import { GET as readImportedPracticeRoute } from "../../app/api/chatgpt-practice/route";
const issuer = "https://synthetic-arc-worker.cloudflareaccess.com";
let pair: CryptoKeyPair;
let publicKey: JsonWebKey;
let signingReady: Promise<void> | undefined;
// Local Worker reloads must not invalidate an assertion issued earlier in this
// same test. This key exists only in the isolated synthetic test database.
function prepareSigningKey(db: D1Database) {
  signingReady ??= (async () => {
    await db.prepare("CREATE TABLE IF NOT EXISTS fixture_signing_key (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)").run();
    let row = await db.prepare("SELECT payload FROM fixture_signing_key WHERE id=1").first<{ payload: string }>();
    if (!row) {
      const generated = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
      const payload = JSON.stringify({ privateKey: await crypto.subtle.exportKey("jwk", generated.privateKey), publicKey: await crypto.subtle.exportKey("jwk", generated.publicKey) });
      await db.prepare("INSERT OR IGNORE INTO fixture_signing_key(id,payload) VALUES(1,?)").bind(payload).run();
      row = await db.prepare("SELECT payload FROM fixture_signing_key WHERE id=1").first<{ payload: string }>();
    }
    const stored = JSON.parse(row!.payload) as { privateKey: JsonWebKey; publicKey: JsonWebKey };
    publicKey = stored.publicKey;
    pair = {
      privateKey: await crypto.subtle.importKey("jwk", stored.privateKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, true, ["sign"]),
      publicKey: await crypto.subtle.importKey("jwk", publicKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, true, ["verify"]),
    };
  })();
  return signingReady;
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === `${issuer}/cdn-cgi/access/certs`) return Response.json({ keys: [{ ...publicKey, kid: "synthetic" }] });
  return originalFetch(input, init);
};
const base64 = (value: string | Uint8Array) => btoa(typeof value === "string" ? value : String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const syntheticWorker = {
  async fetch(request: Request, env: Parameters<typeof worker.fetch>[1], ctx: ExecutionContext) {
    await prepareSigningKey(env.DB);
    if (new URL(request.url).pathname === "/fixture/imported-reader") {
      // Exercise the actual website route for the fixed synthetic owner. The
      // production website supplies this trusted header after Access auth.
      const headers = new Headers(request.headers);
      headers.set("x-interview-arc-authenticated-email", "synthetic@example.test");
      return readImportedPracticeRoute(new Request(request, { headers }));
    }
    if (new URL(request.url).pathname === "/fixture/immutable-practice") {
      const tables = ["chatgpt_import_records", "chatgpt_import_revisions", "practice_records", "practice_record_revisions", "activity_finalizations", "activity_solution_links", "behavioral_final_answer_snapshots", "timers"];
      const fingerprints = await Promise.all(tables.map(async (table) => {
        const rows = await env.DB.prepare(`SELECT * FROM ${table}`).all();
        const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(rows.results)));
        return [table, Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("")];
      }));
      return Response.json(Object.fromEntries(fingerprints));
    }
    if (new URL(request.url).pathname === "/fixture/scheduled" && request.method === "POST") {
      const pending: Promise<unknown>[] = [];
      await worker.scheduled({} as ScheduledController, env, {
        waitUntil(promise: Promise<unknown>) { pending.push(promise); },
      } as ExecutionContext);
      await Promise.all(pending);
      return Response.json({ drained: true });
    }
    if (new URL(request.url).pathname === "/fixture/assertion") {
      const data = `${base64(JSON.stringify({ alg: "RS256", kid: "synthetic" }))}.${base64(JSON.stringify({ iss: issuer, aud: ["synthetic-application"], exp: Math.floor(Date.now() / 1000) + 600, email: "synthetic@example.test" }))}`;
      const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(data));
      return Response.json({ assertion: `${data}.${base64(new Uint8Array(signature))}` });
    }
    return worker.fetch(request, { ...env, CHATGPT_ACCESS_TEAM_DOMAIN: issuer, CHATGPT_ACCESS_AUD: "synthetic-application" }, ctx);
  },
};
export default syntheticWorker;
