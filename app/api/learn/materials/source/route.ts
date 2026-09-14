import { env } from "cloudflare:workers";
import { resolveOwnerId } from "../../../../../db/owner";
import { getLearningMaterial } from "../../../../../db/learning-materials";
import { readStudyOriginal, resourceImageType } from "../../../../../db/study-resources";
import { ResourceError, resourceHash } from "../../../../../db/study-resource-policy";
export async function GET(request: Request) {
    const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'" };
    try {
        const owner = await resolveOwnerId(request), material = await getLearningMaterial(env.DB, owner, new URL(request.url).searchParams.get("materialId") ?? "");
        const { object, resource } = await readStudyOriginal(env.DB, env.AUDIO, owner, material.resourceId);
        const checksum = object.checksums?.sha256;
        // New uploads carry the verified R2 checksum. Legacy objects retain byte verification.
        const bytes = checksum ? null : new Uint8Array(await object.arrayBuffer());
        const hash = checksum ? Array.from(new Uint8Array(checksum), n => n.toString(16).padStart(2, "0")).join("") : await resourceHash(bytes!);
        if (hash !== material.sourceSha256)
            throw new ResourceError("Original identity could not be verified.", 503);
        const extension = resource.filename.split('.').pop()?.toLowerCase() ?? '';
        const image = bytes ? resourceImageType(bytes) : ({png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp"} as Record<string,string>)[extension];
        const pdf = bytes ? new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-" : extension === "pdf" || resource.method === "pdfjs-v1";
        const html = /\.html?$/i.test(resource.filename);
        const text = resource.method === "text-v1";
        if (!image && !pdf && !html && !text)
            throw new ResourceError("This format is available as an original download in the library.", 415);
        return new Response(bytes ?? object.body, { headers: { ...headers, "Content-Type": image ?? (pdf ? "application/pdf" : html ? "text/html; charset=utf-8" : "text/plain; charset=utf-8"), "Content-Disposition": "inline" } });
    }
    catch (e) {
        return Response.json({ error: e instanceof ResourceError ? e.message : "Original preview is unavailable. Please retry." }, { status: e instanceof ResourceError ? e.status : 503, headers });
    }
}
