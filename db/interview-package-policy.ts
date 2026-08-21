import { z } from "zod";

import { loopInterviewMaterialSnapshotSchema, loopStableIdSchema } from "./loop-policy.ts";

export const INTERVIEW_PACKAGE_SCHEMA_VERSION = 1 as const;
export const INTERVIEW_PACKAGE_PART_BYTES = 5 * 1024 * 1024;
export const INTERVIEW_PACKAGE_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
export const INTERVIEW_PACKAGE_MAX_FILES = 20;
export const INTERVIEW_PACKAGE_MAX_ENTRIES = 50;
export const INTERVIEW_PACKAGE_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

export const interviewPackageSourceKindSchema = z.enum(["audio", "transcript", "document", "image"]);
export type InterviewPackageSourceKind = z.infer<typeof interviewPackageSourceKindSchema>;

export const INTERVIEW_PACKAGE_MEDIA_TYPES: Readonly<Record<InterviewPackageSourceKind, ReadonlySet<string>>> = {
  audio: new Set(["audio/mpeg", "audio/mp4", "audio/wav", "audio/webm", "audio/ogg"]),
  transcript: new Set(["text/plain", "text/vtt", "application/x-subrip"]),
  document: new Set(["application/pdf", "text/plain", "text/markdown"]),
  image: new Set(["image/png", "image/jpeg", "image/webp"]),
};

export const INTERVIEW_PACKAGE_SOURCE_LIMITS: Readonly<Record<InterviewPackageSourceKind, number>> = {
  audio: 1024 * 1024 * 1024,
  transcript: 512 * 1024,
  document: 50 * 1024 * 1024,
  image: 25 * 1024 * 1024,
};

const boundedText = (max: number) => z.string().normalize().trim().min(1).max(max);
const optionalText = (max: number) => z.string().normalize().trim().min(1).max(max).optional();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const commandEnvelope = {
  schemaVersion: z.literal(INTERVIEW_PACKAGE_SCHEMA_VERSION),
  operationId: loopStableIdSchema,
};
const packageCommandEnvelope = {
  ...commandEnvelope,
  packageId: loopStableIdSchema,
};
const revisionedPackageCommandEnvelope = {
  ...packageCommandEnvelope,
  expectedRevision: z.number().int().positive(),
};

function validTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export const interviewPackageAssignmentSchema = z.object({
  loopId: loopStableIdSchema,
  stageId: loopStableIdSchema.optional(),
  expectedLoopRevision: z.number().int().positive(),
  expectedRoleBriefRevision: z.number().int().positive(),
}).strict();

export const createInterviewPackageSchema = z.object({
  ...commandEnvelope,
  interviewAt: z.number().int().positive().optional(),
  timeZone: boundedText(100).refine(validTimeZone, "Use a valid IANA time zone.").optional(),
  assignment: interviewPackageAssignmentSchema.optional(),
  consentAffirmed: z.literal(true),
}).strict().superRefine((input, context) => {
  if (Boolean(input.interviewAt) !== Boolean(input.timeZone)) {
    context.addIssue({
      code: "custom",
      path: input.interviewAt ? ["timeZone"] : ["interviewAt"],
      message: "Interview time and time zone must be supplied together.",
    });
  }
});

export const assignInterviewPackageSchema = z.object({
  ...revisionedPackageCommandEnvelope,
  assignment: interviewPackageAssignmentSchema.nullable(),
}).strict();

export const declareInterviewPackageSourceSchema = z.object({
  ...revisionedPackageCommandEnvelope,
  kind: interviewPackageSourceKindSchema,
  label: boundedText(240),
  mediaType: boundedText(120).transform((value) => value.toLowerCase()),
  sizeBytes: z.number().int().positive(),
}).strict().superRefine((input, context) => {
  if (!INTERVIEW_PACKAGE_MEDIA_TYPES[input.kind].has(input.mediaType)) {
    context.addIssue({ code: "custom", path: ["mediaType"], message: "That file format is not allowed for this source type." });
  }
  if (input.sizeBytes > INTERVIEW_PACKAGE_SOURCE_LIMITS[input.kind]) {
    context.addIssue({ code: "custom", path: ["sizeBytes"], message: "That file exceeds the source-type size limit." });
  }
});

const linkSnapshotSchema = z.object({
  kind: z.literal("link"),
  label: boundedText(240),
  url: boundedText(2_000).superRefine((value, context) => {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("unsafe");
    } catch {
      context.addIssue({ code: "custom", message: "Use a credential-free HTTPS URL." });
    }
  }),
  note: optionalText(2_000),
}).strict();

const noteSnapshotSchema = z.object({
  kind: z.literal("note"),
  label: boundedText(240),
  body: boundedText(20_000),
}).strict();

export const interviewPackageEntrySnapshotSchema = z.discriminatedUnion("kind", [linkSnapshotSchema, noteSnapshotSchema]);

export const addInterviewPackageEntrySchema = z.object({
  ...revisionedPackageCommandEnvelope,
  entry: interviewPackageEntrySnapshotSchema,
}).strict();

export const reviseInterviewPackageEntrySchema = z.object({
  ...revisionedPackageCommandEnvelope,
  entryId: loopStableIdSchema,
  expectedEntryRevision: z.number().int().positive(),
  entry: interviewPackageEntrySnapshotSchema,
}).strict();

export const finalizeInterviewPackageSchema = z.object({
  ...revisionedPackageCommandEnvelope,
  includedSourceIds: z.array(loopStableIdSchema).max(INTERVIEW_PACKAGE_MAX_FILES),
  includedEntryIds: z.array(loopStableIdSchema).max(INTERVIEW_PACKAGE_MAX_ENTRIES),
  finalizeSubset: z.boolean(),
}).strict().superRefine((input, context) => {
  if (new Set(input.includedSourceIds).size !== input.includedSourceIds.length) {
    context.addIssue({ code: "custom", path: ["includedSourceIds"], message: "A source may be selected only once." });
  }
  if (new Set(input.includedEntryIds).size !== input.includedEntryIds.length) {
    context.addIssue({ code: "custom", path: ["includedEntryIds"], message: "An entry may be selected only once." });
  }
  if (input.includedSourceIds.length + input.includedEntryIds.length === 0) {
    context.addIssue({ code: "custom", path: ["includedSourceIds"], message: "Finalize at least one ready source or active entry." });
  }
});

export const linkInterviewPackageMaterialSchema = z.object({
  ...revisionedPackageCommandEnvelope,
  materialId: loopStableIdSchema.nullable(),
  materialRevision: z.number().int().positive().nullable(),
}).strict().refine((input) => Boolean(input.materialId) === Boolean(input.materialRevision), {
  path: ["materialRevision"],
  message: "Material identity and revision must be linked or cleared together.",
});

export const prepareInterviewPackageMaterialProposalSchema = z.object({
  ...revisionedPackageCommandEnvelope,
  baseMaterialRevision: z.number().int().positive().nullable(),
  baseLoopRevision: z.number().int().positive(),
  baseRoleBriefRevision: z.number().int().positive(),
  selectedSourceIds: z.array(loopStableIdSchema).min(1).max(INTERVIEW_PACKAGE_MAX_FILES + INTERVIEW_PACKAGE_MAX_ENTRIES),
  proposedMaterial: loopInterviewMaterialSnapshotSchema,
}).strict().superRefine((input, context) => {
  if (new Set(input.selectedSourceIds).size !== input.selectedSourceIds.length) {
    context.addIssue({ code: "custom", path: ["selectedSourceIds"], message: "A proposal source may be selected only once." });
  }
  if (input.proposedMaterial.provenance.roleBriefRevision !== input.baseRoleBriefRevision) {
    context.addIssue({ code: "custom", path: ["proposedMaterial", "provenance", "roleBriefRevision"], message: "The proposal must pin the reviewed Role Brief revision." });
  }
});

export const confirmInterviewPackageMaterialProposalSchema = z.object({
  ...revisionedPackageCommandEnvelope,
  proposalId: loopStableIdSchema,
}).strict();

export const cancelInterviewPackageUploadSchema = z.object({
  ...packageCommandEnvelope,
  sourceId: loopStableIdSchema,
}).strict();

export const completeInterviewPackageUploadSchema = z.object({
  ...packageCommandEnvelope,
  sourceId: loopStableIdSchema,
}).strict();

export const deleteInterviewPackageSchema = z.object({
  ...revisionedPackageCommandEnvelope,
  confirmation: z.literal("delete_interview_package"),
}).strict();

export const interviewPackageDigestSchema = sha256Schema;
