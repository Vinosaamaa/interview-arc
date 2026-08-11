import { z } from "zod";

export const learningStableIdSchema = z.string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();

export const learningSourcePinSchema = z.object({
  kind: z.enum(["web", "repository", "engineering_journal", "owner_provided"]),
  title: boundedText(300),
  url: z.string().url().max(2_000).optional(),
  repository: optionalText(300),
  commit: z.string().trim().regex(/^[0-9a-f]{7,64}$/i).optional(),
  path: optionalText(1_000),
  recordId: learningStableIdSchema.optional(),
  recordRevision: z.number().int().positive().optional(),
  symbols: z.array(boundedText(300)).max(100).default([]),
}).strict().superRefine((source, context) => {
  if (source.kind === "web" && !source.url) {
    context.addIssue({ code: "custom", message: "A web source requires its exact URL.", path: ["url"] });
  }
  if (source.kind === "repository" && (!source.repository || !source.commit)) {
    context.addIssue({
      code: "custom",
      message: "A repository source requires repository identity and an exact commit.",
    });
  }
  if (source.kind === "engineering_journal" && (
    !source.repository || !source.commit || !source.recordId || !source.recordRevision
  )) {
    context.addIssue({
      code: "custom",
      message: "Learn this requires the exact Journal record revision, repository, and commit.",
    });
  }
});

export const learningBlueprintLessonSchema = z.object({
  lessonId: learningStableIdSchema,
  title: boundedText(300),
  order: z.number().int().nonnegative(),
  kind: z.enum(["lesson", "lab"]),
  objective: boundedText(2_000),
  prerequisites: z.array(learningStableIdSchema).max(50).default([]),
}).strict();

export const learningBlueprintModuleSchema = z.object({
  moduleId: learningStableIdSchema,
  title: boundedText(300),
  order: z.number().int().nonnegative(),
  objective: boundedText(2_000),
  lessons: z.array(learningBlueprintLessonSchema).min(1).max(100),
}).strict();

function uniqueBy<T>(items: T[], key: (item: T) => string | number) {
  const values = items.map(key);
  return new Set(values).size === values.length;
}

export const learningCourseBlueprintSchema = z.object({
  courseId: learningStableIdSchema,
  state: z.enum(["draft", "active", "completed", "archived"]),
  title: boundedText(300),
  goal: boundedText(4_000),
  priorKnowledge: z.array(boundedText(1_000)).max(100).default([]),
  intendedOutcome: boundedText(4_000),
  sourcePins: z.array(learningSourcePinSchema).max(100).default([]),
  modules: z.array(learningBlueprintModuleSchema).min(1).max(50),
}).strict().superRefine((blueprint, context) => {
  if (!uniqueBy(blueprint.modules, (module) => module.moduleId)) {
    context.addIssue({ code: "custom", message: "Module IDs must be unique.", path: ["modules"] });
  }
  if (!uniqueBy(blueprint.modules, (module) => module.order)) {
    context.addIssue({ code: "custom", message: "Module order values must be unique.", path: ["modules"] });
  }
  const lessonIds = blueprint.modules.flatMap((module) => module.lessons.map((lesson) => lesson.lessonId));
  if (new Set(lessonIds).size !== lessonIds.length) {
    context.addIssue({ code: "custom", message: "Lesson IDs must be unique across the Course.", path: ["modules"] });
  }
  blueprint.modules.forEach((module, moduleIndex) => {
    if (!uniqueBy(module.lessons, (lesson) => lesson.order)) {
      context.addIssue({
        code: "custom",
        message: "Lesson order values must be unique inside a Module.",
        path: ["modules", moduleIndex, "lessons"],
      });
    }
  });
});

export const learningCheckpointDefinitionSchema = z.object({
  checkpointId: learningStableIdSchema,
  label: boundedText(300),
  description: boundedText(2_000),
  required: z.boolean().default(true),
}).strict();

export const learningLessonSnapshotSchema = z.object({
  lessonId: learningStableIdSchema,
  state: z.enum(["active", "completed", "archived"]),
  title: boundedText(300),
  objective: boundedText(2_000),
  prerequisites: z.array(boundedText(1_000)).max(50).default([]),
  sections: z.array(z.object({
    sectionId: learningStableIdSchema,
    heading: boundedText(300),
    body: boundedText(20_000),
  }).strict()).min(1).max(50),
  examples: z.array(z.object({
    exampleId: learningStableIdSchema,
    title: boundedText(300),
    body: boundedText(20_000),
    language: optionalText(100),
  }).strict()).max(20).default([]),
  exercises: z.array(z.object({
    exerciseId: learningStableIdSchema,
    prompt: boundedText(10_000),
  }).strict()).max(20).default([]),
  homework: z.array(z.object({
    homeworkId: learningStableIdSchema,
    prompt: boundedText(10_000),
  }).strict()).max(20).default([]),
  checkpoints: z.array(learningCheckpointDefinitionSchema).min(1).max(3),
  sourcePins: z.array(learningSourcePinSchema).max(100).default([]),
}).strict().superRefine((lesson, context) => {
  for (const [path, items, key] of [
    ["sections", lesson.sections, "sectionId"],
    ["examples", lesson.examples, "exampleId"],
    ["exercises", lesson.exercises, "exerciseId"],
    ["homework", lesson.homework, "homeworkId"],
    ["checkpoints", lesson.checkpoints, "checkpointId"],
  ] as const) {
    if (!uniqueBy(items as Array<Record<string, unknown>>, (item) => String(item[key]))) {
      context.addIssue({ code: "custom", message: `${path} IDs must be unique.`, path: [path] });
    }
  }
});

export const learningLessonScopeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("course"),
    courseId: learningStableIdSchema,
    enrollmentId: learningStableIdSchema,
    moduleId: learningStableIdSchema,
    blueprintRevision: z.number().int().positive(),
  }).strict(),
  z.object({
    kind: z.literal("quick_study"),
  }).strict(),
]);

export const createLearningCourseBlueprintSchema = z.object({
  operationId: learningStableIdSchema,
  authorization: z.literal("learning_specialist"),
  blueprint: learningCourseBlueprintSchema,
}).strict();

export const reviseLearningCourseBlueprintSchema = z.object({
  operationId: learningStableIdSchema,
  courseId: learningStableIdSchema,
  expectedRevision: z.number().int().positive(),
  authorization: z.literal("learning_specialist"),
  blueprint: learningCourseBlueprintSchema,
}).strict().superRefine((input, context) => {
  if (input.courseId !== input.blueprint.courseId) {
    context.addIssue({ code: "custom", message: "Course identity cannot change across Blueprint revisions." });
  }
});

export const approveLearningEnrollmentSchema = z.object({
  operationId: learningStableIdSchema,
  enrollmentId: learningStableIdSchema,
  courseId: learningStableIdSchema,
  expectedBlueprintRevision: z.number().int().positive(),
  authorization: z.literal("explicit_user_instruction"),
}).strict();

export const saveLearningLessonRevisionSchema = z.object({
  operationId: learningStableIdSchema,
  expectedRevision: z.number().int().nonnegative(),
  authorization: z.literal("learning_specialist"),
  scope: learningLessonScopeSchema,
  lesson: learningLessonSnapshotSchema,
}).strict();

export const createLearningSessionSchema = z.object({
  operationId: learningStableIdSchema,
  sessionId: learningStableIdSchema,
  authorization: z.literal("learning_specialist"),
  scope: learningLessonScopeSchema,
  lessonId: learningStableIdSchema,
  lessonRevision: z.number().int().positive(),
}).strict();

export const controlLearningSessionSchema = z.object({
  operationId: learningStableIdSchema,
  sessionId: learningStableIdSchema,
  expectedRevision: z.number().int().nonnegative(),
  action: z.enum(["start", "pause", "resume"]),
  authorization: z.literal("explicit_user_instruction"),
}).strict();

export const learningEvidenceReferenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("transcript_turn"), turnId: learningStableIdSchema }).strict(),
  z.object({ kind: z.literal("artifact"), artifactId: learningStableIdSchema }).strict(),
  z.object({
    kind: z.literal("homework"),
    homeworkId: learningStableIdSchema,
    revision: z.number().int().positive(),
  }).strict(),
]);

export const learningCheckpointResultSchema = z.object({
  checkpointId: learningStableIdSchema,
  status: z.enum(["not_attempted", "needs_another_pass", "demonstrated"]),
  rationale: boundedText(4_000),
  evidence: z.array(learningEvidenceReferenceSchema).max(50).default([]),
  supersedesRevision: z.number().int().positive().optional(),
}).strict().superRefine((result, context) => {
  if (result.status === "demonstrated" && result.evidence.length === 0) {
    context.addIssue({
      code: "custom",
      message: "Demonstrated requires at least one exact transcript, artifact, or homework evidence reference.",
      path: ["evidence"],
    });
  }
});

export const finishLearningSessionSchema = z.object({
  operationId: learningStableIdSchema,
  sessionId: learningStableIdSchema,
  expectedRevision: z.number().int().positive(),
  expectedTranscriptRevision: z.number().int().nonnegative(),
  authorization: z.literal("explicit_user_instruction"),
  finalization: z.object({
    recap: boundedText(10_000),
    unresolvedQuestions: z.array(boundedText(2_000)).max(50).default([]),
    recommendedNextAction: boundedText(2_000),
    checkpointResults: z.array(learningCheckpointResultSchema).max(3).default([]),
  }).strict(),
}).strict().superRefine((input, context) => {
  if (!uniqueBy(input.finalization.checkpointResults, (result) => result.checkpointId)) {
    context.addIssue({
      code: "custom",
      message: "A Session finalization may record each checkpoint at most once.",
      path: ["finalization", "checkpointResults"],
    });
  }
});

export const attachLearningArtifactSchema = z.object({
  operationId: learningStableIdSchema,
  artifactId: learningStableIdSchema,
  lessonId: learningStableIdSchema,
  sessionId: learningStableIdSchema.optional(),
  homeworkId: learningStableIdSchema.optional(),
  kind: z.enum(["code", "diagram", "trace", "written", "link"]),
  label: boundedText(300),
  mediaType: boundedText(200),
  sizeBytes: z.number().int().nonnegative().max(1_000_000_000),
  contentHash: z.string().trim().regex(/^[0-9a-f]{64}$/i),
  privateLocator: boundedText(2_000),
  authorization: z.literal("learning_specialist"),
}).strict();

export const setLearningHomeworkStateSchema = z.object({
  operationId: learningStableIdSchema,
  lessonId: learningStableIdSchema,
  homeworkId: learningStableIdSchema,
  expectedRevision: z.number().int().positive(),
  state: z.enum(["open", "completed"]),
  authorization: z.literal("explicit_user_instruction"),
}).strict();

export const queryLearningEvidenceSchema = z.object({
  lessonId: learningStableIdSchema.optional(),
  sessionId: learningStableIdSchema.optional(),
}).strict();

export const queryLearningJourneySchema = z.object({
  courseId: learningStableIdSchema.optional(),
  limit: z.number().int().min(1).max(500).default(200),
}).strict();

export const learningTranscriptTurnSchema = z.object({
  turnId: learningStableIdSchema,
  sequence: z.number().int().nonnegative(),
  speaker: z.enum(["learner", "specialist"]),
  source: z.enum(["typed", "dictation", "voice_transcript"]),
  body: boundedText(50_000),
  occurredAt: z.number().int().positive(),
}).strict();

export const appendLearningTranscriptSchema = z.object({
  operationId: learningStableIdSchema,
  sessionId: learningStableIdSchema,
  expectedTranscriptRevision: z.number().int().nonnegative(),
  writer: z.enum(["learning_specialist", "arc_voice"]),
  turns: z.array(learningTranscriptTurnSchema).min(1).max(20),
}).strict().superRefine((input, context) => {
  if (!uniqueBy(input.turns, (turn) => turn.turnId)) {
    context.addIssue({ code: "custom", message: "Transcript turn IDs must be unique.", path: ["turns"] });
  }
  if (!uniqueBy(input.turns, (turn) => turn.sequence)) {
    context.addIssue({ code: "custom", message: "Transcript sequence values must be unique.", path: ["turns"] });
  }
  const ordered = [...input.turns].sort((left, right) => left.sequence - right.sequence);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].sequence !== ordered[index - 1].sequence + 1) {
      context.addIssue({ code: "custom", message: "Transcript turns must form one contiguous sequence.", path: ["turns"] });
      break;
    }
  }
  if (input.writer === "arc_voice" && input.turns.some((turn) => turn.source !== "voice_transcript")) {
    context.addIssue({
      code: "custom",
      message: "Arc Voice may append transcript-only Voice turns and no other Learning evidence.",
      path: ["turns"],
    });
  }
});

export const queryLearningSessionsSchema = z.object({
  sessionId: learningStableIdSchema.optional(),
  lessonId: learningStableIdSchema.optional(),
  includeCompleted: z.boolean().default(true),
}).strict();

export const queryLearningWorkspaceSchema = z.object({
  courseId: learningStableIdSchema.optional(),
  blueprintRevision: z.number().int().positive().optional(),
  lessonId: learningStableIdSchema.optional(),
  lessonRevision: z.number().int().positive().optional(),
  includeArchived: z.boolean().default(false),
}).strict();

export type LearningCourseBlueprint = z.infer<typeof learningCourseBlueprintSchema>;
export type LearningLessonSnapshot = z.infer<typeof learningLessonSnapshotSchema>;
export type CreateLearningCourseBlueprintInput = z.infer<typeof createLearningCourseBlueprintSchema>;
export type ReviseLearningCourseBlueprintInput = z.infer<typeof reviseLearningCourseBlueprintSchema>;
export type ApproveLearningEnrollmentInput = z.infer<typeof approveLearningEnrollmentSchema>;
export type SaveLearningLessonRevisionInput = z.infer<typeof saveLearningLessonRevisionSchema>;
export type CreateLearningSessionInput = z.infer<typeof createLearningSessionSchema>;
export type ControlLearningSessionInput = z.infer<typeof controlLearningSessionSchema>;
export type AppendLearningTranscriptInput = z.infer<typeof appendLearningTranscriptSchema>;
export type FinishLearningSessionInput = z.infer<typeof finishLearningSessionSchema>;
export type AttachLearningArtifactInput = z.infer<typeof attachLearningArtifactSchema>;
export type SetLearningHomeworkStateInput = z.infer<typeof setLearningHomeworkStateSchema>;
