import {
  readCoverLetterArtifactFile,
  type CoverLetterFileFormat,
} from "../db/cover-letter-artifacts";
import { privateCoverLetterObjectKey } from "../db/private-cover-letter-object";

const STABLE_ID = /^[a-z0-9][a-z0-9._-]{0,199}$/;
type PrivateCoverLetterReadBucket = Pick<R2Bucket, "head" | "get">;

function privateJson(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "cache-control": "private, no-store" } });
}

export async function servePrivateCoverLetterFile(
  ownerId: string,
  artifactId: string,
  format: string,
  bucket: PrivateCoverLetterReadBucket,
) {
  if (!STABLE_ID.test(artifactId) || !["docx", "pdf"].includes(format)) return privateJson("Cover-letter file not found.", 404);
  try {
    const typedFormat = format as CoverLetterFileFormat;
    const record = await readCoverLetterArtifactFile(ownerId, artifactId, typedFormat);
    if (!record) return privateJson("Cover-letter file not found.", 404);
    const key = await privateCoverLetterObjectKey({
      ownerId,
      artifactId,
      storageGeneration: record.artifact.storageGeneration,
      format: typedFormat,
    });
    const head = await bucket.head(key);
    if (!head
        || head.size !== record.file.byteSize
        || head.customMetadata?.format !== typedFormat
        || head.customMetadata?.sha256 !== record.file.sha256
        || head.customMetadata?.storageGeneration !== record.artifact.storageGeneration) {
      return privateJson("The private cover-letter file is not durably available.", 503);
    }
    const object = await bucket.get(key);
    if (!object?.body) return privateJson("The private cover-letter file is not durably available.", 503);
    return new Response(object.body, {
      headers: {
        "content-type": record.file.mimeType,
        "content-disposition": `attachment; filename="${record.file.filename}"`,
        "content-length": String(record.file.byteSize),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "x-interview-arc-artifact-sha256": record.file.sha256,
      },
    });
  } catch {
    return privateJson("The private cover-letter file is temporarily unavailable.", 503);
  }
}
