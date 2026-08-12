import { privateResumeObjectKey } from "../db/private-resume-object";
import { readResumeRevisionFile, type ResumeFileFormat } from "../db/resume-revisions";

const STABLE_ID = /^[a-z0-9][a-z0-9._-]{0,199}$/;
type PrivateResumeReadBucket = Pick<R2Bucket, "head" | "get">;

function privateJson(error: string, status: number) {
  return Response.json({ error }, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

export async function servePrivateResumeFile(
  ownerId: string,
  resumeId: string,
  revisionId: string,
  format: string,
  bucket: PrivateResumeReadBucket,
) {
  if (!STABLE_ID.test(resumeId) || !STABLE_ID.test(revisionId) || !["docx", "pdf"].includes(format)) {
    return privateJson("Resume file not found.", 404);
  }
  try {
    const typedFormat = format as ResumeFileFormat;
    const file = await readResumeRevisionFile(ownerId, resumeId, revisionId, typedFormat);
    if (!file) return privateJson("Resume file not found.", 404);
    if (file.retention.state === "deleted") return privateJson("Resume file not found.", 404);
    if (file.retention.state !== "retained") {
      return privateJson("The private resume file is temporarily unavailable.", 503);
    }

    const key = await privateResumeObjectKey({
      ownerId,
      resumeId,
      revisionId,
      storageGeneration: file.storageGeneration,
      format: typedFormat,
    });
    const head = await bucket.head(key);
    if (!head
        || head.size !== file.byteSize
        || head.customMetadata?.format !== typedFormat
        || head.customMetadata?.sha256 !== file.sha256
        || head.customMetadata?.stagingGeneration !== file.storageGeneration) {
      return privateJson("The private resume file is not durably available.", 503);
    }
    const object = await bucket.get(key);
    if (!object?.body) return privateJson("The private resume file is not durably available.", 503);
    return new Response(object.body, {
      headers: {
        "content-type": file.mimeType,
        "content-disposition": `attachment; filename="resume-${revisionId}.${typedFormat}"`,
        "content-length": String(file.byteSize),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return privateJson("The private resume file is temporarily unavailable.", 503);
  }
}
