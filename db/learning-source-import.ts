import { boundedResourceStream } from "./study-resource-body.ts";
import { ResourceError, MAX_RESOURCE_BYTES } from "./study-resource-policy.ts";
import { saveStudyResource, type ResourceDatabase, type ResourceBucket } from "./study-resources.ts";
export function publicSourceUrl(value: string) {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(url.hostname) || /\.(localhost|local|internal|test|invalid)$/i.test(url.hostname))
        throw new ResourceError("Use a public HTTPS article URL without credentials.");
    return url;
}
// Production Workers also use global_fetch_strictly_public to reject private DNS destinations.
export async function importLearningSource(db: ResourceDatabase, bucket: ResourceBucket, owner: string, input: {
    url: string;
    title: string;
    operationId: string;
}, fetcher: typeof fetch = fetch) {
    const url = publicSourceUrl(input.url);
    if (/(^|\.)youtube\.com$|^youtu\.be$/.test(url.hostname))
        return importYouTube(db, bucket, owner, input, url, fetcher);
    const response = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(30000), headers: { Accept: "text/html,text/plain,application/pdf" } });
    if (!response.ok || !response.body)
        throw new ResourceError("The source could not be read publicly. Upload the saved HTML/PDF or use the final public URL. No subscription access was attempted.");
    const type = (response.headers.get("content-type") ?? "").split(";")[0].toLowerCase();
    const extension = type === "text/html" ? "html" : type === "application/pdf" ? "pdf" : type === "text/plain" ? "txt" : null;
    if (!extension)
        throw new ResourceError("This URL did not return an article or PDF. Upload the original file instead.");
    if (Number(response.headers.get("content-length")) > MAX_RESOURCE_BYTES)
        throw new ResourceError("Source exceeds 25 MB.", 413);
    const limited = boundedResourceStream(response.body, MAX_RESOURCE_BYTES), bytes = new Uint8Array(await new Response(limited.stream).arrayBuffer());
    return { ...await saveStudyResource(db, bucket, owner, { operationId: input.operationId, title: input.title }, { name: `source.${extension}`, bytes }), sourceUrl: url.href, acquisition: "public_url", notice: "Read every source fragment and inspect available originals before summarizing. A successful download can still be a login page, excerpt or missing external assets; report actual coverage." };
}
export function captionTracks(html: string): {
    baseUrl: string;
    languageCode?: string;
    kind?: string;
}[] {
    const match = /"captionTracks"\s*:\s*\[/.exec(html);
    if (!match)
        return [];
    const start = match.index + match[0].length - 1;
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < html.length; i++) {
        const c = html[i];
        if (quoted) {
            if (escaped)
                escaped = false;
            else if (c === "\\")
                escaped = true;
            else if (c === '"')
                quoted = false;
            continue;
        }
        if (c === '"') {
            quoted = true;
            continue;
        }
        if (c === '[')
            depth++;
        if (c === ']' && --depth === 0) {
            try {
                const value = JSON.parse(html.slice(start, i + 1));
                return Array.isArray(value) ? value.filter(v => v && typeof v.baseUrl === 'string') : [];
            }
            catch {
                return [];
            }
        }
    }
    return [];
}
async function importYouTube(db: ResourceDatabase, bucket: ResourceBucket, owner: string, input: {
    title: string;
    operationId: string;
}, url: URL, fetcher: typeof fetch) {
    const id = url.hostname === "youtu.be" ? url.pathname.slice(1) : url.pathname === "/watch" ? url.searchParams.get("v") : null;
    if (!id || !/^[-_a-zA-Z0-9]{11}$/.test(id))
        throw new ResourceError("Supply a YouTube watch URL for one video.");
    const sourceUrl = `https://www.youtube.com/watch?v=${id}`;
    const unavailable = () => new ResourceError("The video's actual captions are not publicly retrievable here. Use an available transcript/browser tool and save_learning_source_text, or upload a TXT/VTT/SRT transcript export. The video description was not saved as a transcript.");
    const response = await fetcher(sourceUrl, { redirect: "manual", signal: AbortSignal.timeout(30000) });
    if (!response.ok || !response.body)
        throw unavailable();
    const page = await new Response(boundedResourceStream(response.body, 4 * 1024 * 1024).stream).text(), tracks = captionTracks(page);
    const track = tracks.find(t => t.languageCode === "en" && t.kind !== "asr") ?? tracks.find(t => t.languageCode === "en") ?? tracks[0];
    if (!track)
        throw unavailable();
    const captions = new URL(track.baseUrl);
    if (captions.protocol !== "https:" || captions.username || captions.password || captions.port || !["www.youtube.com", "youtube.com"].includes(captions.hostname) || captions.pathname !== "/api/timedtext")
        throw unavailable();
    captions.searchParams.set("fmt", "vtt");
    const r = await fetcher(captions, { redirect: "manual", signal: AbortSignal.timeout(30000) });
    if (!r.ok || !r.body)
        throw unavailable();
    const bytes = new Uint8Array(await new Response(boundedResourceStream(r.body, 2000000).stream).arrayBuffer());
    const prefix = new TextDecoder().decode(bytes.subarray(0, 4096));
    if (!prefix.startsWith("WEBVTT") || !prefix.includes(" --> "))
        throw unavailable();
    return { ...await saveStudyResource(db, bucket, owner, { operationId: input.operationId, title: input.title }, { name: "youtube-captions.vtt", bytes }), sourceUrl, acquisition: "public_youtube_captions", language: track.languageCode ?? "unknown", automatic: track.kind === "asr", notice: "Original caption file saved with timestamps. Read all fragments. Captions may be automatic and can omit visual information; state these limitations in the published notes." };
}
