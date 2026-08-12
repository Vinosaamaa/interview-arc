import { z } from "zod";

const stableId = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,199}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

function isPublicHttpUrl(value: string) {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const hasSensitiveParameter = [...url.searchParams.keys()]
    .some((key) => /(?:^|[_-])(token|secret|password|signature|auth|api[_-]?key)(?:$|[_-])/i.test(key));
  return ["http:", "https:"].includes(url.protocol)
    && !url.username
    && !url.password
    && hostname !== "localhost"
    && !hostname.endsWith(".localhost")
    && !hostname.endsWith(".local")
    && !hostname.startsWith("[")
    && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
    && !hasSensitiveParameter;
}

const publicHttpUrl = z.string().url().max(2_048).refine(isPublicHttpUrl);
const pageCursorSchema = z.object({
  hasMore: z.boolean(),
  nextCursor: z.string().min(1).max(2_048).nullable(),
}).strict().superRefine((page, context) => {
  if (page.hasMore !== (page.nextCursor !== null)) context.addIssue({
    code: "custom",
    path: ["nextCursor"],
    message: "A continuation cursor is required exactly when more results exist.",
  });
});

export const coverLetterArtifactFileSchema = z.object({
  format: z.enum(["docx", "pdf"]),
  sha256,
  byteSize: z.number().int().positive().max(8 * 1024 * 1024),
  mimeType: z.enum([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/pdf",
  ]),
  filename: z.string().trim().min(1).max(180),
  downloadPath: z.string().regex(/^\/api\/career-materials\/cover-letters\/[a-z0-9._-]+\/(docx|pdf)$/),
}).strict().superRefine((file, context) => {
  if (!file.filename.toLowerCase().endsWith(`.${file.format}`)) context.addIssue({
    code: "custom",
    path: ["filename"],
    message: "The filename extension must match its format.",
  });
  if (!file.downloadPath.endsWith(`/${file.format}`)) context.addIssue({
    code: "custom",
    path: ["downloadPath"],
    message: "The download path must match its format.",
  });
});

export const careerMaterialsCoverLetterArtifactSchema = z.object({
  id: stableId,
  lineageId: stableId,
  parentRevisionId: stableId.nullable(),
  company: z.string().trim().min(1).max(180),
  role: z.string().trim().min(1).max(180),
  sourceUrl: publicHttpUrl.nullable(),
  state: z.enum(["ready", "superseded"]),
  jobDescriptionSha256: sha256,
  resumeId: stableId,
  resumeRevisionId: stableId,
  evidenceFingerprint: sha256,
  resumeLabel: z.string().trim().min(1).max(120).nullable(),
  resumeRevisionKnown: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
  readyAt: z.string().datetime({ offset: true }),
  supersededAt: z.string().datetime({ offset: true }).nullable(),
  files: z.array(coverLetterArtifactFileSchema).length(2),
}).strict().superRefine((artifact, context) => {
  const formats = new Set(artifact.files.map((file) => file.format));
  if (formats.size !== 2 || !formats.has("docx") || !formats.has("pdf")) context.addIssue({
    code: "custom",
    path: ["files"],
    message: "A complete DOCX/PDF pair is required.",
  });
});

export type CareerMaterialsCoverLetterArtifact = z.infer<typeof careerMaterialsCoverLetterArtifactSchema>;

export const careerMaterialsCoverLetterResponseSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.literal("available"),
  stale: z.literal(false),
  generatedAt: z.string().datetime({ offset: true }),
  artifacts: z.array(careerMaterialsCoverLetterArtifactSchema).max(100),
  page: pageCursorSchema,
}).strict();

export type CareerMaterialsCoverLetterResponse = z.infer<typeof careerMaterialsCoverLetterResponseSchema>;
