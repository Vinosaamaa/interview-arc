import { env } from "cloudflare:workers";
import { resolveOwnerId } from "../../../db/owner";
import { readChatgptBank } from "../../../db/chatgpt-bank";
import { CHATGPT_IMPORT_MAX_BYTES, chatgptImportRequestSchema, chatgptSpecialty } from "../../../db/chatgpt-import-policy";
import { applyChatgptImport, ChatgptImportError, listImportedPractice, prepareChatgptImport, readImportedPractice } from "../../../db/chatgpt-import-store";
import { readBoundedJson, RouteBodyTooLargeError } from "../route-helpers";

const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  if (error instanceof ChatgptImportError) return Response.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof RouteBodyTooLargeError) return Response.json({ error: "Upload a packet smaller than 1 MB. Split a large day into session exports." }, { status: 413, headers });
  if (error instanceof SyntaxError) return Response.json({ error: "This is not valid JSON. Export the complete practice packet again." }, { status: 400, headers });
  return Response.json({ error: "ChatGPT practice is temporarily unavailable. Your original export remains safe; retry it unchanged." }, { status: 503, headers });
}
export async function GET(request: Request) {
  try {
    const owner = await resolveOwnerId(request);
    const url = new URL(request.url);
    if (url.searchParams.get("bank") === "1") {
      const requested = url.searchParams.get("specialty");
      const specialty = requested ? chatgptSpecialty.safeParse(requested) : null;
      if (specialty && !specialty.success) return Response.json({ error: "Unknown question specialty." }, { status: 400, headers });
      const bank = await readChatgptBank(env.DB, owner, specialty?.data);
      return Response.json(bank, { headers: { ...headers, ...(url.searchParams.get("download") === "1" ? { "Content-Disposition": 'attachment; filename="interview-arc-private-bank.json"' } : {}) } });
    }
    const activityId = url.searchParams.get("activityId");
    if (activityId) {
      const revision = url.searchParams.has("revision") ? Number(url.searchParams.get("revision")) : undefined;
      if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) return Response.json({ error: "Invalid record revision." }, { status: 400, headers });
      const record = await readImportedPractice(env.DB, owner, activityId, revision);
      return Response.json(record ? { record } : { error: "Imported practice was not found." }, { status: record ? 200 : 404, headers });
    }
    const offset = Number(url.searchParams.get("offset") ?? "0");
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) return Response.json({ error: "Invalid page." }, { status: 400, headers });
    return Response.json(await listImportedPractice(env.DB, owner, offset, url.searchParams.get("status") === "pending" ? "pending" : "completed"), { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    // Browser session authentication is provided by worker/index.ts. This
    // surface intentionally has no public token parameter or cross-origin API.
    const origin = request.headers.get("origin");
    if (origin !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "Import from the authenticated Interview Arc page." }, { status: 403, headers });
    const parsed = chatgptImportRequestSchema.safeParse(await readBoundedJson(request, CHATGPT_IMPORT_MAX_BYTES));
    if (!parsed.success) return Response.json({ error: "The export needs correction before it can be imported.", issues: parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400, headers });
    const owner = await resolveOwnerId(request);
    const bank = await readChatgptBank(env.DB, owner);
    const catalog = bank.questions.map((q) => ({ ...q, active: q.availability === "active" }));
    const result = parsed.data.action === "preview"
      ? (await prepareChatgptImport(env.DB, owner, parsed.data, catalog)).preview
      : await applyChatgptImport(env.DB, owner, parsed.data, catalog);
    return Response.json(result, { headers });
  } catch (error) { return failure(error); }
}
