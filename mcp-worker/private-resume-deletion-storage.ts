type ResumeDeletionBucket = Pick<R2Bucket, "delete" | "head">;

export async function deleteAndVerifyPrivateResumePair(
  bucket: ResumeDeletionBucket,
  keys: [string, string],
) {
  const deletions = await Promise.allSettled(keys.map((key) => bucket.delete(key)));
  const verification = await Promise.allSettled(keys.map((key) => bucket.head(key)));
  return deletions.every((result) => result.status === "fulfilled")
    && verification.every((result) => result.status === "fulfilled" && result.value === null);
}
