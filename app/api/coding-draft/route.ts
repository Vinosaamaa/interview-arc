import { env } from "cloudflare:workers";
import { resolveOwnerId } from "../../../db/owner";
import { CodingDraftConflictError, readCodingDraft, saveCodingDraft } from "../../../db/coding-drafts";
import { readBoundedJson } from "../route-helpers";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  const owner = await resolveOwnerId(request);
  const id = new URL(request.url).searchParams.get("draftId");
  if (!id || id.length > 240) return Response.json({error:"Choose a coding draft."},{status:400,headers});
  const draft = await readCodingDraft(env.DB,owner,id);
  return Response.json(draft ? {draft} : {error:"Draft not found for this account."},{status:draft?200:404,headers});
}
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json")) return Response.json({error:"Save from the authenticated Arc editor."},{status:403,headers});
  try {
    const owner = await resolveOwnerId(request);
    return Response.json(await saveCodingDraft(env.DB,owner,await readBoundedJson(request,100000)),{headers});
  } catch (error) {
    if (error instanceof CodingDraftConflictError) return Response.json({error:error.message,code:"draft_conflict",latest:error.latest},{status:409,headers});
    return Response.json({error:"Save was not confirmed. Keep your edits; the draft may have changed in another editor. Retry the same save or ask your agent to reconcile revisions."},{status:409,headers});
  }
}
