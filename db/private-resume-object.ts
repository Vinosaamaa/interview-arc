async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function privateResumeObjectKey(input: {
  ownerId: string;
  resumeId: string;
  revisionId: string;
  storageGeneration: string;
  format: "docx" | "pdf";
}) {
  const privateRoot = await sha256Hex(`${input.ownerId}\u0000${input.resumeId}\u0000${input.revisionId}`);
  return `resume-private/${privateRoot}/${input.storageGeneration}/source.${input.format}`;
}
