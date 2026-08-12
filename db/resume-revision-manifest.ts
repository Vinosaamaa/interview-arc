import { z } from "zod";

const stableId = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,199}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export function normalizeResumeBulletText(value: string) {
  return value.normalize("NFKC").replaceAll("\r\n", "\n").trim();
}

export const resumeBulletManifestSchema = z.object({
  occurrenceId: stableId,
  sectionLabel: z.string().trim().min(1).max(160),
  ordinal: z.number().int().nonnegative().max(999),
  text: z.string().transform(normalizeResumeBulletText).pipe(z.string().min(1).max(2_000)),
  contentFingerprint: sha256,
  claimIds: z.array(stableId).max(20).default([]),
  evidenceIds: z.array(stableId).max(20).default([]),
}).strict();

export const resumeRevisionManifestSchema = z.object({
  schemaVersion: z.literal(1),
  sourceProvider: z.enum(["google_drive", "local_file"]),
  sourceRevisionFingerprint: sha256,
  extractionVersion: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/),
  capturedAt: z.number().int().positive(),
  bullets: z.array(resumeBulletManifestSchema).max(240),
}).strict().superRefine((manifest, context) => {
  const occurrenceIds = new Set<string>();
  const positions = new Set<number>();
  let referenceCount = 0;
  manifest.bullets.forEach((bullet, index) => {
    if (occurrenceIds.has(bullet.occurrenceId)) {
      context.addIssue({ code: "custom", path: ["bullets", index, "occurrenceId"], message: "occurrenceId must be unique." });
    }
    occurrenceIds.add(bullet.occurrenceId);
    if (positions.has(bullet.ordinal)) {
      context.addIssue({ code: "custom", path: ["bullets", index, "ordinal"], message: "Document ordering must be unique." });
    }
    positions.add(bullet.ordinal);
    for (const key of ["claimIds", "evidenceIds"] as const) {
      referenceCount += bullet[key].length;
      if (new Set(bullet[key]).size !== bullet[key].length) {
        context.addIssue({ code: "custom", path: ["bullets", index, key], message: `${key} must contain unique IDs.` });
      }
    }
  });
  if (referenceCount > 400) {
    context.addIssue({ code: "custom", path: ["bullets"], message: "A resume manifest may contain at most 400 claim/evidence links." });
  }
});

export type ResumeRevisionManifest = z.infer<typeof resumeRevisionManifestSchema>;

export async function resumeSha256Hex(value: string | ArrayBuffer) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function validateResumeRevisionManifest(value: unknown) {
  const manifest = resumeRevisionManifestSchema.parse(value);
  for (const bullet of manifest.bullets) {
    if (await resumeSha256Hex(bullet.text) !== bullet.contentFingerprint) {
      throw new Error(`Resume bullet ${bullet.occurrenceId} does not match its content fingerprint.`);
    }
  }
  return {
    manifest,
    manifestFingerprint: await resumeSha256Hex(JSON.stringify(manifest)),
  };
}
