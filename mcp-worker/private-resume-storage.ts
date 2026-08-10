export interface PrivateResumeFile {
  key: string;
  bytes: ArrayBuffer;
  integrity: {
    format: "docx" | "pdf";
    sha256: string;
    byteSize: number;
    mimeType: string;
  };
}

type PrivateResumeBucket = Pick<R2Bucket, "put" | "head" | "delete">;

async function putAndVerify(bucket: PrivateResumeBucket, file: PrivateResumeFile) {
  await bucket.put(file.key, file.bytes, {
    httpMetadata: {
      contentType: file.integrity.mimeType,
      contentDisposition: `attachment; filename="resume.${file.integrity.format}"`,
    },
    customMetadata: {
      format: file.integrity.format,
      sha256: file.integrity.sha256,
    },
  });
  const stored = await bucket.head(file.key);
  if (!stored
      || stored.size !== file.integrity.byteSize
      || stored.customMetadata?.format !== file.integrity.format
      || stored.customMetadata?.sha256 !== file.integrity.sha256) {
    throw new Error("Private resume object verification failed.");
  }
}

export async function stagePrivateResumePair(
  bucket: PrivateResumeBucket,
  files: [PrivateResumeFile, PrivateResumeFile],
) {
  const results = await Promise.allSettled(files.map((file) => putAndVerify(bucket, file)));
  const failedFormats = results.flatMap((result, index) => (
    result.status === "rejected" ? [files[index].integrity.format] : []
  ));
  if (failedFormats.length > 0) {
    await Promise.allSettled(files.map((file) => bucket.delete(file.key)));
  }
  return {
    complete: failedFormats.length === 0,
    failedFormats,
  };
}
