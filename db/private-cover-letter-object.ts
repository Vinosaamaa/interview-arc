async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function privateCoverLetterObjectKey(input: {
  ownerId: string;
  artifactId: string;
  storageGeneration: string;
  format: "docx" | "pdf";
}) {
  const privateRoot = await sha256Hex(`${input.ownerId}\u0000${input.artifactId}`);
  return `career-materials-private/cover-letters/${privateRoot}/${input.storageGeneration}/letter.${input.format}`;
}
