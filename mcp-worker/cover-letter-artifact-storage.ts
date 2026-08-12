import type { CoverLetterFileIntegrity } from "../db/cover-letter-artifacts";

export interface PrivateCoverLetterFile {
  key: string;
  storageGeneration: string;
  bytes: ArrayBuffer;
  integrity: CoverLetterFileIntegrity;
}

type PrivateCoverLetterBucket = Pick<R2Bucket, "put" | "head" | "delete">;

async function putAndVerify(bucket: PrivateCoverLetterBucket, file: PrivateCoverLetterFile) {
  await bucket.put(file.key, file.bytes, {
    httpMetadata: {
      contentType: file.integrity.mimeType,
      contentDisposition: `attachment; filename="${file.integrity.filename}"`,
    },
    customMetadata: {
      format: file.integrity.format,
      sha256: file.integrity.sha256,
      storageGeneration: file.storageGeneration,
    },
  });
  const stored = await bucket.head(file.key);
  if (!stored
      || stored.size !== file.integrity.byteSize
      || stored.customMetadata?.format !== file.integrity.format
      || stored.customMetadata?.sha256 !== file.integrity.sha256
      || stored.customMetadata?.storageGeneration !== file.storageGeneration) {
    throw new Error("Private cover-letter object verification failed.");
  }
}

export async function stagePrivateCoverLetterPair(
  bucket: PrivateCoverLetterBucket,
  files: [PrivateCoverLetterFile, PrivateCoverLetterFile],
) {
  const results = await Promise.allSettled(files.map((file) => putAndVerify(bucket, file)));
  const failedFormats = results.flatMap((result, index) => (
    result.status === "rejected" ? [files[index].integrity.format] : []
  ));
  if (failedFormats.length > 0) {
    await Promise.allSettled(files.map((file) => bucket.delete(file.key)));
  }
  return { complete: failedFormats.length === 0, failedFormats };
}
