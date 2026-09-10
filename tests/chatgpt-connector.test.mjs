import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ScopedMcpServer, CHATGPT_PRACTICE_TOOLS } from "../mcp-worker/scoped-server.ts";
import { registerChatgptTools } from "../mcp-worker/chatgpt-tools.ts";
import { resolveChatgptAccessOwner } from "../mcp-worker/chatgpt-access.ts";
import { createChatgptQuestion, createQuestionSchema } from "../db/chatgpt-connector.ts";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync(new URL("../drizzle/", import.meta.url)).filter((n) => n.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../drizzle/${name}`, import.meta.url), "utf8"));
  function prepare(sql) {
    let args = [];
    return { bind(...values) { args = values; return this; },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...args), success: true }; },
      execute() { const statement = sqlite.prepare(sql); return statement.columns().length ? statement.all(...args) : statement.run(...args); } };
  }
  return { sqlite, db: { prepare, async batch(statements) {
    sqlite.exec("BEGIN IMMEDIATE");
    try { const values = statements.map((s) => s.execute()); sqlite.exec("COMMIT"); return values; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } } };
}
const sample = JSON.parse(readFileSync(new URL("../docs/contracts/chatgpt-backfill-synthetic.example.json", import.meta.url), "utf8"));
const question = { operationId: "create-original", specialty: "system_design", title: "Synthetic message service", prompt: "Design a fictional message service.", url: null };
async function clientFor(db, owner, readDesign) {
  const server = new ScopedMcpServer({ name: "Test practice", version: "1" });
  registerChatgptTools(server, db, owner, readDesign);
  let forbiddenCalled = false;
  server.registerTool("delete_related_voice_capture", { inputSchema: {} }, () => { forbiddenCalled = true; return { content: [] }; });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "Synthetic client", version: "1" });
  await server.connect(serverTransport); await client.connect(clientTransport);
  return { client, server, forbiddenCalled: () => forbiddenCalled };
}

test("saved scene fragments retain exact revision and require it for continuation", async () => {
  const { db, sqlite } = database();
  const scene = "x".repeat(20000) + "exact remainder";
  const connected = await clientFor(db, "alice", async (activityId) => activityId === "saved" ? { checkpoint: { revision: 3 }, scene } : null);
  try {
    const first = await connected.client.callTool({ name: "get_system_design_checkpoint", arguments: { activityId: "saved" } });
    assert.equal(first.structuredContent.sceneFragment, scene.slice(0, 20000));
    assert.equal(first.structuredContent.nextOffset, 20000);
    for (const expectedRevision of [undefined, 2]) {
      const stale = await connected.client.callTool({ name: "get_system_design_checkpoint", arguments: { activityId: "saved", offset: 20000, ...(expectedRevision ? { expectedRevision } : {}) } });
      assert.equal(stale.isError, true);
    }
    const last = await connected.client.callTool({ name: "get_system_design_checkpoint", arguments: { activityId: "saved", offset: 20000, expectedRevision: 3 } });
    assert.equal(last.structuredContent.sceneFragment, "exact remainder");
    assert.equal(last.structuredContent.nextOffset, null);
    assert.equal((await connected.client.callTool({ name: "get_system_design_checkpoint", arguments: { activityId: "missing" } })).isError, true);
  } finally { await connected.client.close(); await connected.server.close(); sqlite.close(); }
});

test("signed Access assertion binds exact audience/issuer and normalizes browser owner; spoofing and invalid claims fail closed", async () => {
  const keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = { ...await crypto.subtle.exportKey("jwk", keys.publicKey), kid: "synthetic-key" };
  const config = { CHATGPT_ACCESS_TEAM_DOMAIN: "https://synthetic-arc-test.cloudflareaccess.com", CHATGPT_ACCESS_AUD: "chatgpt-app" };
  const now = Date.now(); const valid = { iss: config.CHATGPT_ACCESS_TEAM_DOMAIN, aud: [config.CHATGPT_ACCESS_AUD], exp: Math.floor(now / 1000) + 900, email: " OWNER@example.test " };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  async function signed(payload = valid, header = { alg: "RS256", kid: jwk.kid }) {
    const input = `${encode(header)}.${encode(payload)}`;
    return `${input}.${Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, Buffer.from(input))).toString("base64url")}`;
  }
  const fetchKeys = async (url) => { assert.equal(url, `${config.CHATGPT_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`); return Response.json({ keys: [jwk] }); };
  const request = (token) => new Request("https://arc.example/chatgpt/mcp", { headers: { "cf-access-jwt-assertion": token, "x-interview-arc-authenticated-email": "attacker@example.test", "oai-authenticated-user-email": "attacker@example.test" } });
  const owner = await resolveChatgptAccessOwner(request(await signed()), config, fetchKeys, now);
  assert.equal(owner, `u_${Buffer.from(await crypto.subtle.digest("SHA-256", Buffer.from("owner@example.test"))).toString("hex").slice(0, 32)}`);
  for (const payload of [{ ...valid, aud: ["website-app"] }, { ...valid, iss: "https://other.cloudflareaccess.com" }, { ...valid, exp: Math.floor(now / 1000) }, { ...valid, nbf: Math.floor(now / 1000) + 100 }, { ...valid, email: "" }, { ...valid, exp: "9999999999" }]) assert.equal(await resolveChatgptAccessOwner(request(await signed(payload)), config, fetchKeys, now), null);
  assert.equal(await resolveChatgptAccessOwner(request(await signed(valid, { alg: "none", kid: jwk.kid })), config, fetchKeys, now), null);
  const jwt = await signed(); const parts = jwt.split("."); parts[1] = encode({ ...valid, email: "other@example.test" });
  assert.equal(await resolveChatgptAccessOwner(request(parts.join(".")), config, fetchKeys, now), null);
  assert.equal(await resolveChatgptAccessOwner(request(jwt), {}, fetchKeys, now), null);
  assert.equal(await resolveChatgptAccessOwner(request("ia_ordinary_integration_token_is_not_an_assertion"), config, fetchKeys, now), null);
});

test("personal question SQL creates atomically, deduplicates, preserves canonical questions and isolates owners", async () => {
  const { db, sqlite } = database();
  try {
    assert.equal(createQuestionSchema.safeParse(question).success, true);
    assert.equal(createQuestionSchema.safeParse({ ...question, ownerId: "other" }).success, false);
    assert.equal(createQuestionSchema.safeParse({ ...question, url: "https://user:secret@example.test/q" }).success, false);
    const saved = await createChatgptQuestion(db, "alice", question);
    assert.equal(saved.status, "created");
    assert.equal((await createChatgptQuestion(db, "alice", question)).duplicate, true);
    await assert.rejects(createChatgptQuestion(db, "alice", { ...question, title: "Changed" }), /different content/);
    assert.equal((await createChatgptQuestion(db, "alice", { ...question, operationId: "same-question" })).status, "existing");
    assert.equal((await createChatgptQuestion(db, "bob", question)).status, "created");
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM timers").get().n, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM chatgpt_import_records").get().n, 0);
    const canonical = { id: "two-sum", title: "Two Sum", url: "https://leetcode.com/problems/two-sum/", active: true };
    sqlite.prepare("INSERT INTO content_bank(category,id,ord,payload) VALUES('leetcode','two-sum',0,?)").run(JSON.stringify(canonical));
    const matched = await createChatgptQuestion(db, "alice", { ...question, operationId: "public-match", specialty: "leetcode", title: "Overwrite attempt", url: "https://leetcode.com/problems/two-sum/description/?x=1" });
    assert.equal(matched.questionId, "two-sum"); assert.equal(matched.title, "Two Sum"); assert.equal(matched.status, "existing");
  } finally { sqlite.close(); }
});

test("MCP search/fetch returns private bank only to its owner and removed broad tools cannot be called", async () => {
  const { db, sqlite } = database(); const connected = [];
  try {
    await createChatgptQuestion(db, "alice", question);
    for (const owner of ["alice", "bob"]) connected.push(await clientFor(db, owner));
    const [alice, bob] = connected;
    const listed = await alice.client.listTools();
    assert.equal(listed.tools.every((tool) => CHATGPT_PRACTICE_TOOLS.has(tool.name)), true);
    assert.equal(listed.tools.some((tool) => tool.name === "delete_related_voice_capture"), false);
    const refused = await alice.client.callTool({ name: "delete_related_voice_capture", arguments: {} });
    assert.equal(refused.isError, true); assert.equal(alice.forbiddenCalled(), false);
    const found = await alice.client.callTool({ name: "search", arguments: { query: "message" } });
    assert.equal(found.structuredContent.results.length, 1);
    assert.equal((await bob.client.callTool({ name: "search", arguments: { query: "message" } })).structuredContent.results.length, 0);
    const id = found.structuredContent.results[0].id;
    assert.equal((await alice.client.callTool({ name: "fetch", arguments: { id } })).structuredContent.text, question.prompt);
    assert.equal((await bob.client.callTool({ name: "fetch", arguments: { id } })).isError, true);
    assert.equal((await alice.client.callTool({ name: "search", arguments: { query: "", offset: 20 } })).isError, true);
  } finally { for (const { client, server } of connected) { await client.close(); await server.close(); } sqlite.close(); }
});

test("MCP preview/apply saves exact supplied source with immutable receipt and retries safely", async () => {
  const { db, sqlite } = database(); const { client, server } = await clientFor(db, "alice");
  try {
    const packet = structuredClone(sample);
    for (const attempt of packet.sessions[0].attempts) {
      attempt.practiceDate = "2026-09-08"; attempt.dateBasis = "user_reported";
      const q = attempt.question;
      sqlite.prepare("INSERT INTO content_bank(category,id,ord,payload) VALUES(?,?,0,?)").run(q.specialty === "system_design" ? "systemDesign" : q.specialty, q.questionId, JSON.stringify({ id: q.questionId, title: q.title, active: true, prompt: q.prompt, url: q.url }));
    }
    const preview = await client.callTool({ name: "preview_practice_backfill", arguments: { packet } });
    assert.equal(preview.isError, undefined);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM chatgpt_import_records").get().n, 0);
    const args = { packet, previewToken: preview.structuredContent.previewToken };
    const applied = await client.callTool({ name: "apply_practice_backfill", arguments: args });
    assert.equal(applied.isError, undefined);
    assert.equal(applied.structuredContent.records.every((r) => r.status === "completed"), true);
    assert.equal((await client.callTool({ name: "apply_practice_backfill", arguments: args })).structuredContent.duplicate, true);
    const receipt = await client.callTool({ name: "get_practice_backfill_receipt", arguments: { packetId: packet.packetId } });
    assert.deepEqual(receipt.structuredContent.records, applied.structuredContent.records);
    const stored = JSON.parse(sqlite.prepare("SELECT payload FROM chatgpt_import_packets WHERE owner_id='alice'").get().payload);
    assert.deepEqual(stored.sources, packet.sources);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM timers").get().n, 0);
  } finally { await client.close(); await server.close(); sqlite.close(); }
});
