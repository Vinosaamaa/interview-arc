// Synthetic authentication provider used only by the isolated local test.
import worker from "../../mcp-worker/index";
const issuer = "https://synthetic-arc-worker.cloudflareaccess.com";
let pair: CryptoKeyPair;
let publicKey: JsonWebKey;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === `${issuer}/cdn-cgi/access/certs`) return Response.json({ keys: [{ ...publicKey, kid: "synthetic" }] });
  return originalFetch(input, init);
};
const base64 = (value: string | Uint8Array) => btoa(typeof value === "string" ? value : String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const syntheticWorker = {
  async fetch(request: Request, env: Parameters<typeof worker.fetch>[1], ctx: ExecutionContext) {
    if (new URL(request.url).pathname === "/fixture/assertion") {
      pair ??= await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
      publicKey ??= await crypto.subtle.exportKey("jwk", pair.publicKey);
      const data = `${base64(JSON.stringify({ alg: "RS256", kid: "synthetic" }))}.${base64(JSON.stringify({ iss: issuer, aud: ["synthetic-application"], exp: Math.floor(Date.now() / 1000) + 600, email: "synthetic@example.test" }))}`;
      const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(data));
      return Response.json({ assertion: `${data}.${base64(new Uint8Array(signature))}` });
    }
    return worker.fetch(request, { ...env, CHATGPT_ACCESS_TEAM_DOMAIN: issuer, CHATGPT_ACCESS_AUD: "synthetic-application" }, ctx);
  },
};
export default syntheticWorker;
