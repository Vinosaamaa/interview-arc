import { env } from "cloudflare:workers";
import { ZodError } from "zod";
import { resolveOwnerId } from "../../../../db/owner";
import { getLearningMaterial, getLearningMaterialSource, listLearningMaterials, publishLearningMaterial } from "../../../../db/learning-materials";
import { ResourceError } from "../../../../db/study-resource-policy";
import { boundedResourceBody } from "../../../../db/study-resource-body";
const headers = { "Cache-Control": "private, no-store" };
function failure(e: unknown) {
    if (e instanceof ResourceError)
        return Response.json({ error: e.message }, { status: e.status, headers });
    const invalid = e instanceof ZodError || e instanceof SyntaxError;
    return Response.json({ error: invalid ? "Invalid learning material request." : "Material request failed. Retry the same operation." }, { status: invalid ? 400 : 503, headers });
}
export async function GET(request: Request) { try {
    const owner = await resolveOwnerId(request), u = new URL(request.url), id = u.searchParams.get("materialId");
    return Response.json(id ? (u.searchParams.get("source") === "1" ? await getLearningMaterialSource(env.DB, owner, id) : await getLearningMaterial(env.DB, owner, id)) : await listLearningMaterials(env.DB, owner, u.searchParams.get("query") ?? "", Number(u.searchParams.get("offset") ?? 0)), { headers });
}
catch (e) {
    return failure(e);
} }
export async function POST(request: Request) { try {
    if (request.headers.get("origin") !== new URL(request.url).origin)
        throw new ResourceError("Publish from your signed-in Arc page.", 403);
    const owner = await resolveOwnerId(request), input = JSON.parse(new TextDecoder().decode(await boundedResourceBody(request, 300000)));
    return Response.json(await publishLearningMaterial(env.DB, env.AUDIO, owner, input), { headers });
}
catch (e) {
    return failure(e);
} }
