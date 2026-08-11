import { and, asc, desc, eq, ne, sql } from "drizzle-orm";

import { d1TransactionalInvariantGuard } from "./d1-transactional-guard";
import { getDb } from "./index";
import {
  learningCourseBlueprintRevisions,
  learningCourses,
  learningArtifacts,
  learningCheckpointResultEvents,
  learningCheckpointStates,
  learningEnrollments,
  learningHomework,
  learningHomeworkStateEvents,
  learningLessonRevisions,
  learningLessons,
  learningOperations,
  learningSessionIntervals,
  learningSessionFinalizationRevisions,
  learningSessions,
  learningTranscriptTurns,
} from "./schema";
import {
  appendLearningTranscriptSchema,
  attachLearningArtifactSchema,
  approveLearningEnrollmentSchema,
  controlLearningSessionSchema,
  createLearningCourseBlueprintSchema,
  createLearningSessionSchema,
  finishLearningSessionSchema,
  learningCourseBlueprintSchema,
  learningLessonSnapshotSchema,
  queryLearningWorkspaceSchema,
  queryLearningSessionsSchema,
  queryLearningEvidenceSchema,
  queryLearningAnalyticsSchema,
  queryLearningJourneySchema,
  reviseLearningCourseBlueprintSchema,
  saveLearningLessonRevisionSchema,
  setLearningHomeworkStateSchema,
  type ApproveLearningEnrollmentInput,
  type AppendLearningTranscriptInput,
  type AttachLearningArtifactInput,
  type ControlLearningSessionInput,
  type CreateLearningCourseBlueprintInput,
  type CreateLearningSessionInput,
  type FinishLearningSessionInput,
  type LearningCourseBlueprint,
  type LearningLessonSnapshot,
  type ReviseLearningCourseBlueprintInput,
  type SaveLearningLessonRevisionInput,
  type SetLearningHomeworkStateInput,
} from "./learn-policy";

export {
  appendLearningTranscriptSchema,
  attachLearningArtifactSchema,
  approveLearningEnrollmentSchema,
  controlLearningSessionSchema,
  createLearningCourseBlueprintSchema,
  createLearningSessionSchema,
  finishLearningSessionSchema,
  queryLearningEvidenceSchema,
  queryLearningAnalyticsSchema,
  queryLearningJourneySchema,
  queryLearningSessionsSchema,
  queryLearningWorkspaceSchema,
  reviseLearningCourseBlueprintSchema,
  saveLearningLessonRevisionSchema,
  setLearningHomeworkStateSchema,
} from "./learn-policy";

export class LearningError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "LearningError";
    this.code = code;
    this.retryable = retryable;
  }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const fingerprint = (input: unknown) => sha256(JSON.stringify(input));

async function replayLearningOperation(ownerId: string, operationId: string, requestFingerprint: string) {
  const rows = await getDb().select().from(learningOperations).where(and(
    eq(learningOperations.ownerId, ownerId),
    eq(learningOperations.operationId, operationId),
  )).limit(1);
  const operation = rows[0];
  if (!operation) return null;
  if (operation.requestFingerprint !== requestFingerprint) {
    throw new LearningError(
      "learning_operation_conflict",
      "This Learning operation ID already belongs to a different request.",
    );
  }
  return { ...(operation.receipt as object), duplicate: true };
}

function orderedBlueprint(blueprint: LearningCourseBlueprint) {
  return {
    ...blueprint,
    modules: [...blueprint.modules]
      .sort((left, right) => left.order - right.order)
      .map((module) => ({
        ...module,
        lessons: [...module.lessons].sort((left, right) => left.order - right.order),
      })),
  };
}

export async function createLearningCourseBlueprint(
  ownerId: string,
  inputValue: unknown,
  nowMs = Date.now(),
) {
  const input = createLearningCourseBlueprintSchema.parse(inputValue) as CreateLearningCourseBlueprintInput;
  if (input.blueprint.state !== "draft") {
    throw new LearningError(
      "learning_blueprint_requires_review",
      "A new Course Blueprint must remain draft until the owner explicitly approves Enrollment.",
    );
  }
  const db = getDb();
  const requestFingerprint = await fingerprint(input);
  const replay = await replayLearningOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;

  const courseId = input.blueprint.courseId;
  const receipt = { status: "draft_created" as const, courseId, blueprintRevision: 1 };
  const absent = sql`NOT EXISTS (
    SELECT 1 FROM ${learningCourses}
    WHERE ${learningCourses.ownerId} = ${ownerId}
      AND ${learningCourses.courseId} = ${courseId}
  ) AND NOT EXISTS (
    SELECT 1 FROM ${learningOperations}
    WHERE ${learningOperations.ownerId} = ${ownerId}
      AND ${learningOperations.operationId} = ${input.operationId}
  )`;
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, absent),
      db.insert(learningCourseBlueprintRevisions).values({
        ownerId,
        courseId,
        revision: 1,
        operationId: input.operationId,
        requestFingerprint,
        snapshot: orderedBlueprint(input.blueprint),
        createdAt: nowMs,
      }),
      db.insert(learningCourses).values({
        ownerId,
        courseId,
        currentBlueprintRevision: 1,
        state: "draft",
        title: input.blueprint.title,
        createdAt: nowMs,
        updatedAt: nowMs,
      }),
      db.insert(learningOperations).values({
        ownerId,
        operationId: input.operationId,
        aggregateType: "course",
        aggregateId: courseId,
        action: "create_blueprint",
        requestFingerprint,
        receipt,
        createdAt: nowMs,
      }),
      d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${learningCourses}
        WHERE ${learningCourses.ownerId} = ${ownerId}
          AND ${learningCourses.courseId} = ${courseId}
          AND ${learningCourses.currentBlueprintRevision} = 1
      )`),
    ]);
  } catch (error) {
    const racedReplay = await replayLearningOperation(ownerId, input.operationId, requestFingerprint);
    if (racedReplay) return racedReplay;
    const existing = await db.select({ courseId: learningCourses.courseId }).from(learningCourses).where(and(
      eq(learningCourses.ownerId, ownerId),
      eq(learningCourses.courseId, courseId),
    )).limit(1);
    if (existing[0]) {
      throw new LearningError("learning_course_exists", "That Course already exists; reread it before retrying.");
    }
    throw error;
  }
  return { ...receipt, duplicate: false };
}

export async function reviseLearningCourseBlueprint(
  ownerId: string,
  inputValue: unknown,
  nowMs = Date.now(),
) {
  const input = reviseLearningCourseBlueprintSchema.parse(inputValue) as ReviseLearningCourseBlueprintInput;
  const db = getDb();
  const requestFingerprint = await fingerprint(input);
  const replay = await replayLearningOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;

  const currentRows = await db.select().from(learningCourses).where(and(
    eq(learningCourses.ownerId, ownerId),
    eq(learningCourses.courseId, input.courseId),
  )).limit(1);
  const current = currentRows[0];
  if (!current) throw new LearningError("learning_course_not_found", "That owner-private Course is unavailable.");
  if (current.currentBlueprintRevision !== input.expectedRevision) {
    throw new LearningError("learning_blueprint_revision_conflict", "The Blueprint changed; reread it before retrying.");
  }
  const revision = input.expectedRevision + 1;
  const receipt = { status: "blueprint_revised" as const, courseId: input.courseId, blueprintRevision: revision };
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${learningCourses}
        WHERE ${learningCourses.ownerId} = ${ownerId}
          AND ${learningCourses.courseId} = ${input.courseId}
          AND ${learningCourses.currentBlueprintRevision} = ${input.expectedRevision}
      )`),
      db.insert(learningCourseBlueprintRevisions).values({
        ownerId,
        courseId: input.courseId,
        revision,
        operationId: input.operationId,
        requestFingerprint,
        snapshot: orderedBlueprint(input.blueprint),
        createdAt: nowMs,
      }),
      db.update(learningCourses).set({
        currentBlueprintRevision: revision,
        state: input.blueprint.state,
        title: input.blueprint.title,
        updatedAt: nowMs,
      }).where(and(
        eq(learningCourses.ownerId, ownerId),
        eq(learningCourses.courseId, input.courseId),
        eq(learningCourses.currentBlueprintRevision, input.expectedRevision),
      )),
      db.insert(learningOperations).values({
        ownerId,
        operationId: input.operationId,
        aggregateType: "course",
        aggregateId: input.courseId,
        action: "revise_blueprint",
        requestFingerprint,
        receipt,
        createdAt: nowMs,
      }),
    ]);
  } catch (error) {
    const racedReplay = await replayLearningOperation(ownerId, input.operationId, requestFingerprint);
    if (racedReplay) return racedReplay;
    const raced = await db.select({ revision: learningCourses.currentBlueprintRevision }).from(learningCourses).where(and(
      eq(learningCourses.ownerId, ownerId),
      eq(learningCourses.courseId, input.courseId),
    )).limit(1);
    if (!raced[0]) throw new LearningError("learning_course_not_found", "That owner-private Course is unavailable.");
    if (raced[0].revision !== input.expectedRevision) {
      throw new LearningError("learning_blueprint_revision_conflict", "The Blueprint changed; reread it before retrying.");
    }
    throw error;
  }
  return { ...receipt, duplicate: false };
}

export async function approveLearningEnrollment(
  ownerId: string,
  inputValue: unknown,
  nowMs = Date.now(),
) {
  const input = approveLearningEnrollmentSchema.parse(inputValue) as ApproveLearningEnrollmentInput;
  const db = getDb();
  const requestFingerprint = await fingerprint(input);
  const replay = await replayLearningOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;

  const courseRows = await db.select().from(learningCourses).where(and(
    eq(learningCourses.ownerId, ownerId),
    eq(learningCourses.courseId, input.courseId),
  )).limit(1);
  const course = courseRows[0];
  if (!course) throw new LearningError("learning_course_not_found", "That owner-private Course is unavailable.");
  if (course.currentBlueprintRevision !== input.expectedBlueprintRevision) {
    throw new LearningError("learning_blueprint_revision_conflict", "The Blueprint changed; review it before Enrollment.");
  }
  const blueprintRows = await db.select().from(learningCourseBlueprintRevisions).where(and(
    eq(learningCourseBlueprintRevisions.ownerId, ownerId),
    eq(learningCourseBlueprintRevisions.courseId, input.courseId),
    eq(learningCourseBlueprintRevisions.revision, input.expectedBlueprintRevision),
  )).limit(1);
  const blueprint = learningCourseBlueprintSchema.parse(blueprintRows[0]?.snapshot);
  const firstModule = orderedBlueprint(blueprint).modules[0];
  const firstLesson = firstModule.lessons[0];
  const receipt = {
    status: "enrolled" as const,
    enrollmentId: input.enrollmentId,
    courseId: input.courseId,
    blueprintRevision: input.expectedBlueprintRevision,
    currentModuleId: firstModule.moduleId,
    currentLessonId: firstLesson.lessonId,
  };
  const absent = sql`NOT EXISTS (
    SELECT 1 FROM ${learningEnrollments}
    WHERE ${learningEnrollments.ownerId} = ${ownerId}
      AND (${learningEnrollments.enrollmentId} = ${input.enrollmentId}
        OR ${learningEnrollments.courseId} = ${input.courseId})
  )`;
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, absent),
      db.insert(learningEnrollments).values({
        ownerId,
        enrollmentId: input.enrollmentId,
        courseId: input.courseId,
        blueprintRevision: input.expectedBlueprintRevision,
        state: "active",
        currentModuleId: firstModule.moduleId,
        currentLessonId: firstLesson.lessonId,
        revision: 1,
        enrolledAt: nowMs,
        completedAt: null,
        updatedAt: nowMs,
      }),
      db.update(learningCourses).set({ state: "active", updatedAt: nowMs }).where(and(
        eq(learningCourses.ownerId, ownerId),
        eq(learningCourses.courseId, input.courseId),
        eq(learningCourses.currentBlueprintRevision, input.expectedBlueprintRevision),
      )),
      db.insert(learningOperations).values({
        ownerId,
        operationId: input.operationId,
        aggregateType: "enrollment",
        aggregateId: input.enrollmentId,
        action: "approve_enrollment",
        requestFingerprint,
        receipt,
        createdAt: nowMs,
      }),
    ]);
  } catch (error) {
    const racedReplay = await replayLearningOperation(ownerId, input.operationId, requestFingerprint);
    if (racedReplay) return racedReplay;
    const existing = await db.select().from(learningEnrollments).where(and(
      eq(learningEnrollments.ownerId, ownerId),
      eq(learningEnrollments.courseId, input.courseId),
    )).limit(1);
    if (existing[0]) {
      throw new LearningError("learning_enrollment_exists", "That Course already has an Enrollment.");
    }
    throw error;
  }
  return { ...receipt, duplicate: false };
}

async function validateCourseLessonScope(ownerId: string, input: SaveLearningLessonRevisionInput) {
  const scope = input.scope;
  if (scope.kind !== "course") return { blueprintRevision: null };
  const db = getDb();
  const enrollments = await db.select().from(learningEnrollments).where(and(
    eq(learningEnrollments.ownerId, ownerId),
    eq(learningEnrollments.enrollmentId, scope.enrollmentId),
  )).limit(1);
  const enrollment = enrollments[0];
  if (!enrollment || enrollment.courseId !== scope.courseId) {
    throw new LearningError("learning_enrollment_not_found", "That owner-private Enrollment is unavailable.");
  }
  if (enrollment.state !== "active") {
    throw new LearningError("learning_enrollment_inactive", "Only an active Enrollment can open a Course Lesson.");
  }
  if (enrollment.blueprintRevision !== scope.blueprintRevision) {
    throw new LearningError(
      "learning_enrollment_blueprint_mismatch",
      "The Lesson must use the exact Blueprint revision pinned by Enrollment.",
    );
  }
  const revisions = await db.select().from(learningCourseBlueprintRevisions).where(and(
    eq(learningCourseBlueprintRevisions.ownerId, ownerId),
    eq(learningCourseBlueprintRevisions.courseId, scope.courseId),
    eq(learningCourseBlueprintRevisions.revision, scope.blueprintRevision),
  )).limit(1);
  const blueprint = learningCourseBlueprintSchema.parse(revisions[0]?.snapshot);
  const blueprintModule = blueprint.modules.find((candidate) => candidate.moduleId === scope.moduleId);
  const lesson = blueprintModule?.lessons.find((candidate) => candidate.lessonId === input.lesson.lessonId);
  if (!blueprintModule || !lesson) {
    throw new LearningError(
      "learning_lesson_not_in_blueprint",
      "The Lesson and Module must exist in the exact enrolled Blueprint revision.",
    );
  }
  return { blueprintRevision: scope.blueprintRevision };
}

export async function saveLearningLessonRevision(
  ownerId: string,
  inputValue: unknown,
  nowMs = Date.now(),
) {
  const input = saveLearningLessonRevisionSchema.parse(inputValue) as SaveLearningLessonRevisionInput;
  const db = getDb();
  const requestFingerprint = await fingerprint(input);
  const replay = await replayLearningOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;
  const { blueprintRevision } = await validateCourseLessonScope(ownerId, input);

  const lessonRows = await db.select().from(learningLessons).where(and(
    eq(learningLessons.ownerId, ownerId),
    eq(learningLessons.lessonId, input.lesson.lessonId),
  )).limit(1);
  const current = lessonRows[0];
  if (!current && input.expectedRevision !== 0) {
    throw new LearningError("learning_lesson_not_found", "That owner-private Lesson is unavailable.");
  }
  if (current && current.currentRevision !== input.expectedRevision) {
    throw new LearningError("learning_lesson_revision_conflict", "The Lesson changed; reread it before retrying.");
  }
  if (current) {
    const sameScope = current.scopeType === input.scope.kind
      && current.courseId === (input.scope.kind === "course" ? input.scope.courseId : null)
      && current.enrollmentId === (input.scope.kind === "course" ? input.scope.enrollmentId : null)
      && current.moduleId === (input.scope.kind === "course" ? input.scope.moduleId : null);
    if (!sameScope) {
      throw new LearningError(
        "learning_lesson_scope_immutable",
        "A Lesson keeps its original Course or Quick Study scope across revisions.",
      );
    }
  }

  const revision = input.expectedRevision + 1;
  const action = current ? "revise_lesson" as const : "create_lesson" as const;
  const receipt = {
    status: current ? "lesson_revised" as const : "lesson_created" as const,
    lessonId: input.lesson.lessonId,
    lessonRevision: revision,
    scope: input.scope,
    blueprintRevision,
  };
  const currentCondition = current
    ? sql`EXISTS (
        SELECT 1 FROM ${learningLessons}
        WHERE ${learningLessons.ownerId} = ${ownerId}
          AND ${learningLessons.lessonId} = ${input.lesson.lessonId}
          AND ${learningLessons.currentRevision} = ${input.expectedRevision}
      )`
    : sql`NOT EXISTS (
        SELECT 1 FROM ${learningLessons}
        WHERE ${learningLessons.ownerId} = ${ownerId}
          AND ${learningLessons.lessonId} = ${input.lesson.lessonId}
      )`;
  const statements = [
    d1TransactionalInvariantGuard(db, currentCondition),
    db.insert(learningLessonRevisions).values({
      ownerId,
      lessonId: input.lesson.lessonId,
      revision,
      operationId: input.operationId,
      requestFingerprint,
      blueprintRevision,
      snapshot: input.lesson,
      createdAt: nowMs,
    }),
    ...(current ? [db.update(learningLessons).set({
      currentRevision: revision,
      state: input.lesson.state,
      title: input.lesson.title,
      updatedAt: nowMs,
    }).where(and(
      eq(learningLessons.ownerId, ownerId),
      eq(learningLessons.lessonId, input.lesson.lessonId),
      eq(learningLessons.currentRevision, input.expectedRevision),
    ))] : [db.insert(learningLessons).values({
      ownerId,
      lessonId: input.lesson.lessonId,
      scopeType: input.scope.kind,
      courseId: input.scope.kind === "course" ? input.scope.courseId : null,
      enrollmentId: input.scope.kind === "course" ? input.scope.enrollmentId : null,
      moduleId: input.scope.kind === "course" ? input.scope.moduleId : null,
      currentRevision: revision,
      state: input.lesson.state,
      title: input.lesson.title,
      createdAt: nowMs,
      updatedAt: nowMs,
    })]),
    ...(!current ? input.lesson.homework.map((homework) => db.insert(learningHomework).values({
      ownerId,
      lessonId: input.lesson.lessonId,
      homeworkId: homework.homeworkId,
      lessonRevision: revision,
      prompt: homework.prompt,
      state: "open",
      revision: 1,
      completedAt: null,
      updatedAt: nowMs,
    })) : []),
    ...(!current ? input.lesson.homework.map((homework) => db.insert(learningHomeworkStateEvents).values({
      ownerId,
      lessonId: input.lesson.lessonId,
      homeworkId: homework.homeworkId,
      revision: 1,
      operationId: input.operationId,
      state: "open",
      completedAt: null,
      createdAt: nowMs,
    })) : []),
    db.insert(learningOperations).values({
      ownerId,
      operationId: input.operationId,
      aggregateType: "lesson",
      aggregateId: input.lesson.lessonId,
      action,
      requestFingerprint,
      receipt,
      createdAt: nowMs,
    }),
  ];
  try {
    await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
  } catch (error) {
    const racedReplay = await replayLearningOperation(ownerId, input.operationId, requestFingerprint);
    if (racedReplay) return racedReplay;
    const raced = await db.select({ revision: learningLessons.currentRevision }).from(learningLessons).where(and(
      eq(learningLessons.ownerId, ownerId),
      eq(learningLessons.lessonId, input.lesson.lessonId),
    )).limit(1);
    if (raced[0]?.revision !== input.expectedRevision) {
      throw new LearningError("learning_lesson_revision_conflict", "The Lesson changed; reread it before retrying.");
    }
    throw error;
  }
  return { ...receipt, duplicate: false };
}

async function validateSessionScope(ownerId: string, input: CreateLearningSessionInput) {
  const db = getDb();
  const lessonRows = await db.select().from(learningLessons).where(and(
    eq(learningLessons.ownerId, ownerId),
    eq(learningLessons.lessonId, input.lessonId),
  )).limit(1);
  const lesson = lessonRows[0];
  if (!lesson) throw new LearningError("learning_lesson_not_found", "That owner-private Lesson is unavailable.");
  if (lesson.currentRevision !== input.lessonRevision) {
    throw new LearningError("learning_lesson_revision_conflict", "The Current lesson changed; reread it before opening a Session.");
  }
  const sameScope = lesson.scopeType === input.scope.kind
    && lesson.courseId === (input.scope.kind === "course" ? input.scope.courseId : null)
    && lesson.enrollmentId === (input.scope.kind === "course" ? input.scope.enrollmentId : null)
    && lesson.moduleId === (input.scope.kind === "course" ? input.scope.moduleId : null);
  if (!sameScope) {
    throw new LearningError("learning_session_scope_mismatch", "The Learning Session must use the Lesson's immutable scope.");
  }
  if (input.scope.kind === "course") {
    const enrollments = await db.select().from(learningEnrollments).where(and(
      eq(learningEnrollments.ownerId, ownerId),
      eq(learningEnrollments.enrollmentId, input.scope.enrollmentId),
    )).limit(1);
    const enrollment = enrollments[0];
    if (!enrollment || enrollment.courseId !== input.scope.courseId || enrollment.state !== "active") {
      throw new LearningError("learning_enrollment_not_found", "That active owner-private Enrollment is unavailable.");
    }
    if (enrollment.blueprintRevision !== input.scope.blueprintRevision) {
      throw new LearningError(
        "learning_enrollment_blueprint_mismatch",
        "The Learning Session must use the exact Blueprint revision pinned by Enrollment.",
      );
    }
  }
  return lesson;
}

export async function createLearningSession(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  const input = createLearningSessionSchema.parse(inputValue) as CreateLearningSessionInput;
  const db = getDb();
  const requestFingerprint = await fingerprint(input);
  const replay = await replayLearningOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;
  await validateSessionScope(ownerId, input);

  const receipt = {
    status: "session_planned" as const,
    sessionId: input.sessionId,
    lessonId: input.lessonId,
    lessonRevision: input.lessonRevision,
    blueprintRevision: input.scope.kind === "course" ? input.scope.blueprintRevision : null,
    revision: 0,
    transcriptRevision: 0,
    finalizationRevision: 0,
  };
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, sql`NOT EXISTS (
        SELECT 1 FROM ${learningSessions}
        WHERE ${learningSessions.ownerId} = ${ownerId}
          AND ${learningSessions.sessionId} = ${input.sessionId}
      )`),
      db.insert(learningSessions).values({
        ownerId,
        sessionId: input.sessionId,
        scopeType: input.scope.kind,
        courseId: input.scope.kind === "course" ? input.scope.courseId : null,
        enrollmentId: input.scope.kind === "course" ? input.scope.enrollmentId : null,
        lessonId: input.lessonId,
        blueprintRevision: input.scope.kind === "course" ? input.scope.blueprintRevision : null,
        lessonRevision: input.lessonRevision,
        state: "planned",
        accumulatedSeconds: 0,
        startedAt: null,
        runningSince: null,
        completedAt: null,
        revision: 0,
        transcriptRevision: 0,
        finalizationRevision: 0,
        createdAt: nowMs,
        updatedAt: nowMs,
      }),
      db.insert(learningOperations).values({
        ownerId,
        operationId: input.operationId,
        aggregateType: "session",
        aggregateId: input.sessionId,
        action: "create_session",
        requestFingerprint,
        receipt,
        createdAt: nowMs,
      }),
    ]);
  } catch (error) {
    const racedReplay = await replayLearningOperation(ownerId, input.operationId, requestFingerprint);
    if (racedReplay) return racedReplay;
    const existing = await db.select({ sessionId: learningSessions.sessionId }).from(learningSessions).where(and(
      eq(learningSessions.ownerId, ownerId),
      eq(learningSessions.sessionId, input.sessionId),
    )).limit(1);
    if (existing[0]) throw new LearningError("learning_session_exists", "That Learning Session already exists.");
    throw error;
  }
  return { ...receipt, duplicate: false };
}

function elapsedSeconds(session: typeof learningSessions.$inferSelect, nowMs: number) {
  if (session.state !== "running" || session.runningSince === null) return session.accumulatedSeconds;
  return session.accumulatedSeconds + Math.max(0, Math.floor((nowMs - session.runningSince) / 1_000));
}

export async function controlLearningSession(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  const input = controlLearningSessionSchema.parse(inputValue) as ControlLearningSessionInput;
  const db = getDb();
  const requestFingerprint = await fingerprint(input);
  const replay = await replayLearningOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;
  const rows = await db.select().from(learningSessions).where(and(
    eq(learningSessions.ownerId, ownerId),
    eq(learningSessions.sessionId, input.sessionId),
  )).limit(1);
  const current = rows[0];
  if (!current) throw new LearningError("learning_session_not_found", "That owner-private Learning Session is unavailable.");
  if (current.revision !== input.expectedRevision) {
    throw new LearningError("learning_session_revision_conflict", "The Learning Session changed; reread it before retrying.");
  }
  if (current.state === "completed") {
    throw new LearningError("learning_session_completed", "A completed Learning Session is permanently locked.");
  }
  const valid = (input.action === "start" && current.state === "planned")
    || (input.action === "pause" && current.state === "running")
    || (input.action === "resume" && current.state === "paused");
  if (!valid) {
    throw new LearningError(
      "learning_session_transition_invalid",
      `Cannot ${input.action} a ${current.state} Learning Session.`,
    );
  }

  const revision = current.revision + 1;
  const accumulatedSeconds = elapsedSeconds(current, nowMs);
  const nextState = input.action === "pause" ? "paused" as const : "running" as const;
  const nextRunningSince = nextState === "running" ? nowMs : null;
  const nextStartedAt = current.startedAt ?? nowMs;
  const completedAt = null;
  const receipt = {
    status: "session_controlled" as const,
    sessionId: input.sessionId,
    action: input.action,
    state: nextState,
    revision,
    accumulatedSeconds,
    startedAt: nextStartedAt,
    completedAt,
  };
  const intervalStatement = (input.action === "start" || input.action === "resume")
    ? db.insert(learningSessionIntervals).values({ ownerId, sessionId: input.sessionId, startedAt: nowMs, endedAt: null })
    : current.runningSince !== null
      ? db.update(learningSessionIntervals).set({ endedAt: nowMs }).where(and(
        eq(learningSessionIntervals.ownerId, ownerId),
        eq(learningSessionIntervals.sessionId, input.sessionId),
        eq(learningSessionIntervals.startedAt, current.runningSince),
      ))
      : null;
  const statements = [
    d1TransactionalInvariantGuard(db, sql`EXISTS (
      SELECT 1 FROM ${learningSessions}
      WHERE ${learningSessions.ownerId} = ${ownerId}
        AND ${learningSessions.sessionId} = ${input.sessionId}
        AND ${learningSessions.revision} = ${input.expectedRevision}
        AND ${learningSessions.state} != 'completed'
    )`),
    db.update(learningSessions).set({
      state: nextState,
      accumulatedSeconds,
      startedAt: nextStartedAt,
      runningSince: nextRunningSince,
      completedAt,
      revision,
      updatedAt: nowMs,
    }).where(and(
      eq(learningSessions.ownerId, ownerId),
      eq(learningSessions.sessionId, input.sessionId),
      eq(learningSessions.revision, input.expectedRevision),
    )),
    ...(intervalStatement ? [intervalStatement] : []),
    db.insert(learningOperations).values({
      ownerId,
      operationId: input.operationId,
      aggregateType: "session",
      aggregateId: input.sessionId,
      action: "control_session",
      requestFingerprint,
      receipt,
      createdAt: nowMs,
    }),
  ];
  try {
    await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
  } catch {
    const racedReplay = await replayLearningOperation(ownerId, input.operationId, requestFingerprint);
    if (racedReplay) return racedReplay;
    throw new LearningError("learning_session_revision_conflict", "The Learning Session changed; reread it before retrying.");
  }
  return { ...receipt, duplicate: false };
}

export async function appendLearningTranscript(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  const input = appendLearningTranscriptSchema.parse(inputValue) as AppendLearningTranscriptInput;
  const db = getDb();
  const requestFingerprint = await fingerprint(input);
  const replay = await replayLearningOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;
  const rows = await db.select().from(learningSessions).where(and(
    eq(learningSessions.ownerId, ownerId),
    eq(learningSessions.sessionId, input.sessionId),
  )).limit(1);
  const session = rows[0];
  if (!session) throw new LearningError("learning_session_not_found", "That owner-private Learning Session is unavailable.");
  if (session.state === "completed") {
    throw new LearningError("learning_session_completed", "A completed Learning Session transcript is immutable.");
  }
  if (session.transcriptRevision !== input.expectedTranscriptRevision) {
    throw new LearningError("learning_transcript_revision_conflict", "The transcript changed; reread it before retrying.");
  }
  const lastRows = await db.select({ sequence: learningTranscriptTurns.sequence }).from(learningTranscriptTurns).where(and(
    eq(learningTranscriptTurns.ownerId, ownerId),
    eq(learningTranscriptTurns.sessionId, input.sessionId),
  )).orderBy(desc(learningTranscriptTurns.sequence)).limit(1);
  const expectedFirstSequence = (lastRows[0]?.sequence ?? -1) + 1;
  const orderedTurns = [...input.turns].sort((left, right) => left.sequence - right.sequence);
  if (orderedTurns[0].sequence !== expectedFirstSequence) {
    throw new LearningError(
      "learning_transcript_sequence_conflict",
      `The next transcript sequence must be ${expectedFirstSequence}.`,
    );
  }
  const transcriptRevision = input.expectedTranscriptRevision + 1;
  const receipt = {
    status: "transcript_appended" as const,
    sessionId: input.sessionId,
    transcriptRevision,
    turnIds: orderedTurns.map((turn) => turn.turnId),
    evidencePolicy: "transcript_only" as const,
  };
  const statements = [
    d1TransactionalInvariantGuard(db, sql`EXISTS (
      SELECT 1 FROM ${learningSessions}
      WHERE ${learningSessions.ownerId} = ${ownerId}
        AND ${learningSessions.sessionId} = ${input.sessionId}
        AND ${learningSessions.transcriptRevision} = ${input.expectedTranscriptRevision}
        AND ${learningSessions.state} != 'completed'
    )`),
    ...orderedTurns.map((turn) => db.insert(learningTranscriptTurns).values({
      ownerId,
      sessionId: input.sessionId,
      turnId: turn.turnId,
      sequence: turn.sequence,
      speaker: turn.speaker,
      source: turn.source,
      body: turn.body,
      occurredAt: turn.occurredAt,
      createdAt: nowMs,
    })),
    db.update(learningSessions).set({ transcriptRevision, updatedAt: nowMs }).where(and(
      eq(learningSessions.ownerId, ownerId),
      eq(learningSessions.sessionId, input.sessionId),
      eq(learningSessions.transcriptRevision, input.expectedTranscriptRevision),
    )),
    db.insert(learningOperations).values({
      ownerId,
      operationId: input.operationId,
      aggregateType: "session",
      aggregateId: input.sessionId,
      action: "append_transcript",
      requestFingerprint,
      receipt,
      createdAt: nowMs,
    }),
  ];
  try {
    await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
  } catch {
    const racedReplay = await replayLearningOperation(ownerId, input.operationId, requestFingerprint);
    if (racedReplay) return racedReplay;
    throw new LearningError("learning_transcript_revision_conflict", "The transcript changed; reread it before retrying.");
  }
  return { ...receipt, duplicate: false };
}

export async function attachLearningArtifact(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  const input = attachLearningArtifactSchema.parse(inputValue) as AttachLearningArtifactInput;
  const db = getDb();
  const requestFingerprint = await fingerprint(input);
  const replay = await replayLearningOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;
  const lessons = await db.select().from(learningLessons).where(and(
    eq(learningLessons.ownerId, ownerId),
    eq(learningLessons.lessonId, input.lessonId),
  )).limit(1);
  if (!lessons[0]) throw new LearningError("learning_lesson_not_found", "That owner-private Lesson is unavailable.");
  if (input.sessionId) {
    const sessions = await db.select().from(learningSessions).where(and(
      eq(learningSessions.ownerId, ownerId),
      eq(learningSessions.sessionId, input.sessionId),
      eq(learningSessions.lessonId, input.lessonId),
    )).limit(1);
    if (!sessions[0]) throw new LearningError("learning_session_not_found", "That owner-private Learning Session is unavailable.");
  }
  if (input.homeworkId) {
    const homework = await db.select().from(learningHomework).where(and(
      eq(learningHomework.ownerId, ownerId),
      eq(learningHomework.lessonId, input.lessonId),
      eq(learningHomework.homeworkId, input.homeworkId),
    )).limit(1);
    if (!homework[0]) throw new LearningError("learning_homework_not_found", "That owner-private homework item is unavailable.");
  }
  const receipt = {
    status: "artifact_attached" as const,
    artifactId: input.artifactId,
    lessonId: input.lessonId,
    sessionId: input.sessionId ?? null,
    homeworkId: input.homeworkId ?? null,
    kind: input.kind,
    label: input.label,
    mediaType: input.mediaType,
    sizeBytes: input.sizeBytes,
    contentHash: input.contentHash,
  };
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, sql`NOT EXISTS (
        SELECT 1 FROM ${learningArtifacts}
        WHERE ${learningArtifacts.ownerId} = ${ownerId}
          AND ${learningArtifacts.artifactId} = ${input.artifactId}
      )`),
      db.insert(learningArtifacts).values({
        ownerId,
        artifactId: input.artifactId,
        lessonId: input.lessonId,
        sessionId: input.sessionId ?? null,
        homeworkId: input.homeworkId ?? null,
        kind: input.kind,
        label: input.label,
        mediaType: input.mediaType,
        sizeBytes: input.sizeBytes,
        contentHash: input.contentHash.toLowerCase(),
        privateLocator: input.privateLocator,
        createdAt: nowMs,
      }),
      db.insert(learningOperations).values({
        ownerId,
        operationId: input.operationId,
        aggregateType: "lesson",
        aggregateId: input.lessonId,
        action: "attach_artifact",
        requestFingerprint,
        receipt,
        createdAt: nowMs,
      }),
    ]);
  } catch (error) {
    const racedReplay = await replayLearningOperation(ownerId, input.operationId, requestFingerprint);
    if (racedReplay) return racedReplay;
    const existing = await db.select({ artifactId: learningArtifacts.artifactId }).from(learningArtifacts).where(and(
      eq(learningArtifacts.ownerId, ownerId),
      eq(learningArtifacts.artifactId, input.artifactId),
    )).limit(1);
    if (existing[0]) throw new LearningError("learning_artifact_exists", "That Learning artifact already exists.");
    throw error;
  }
  return { ...receipt, duplicate: false };
}

export async function setLearningHomeworkState(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  const input = setLearningHomeworkStateSchema.parse(inputValue) as SetLearningHomeworkStateInput;
  const db = getDb();
  const requestFingerprint = await fingerprint(input);
  const replay = await replayLearningOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;
  const rows = await db.select().from(learningHomework).where(and(
    eq(learningHomework.ownerId, ownerId),
    eq(learningHomework.lessonId, input.lessonId),
    eq(learningHomework.homeworkId, input.homeworkId),
  )).limit(1);
  const current = rows[0];
  if (!current) throw new LearningError("learning_homework_not_found", "That owner-private homework item is unavailable.");
  if (current.revision !== input.expectedRevision) {
    throw new LearningError("learning_homework_revision_conflict", "The homework state changed; reread it before retrying.");
  }
  const revision = current.revision + 1;
  const receipt = {
    status: "homework_updated" as const,
    lessonId: input.lessonId,
    homeworkId: input.homeworkId,
    state: input.state,
    revision,
    completedAt: input.state === "completed" ? nowMs : null,
  };
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${learningHomework}
        WHERE ${learningHomework.ownerId} = ${ownerId}
          AND ${learningHomework.lessonId} = ${input.lessonId}
          AND ${learningHomework.homeworkId} = ${input.homeworkId}
          AND ${learningHomework.revision} = ${input.expectedRevision}
      )`),
      db.update(learningHomework).set({
        state: input.state,
        revision,
        completedAt: input.state === "completed" ? nowMs : null,
        updatedAt: nowMs,
      }).where(and(
        eq(learningHomework.ownerId, ownerId),
        eq(learningHomework.lessonId, input.lessonId),
        eq(learningHomework.homeworkId, input.homeworkId),
        eq(learningHomework.revision, input.expectedRevision),
      )),
      db.insert(learningHomeworkStateEvents).values({
        ownerId,
        lessonId: input.lessonId,
        homeworkId: input.homeworkId,
        revision,
        operationId: input.operationId,
        state: input.state,
        completedAt: input.state === "completed" ? nowMs : null,
        createdAt: nowMs,
      }),
      db.insert(learningOperations).values({
        ownerId,
        operationId: input.operationId,
        aggregateType: "lesson",
        aggregateId: input.lessonId,
        action: "set_homework",
        requestFingerprint,
        receipt,
        createdAt: nowMs,
      }),
    ]);
  } catch {
    const racedReplay = await replayLearningOperation(ownerId, input.operationId, requestFingerprint);
    if (racedReplay) return racedReplay;
    throw new LearningError("learning_homework_revision_conflict", "The homework state changed; reread it before retrying.");
  }
  return { ...receipt, duplicate: false };
}

async function validateLearningEvidence(
  ownerId: string,
  session: typeof learningSessions.$inferSelect,
  input: FinishLearningSessionInput,
  lesson: LearningLessonSnapshot,
) {
  const checkpointIds = new Set(lesson.checkpoints.map((checkpoint) => checkpoint.checkpointId));
  for (const result of input.finalization.checkpointResults) {
    if (!checkpointIds.has(result.checkpointId)) {
      throw new LearningError(
        "learning_checkpoint_not_found",
        "Every checkpoint result must belong to the exact Lesson revision used by the Session.",
      );
    }
    for (const evidence of result.evidence) {
      if (evidence.kind === "transcript_turn") {
        const rows = await getDb().select({ turnId: learningTranscriptTurns.turnId }).from(learningTranscriptTurns).where(and(
          eq(learningTranscriptTurns.ownerId, ownerId),
          eq(learningTranscriptTurns.sessionId, session.sessionId),
          eq(learningTranscriptTurns.turnId, evidence.turnId),
        )).limit(1);
        if (!rows[0]) throw new LearningError("learning_evidence_not_found", "Transcript evidence must name an exact Session turn.");
      } else if (evidence.kind === "artifact") {
        const rows = await getDb().select({ artifactId: learningArtifacts.artifactId }).from(learningArtifacts).where(and(
          eq(learningArtifacts.ownerId, ownerId),
          eq(learningArtifacts.lessonId, session.lessonId),
          eq(learningArtifacts.artifactId, evidence.artifactId),
        )).limit(1);
        if (!rows[0]) throw new LearningError("learning_evidence_not_found", "Artifact evidence must name an exact owner-private Lesson artifact.");
      } else {
        const rows = await getDb().select({ homeworkId: learningHomeworkStateEvents.homeworkId })
          .from(learningHomeworkStateEvents).where(and(
          eq(learningHomeworkStateEvents.ownerId, ownerId),
          eq(learningHomeworkStateEvents.lessonId, session.lessonId),
          eq(learningHomeworkStateEvents.homeworkId, evidence.homeworkId),
          eq(learningHomeworkStateEvents.revision, evidence.revision),
        )).limit(1);
        if (!rows[0]) {
          throw new LearningError(
            "learning_evidence_not_found",
            "Homework evidence must name an exact immutable assignment state revision.",
          );
        }
      }
    }
  }
}

async function deriveLearningCompletion(
  ownerId: string,
  session: typeof learningSessions.$inferSelect,
  lesson: LearningLessonSnapshot,
  input: FinishLearningSessionInput,
) {
  const db = getDb();
  const pointerRows = await db.select().from(learningLessons).where(and(
    eq(learningLessons.ownerId, ownerId),
    eq(learningLessons.lessonId, session.lessonId),
  )).limit(1);
  const pointer = pointerRows[0];
  if (!pointer || pointer.state === "completed" || pointer.currentRevision !== session.lessonRevision) return null;
  const checkpointRows = await db.select().from(learningCheckpointStates).where(and(
    eq(learningCheckpointStates.ownerId, ownerId),
    eq(learningCheckpointStates.lessonId, session.lessonId),
  ));
  const statusById = new Map(checkpointRows.map((state) => [state.checkpointId, state.status]));
  input.finalization.checkpointResults.forEach((result) => statusById.set(result.checkpointId, result.status));
  const requiredIds = lesson.checkpoints.filter((checkpoint) => checkpoint.required)
    .map((checkpoint) => checkpoint.checkpointId);
  if (!requiredIds.every((checkpointId) => statusById.get(checkpointId) === "demonstrated")) return null;
  const writtenCheckpointIds = new Set(input.finalization.checkpointResults.map((result) => result.checkpointId));
  const checkpointGuards = requiredIds.filter((checkpointId) => !writtenCheckpointIds.has(checkpointId)).map(
    (checkpointId) => {
      const state = checkpointRows.find((candidate) => candidate.checkpointId === checkpointId);
      if (!state) throw new LearningError("learning_checkpoint_revision_conflict", "Required checkpoint state changed before Lesson completion.");
      return d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${learningCheckpointStates}
        WHERE ${learningCheckpointStates.ownerId} = ${ownerId}
          AND ${learningCheckpointStates.lessonId} = ${session.lessonId}
          AND ${learningCheckpointStates.checkpointId} = ${checkpointId}
          AND ${learningCheckpointStates.currentRevision} = ${state.currentRevision}
          AND ${learningCheckpointStates.status} = 'demonstrated'
      )`);
    },
  );
  if (session.scopeType === "quick_study") {
    return {
      checkpointGuards,
      pointer,
      enrollment: null,
      courseLessonGuards: [],
      nextLesson: null,
      courseCompleted: false,
    };
  }
  if (!session.courseId || !session.enrollmentId || !session.blueprintRevision) {
    throw new LearningError("learning_session_scope_mismatch", "The Course Session is missing its exact Enrollment scope.");
  }
  const [enrollmentRows, blueprintRows, courseLessonRows] = await Promise.all([
    db.select().from(learningEnrollments).where(and(
      eq(learningEnrollments.ownerId, ownerId),
      eq(learningEnrollments.enrollmentId, session.enrollmentId),
      eq(learningEnrollments.courseId, session.courseId),
    )).limit(1),
    db.select().from(learningCourseBlueprintRevisions).where(and(
      eq(learningCourseBlueprintRevisions.ownerId, ownerId),
      eq(learningCourseBlueprintRevisions.courseId, session.courseId),
      eq(learningCourseBlueprintRevisions.revision, session.blueprintRevision),
    )).limit(1),
    db.select().from(learningLessons).where(and(
      eq(learningLessons.ownerId, ownerId),
      eq(learningLessons.courseId, session.courseId),
      eq(learningLessons.enrollmentId, session.enrollmentId),
    )),
  ]);
  const enrollment = enrollmentRows[0];
  if (!enrollment || enrollment.state !== "active" || enrollment.blueprintRevision !== session.blueprintRevision) {
    throw new LearningError("learning_enrollment_not_found", "The exact active Enrollment is unavailable for Lesson completion.");
  }
  const blueprint = orderedBlueprint(learningCourseBlueprintSchema.parse(blueprintRows[0]?.snapshot));
  const orderedLessons = blueprint.modules.flatMap((module) => module.lessons.map((candidate) => ({
    lessonId: candidate.lessonId,
    moduleId: module.moduleId,
  })));
  if (!orderedLessons.some((candidate) => candidate.lessonId === session.lessonId)) {
    throw new LearningError("learning_lesson_not_in_blueprint", "The Session Lesson is absent from its pinned Blueprint revision.");
  }
  const rowByLessonId = new Map(courseLessonRows.map((candidate) => [candidate.lessonId, candidate]));
  const incomplete = orderedLessons.filter((candidate) => candidate.lessonId !== session.lessonId)
    .find((candidate) => rowByLessonId.get(candidate.lessonId)?.state !== "completed");
  const courseCompleted = !incomplete;
  const courseLessonGuards = orderedLessons.filter((candidate) => candidate.lessonId !== session.lessonId).map(
    (candidate) => {
      const row = rowByLessonId.get(candidate.lessonId);
      return row
        ? d1TransactionalInvariantGuard(db, sql`EXISTS (
            SELECT 1 FROM ${learningLessons}
            WHERE ${learningLessons.ownerId} = ${ownerId}
              AND ${learningLessons.lessonId} = ${candidate.lessonId}
              AND ${learningLessons.currentRevision} = ${row.currentRevision}
              AND ${learningLessons.state} = ${row.state}
          )`)
        : d1TransactionalInvariantGuard(db, sql`NOT EXISTS (
            SELECT 1 FROM ${learningLessons}
            WHERE ${learningLessons.ownerId} = ${ownerId}
              AND ${learningLessons.lessonId} = ${candidate.lessonId}
          )`);
    },
  );
  return {
    checkpointGuards,
    pointer,
    enrollment,
    courseLessonGuards,
    nextLesson: incomplete ?? null,
    courseCompleted,
  };
}

export async function finishLearningSession(ownerId: string, inputValue: unknown, nowMs = Date.now()) {
  const input = finishLearningSessionSchema.parse(inputValue) as FinishLearningSessionInput;
  const db = getDb();
  const requestFingerprint = await fingerprint(input);
  const replay = await replayLearningOperation(ownerId, input.operationId, requestFingerprint);
  if (replay) return replay;
  const sessionRows = await db.select().from(learningSessions).where(and(
    eq(learningSessions.ownerId, ownerId),
    eq(learningSessions.sessionId, input.sessionId),
  )).limit(1);
  const session = sessionRows[0];
  if (!session) throw new LearningError("learning_session_not_found", "That owner-private Learning Session is unavailable.");
  if (session.state === "completed") throw new LearningError("learning_session_completed", "A completed Learning Session is permanently locked.");
  if (session.state !== "running" && session.state !== "paused") {
    throw new LearningError("learning_session_transition_invalid", "Start the Learning Session before finishing it.");
  }
  if (session.revision !== input.expectedRevision) {
    throw new LearningError("learning_session_revision_conflict", "The Learning Session changed; reread it before retrying.");
  }
  if (session.transcriptRevision !== input.expectedTranscriptRevision) {
    throw new LearningError("learning_transcript_revision_conflict", "The transcript changed; reread it before finishing.");
  }
  const lessonRows = await db.select().from(learningLessonRevisions).where(and(
    eq(learningLessonRevisions.ownerId, ownerId),
    eq(learningLessonRevisions.lessonId, session.lessonId),
    eq(learningLessonRevisions.revision, session.lessonRevision),
  )).limit(1);
  const lesson = learningLessonSnapshotSchema.parse(lessonRows[0]?.snapshot);
  await validateLearningEvidence(ownerId, session, input, lesson);
  const completion = await deriveLearningCompletion(ownerId, session, lesson, input);

  const currentStates = await Promise.all(input.finalization.checkpointResults.map(async (result) => {
    const rows = await db.select().from(learningCheckpointStates).where(and(
      eq(learningCheckpointStates.ownerId, ownerId),
      eq(learningCheckpointStates.lessonId, session.lessonId),
      eq(learningCheckpointStates.checkpointId, result.checkpointId),
    )).limit(1);
    const current = rows[0] ?? null;
    if (current && result.supersedesRevision !== current.currentRevision) {
      throw new LearningError(
        "learning_checkpoint_revision_conflict",
        "A checkpoint correction must name the exact current revision it supersedes.",
      );
    }
    if (!current && result.supersedesRevision !== undefined) {
      throw new LearningError("learning_checkpoint_revision_conflict", "The checkpoint has no prior result to supersede.");
    }
    return { result, current, revision: (current?.currentRevision ?? 0) + 1 };
  }));

  const accumulatedSeconds = elapsedSeconds(session, nowMs);
  const revision = session.revision + 1;
  const finalizationRevision = session.finalizationRevision + 1;
  const finalizationSnapshot = {
    schemaVersion: 1 as const,
    ...input.finalization,
    lessonId: session.lessonId,
    lessonRevision: session.lessonRevision,
    blueprintRevision: session.blueprintRevision,
    completedAt: nowMs,
  };
  const receipt = {
    status: "session_finished" as const,
    sessionId: session.sessionId,
    state: "completed" as const,
    revision,
    transcriptRevision: session.transcriptRevision,
    finalizationRevision,
    accumulatedSeconds,
    completedAt: nowMs,
    checkpointResults: currentStates.map(({ result, revision: checkpointRevision }) => ({
      checkpointId: result.checkpointId,
      status: result.status,
      revision: checkpointRevision,
    })),
    lessonCompletion: completion ? {
      completed: true as const,
      lessonId: session.lessonId,
      lessonRevision: completion.pointer.currentRevision + 1,
      nextLessonId: completion.nextLesson?.lessonId ?? null,
      courseCompleted: completion.courseCompleted,
    } : {
      completed: false as const,
      lessonId: session.lessonId,
      lessonRevision: session.lessonRevision,
      nextLessonId: null,
      courseCompleted: false,
    },
  };
  const closeInterval = session.runningSince !== null
    ? db.update(learningSessionIntervals).set({ endedAt: nowMs }).where(and(
      eq(learningSessionIntervals.ownerId, ownerId),
      eq(learningSessionIntervals.sessionId, session.sessionId),
      eq(learningSessionIntervals.startedAt, session.runningSince),
    ))
    : null;
  const checkpointStatements = currentStates.flatMap(({ result, current, revision: checkpointRevision }) => [
    d1TransactionalInvariantGuard(db, current
      ? sql`EXISTS (
          SELECT 1 FROM ${learningCheckpointStates}
          WHERE ${learningCheckpointStates.ownerId} = ${ownerId}
            AND ${learningCheckpointStates.lessonId} = ${session.lessonId}
            AND ${learningCheckpointStates.checkpointId} = ${result.checkpointId}
            AND ${learningCheckpointStates.currentRevision} = ${current.currentRevision}
        )`
      : sql`NOT EXISTS (
          SELECT 1 FROM ${learningCheckpointStates}
          WHERE ${learningCheckpointStates.ownerId} = ${ownerId}
            AND ${learningCheckpointStates.lessonId} = ${session.lessonId}
            AND ${learningCheckpointStates.checkpointId} = ${result.checkpointId}
        )`),
    db.insert(learningCheckpointResultEvents).values({
      ownerId,
      lessonId: session.lessonId,
      checkpointId: result.checkpointId,
      revision: checkpointRevision,
      sessionId: session.sessionId,
      operationId: input.operationId,
      status: result.status,
      rationale: result.rationale,
      evidence: result.evidence,
      supersedesRevision: result.supersedesRevision ?? null,
      createdAt: nowMs,
    }),
    current
      ? db.update(learningCheckpointStates).set({
        currentRevision: checkpointRevision,
        status: result.status,
        updatedAt: nowMs,
      }).where(and(
        eq(learningCheckpointStates.ownerId, ownerId),
        eq(learningCheckpointStates.lessonId, session.lessonId),
        eq(learningCheckpointStates.checkpointId, result.checkpointId),
        eq(learningCheckpointStates.currentRevision, current.currentRevision),
      ))
      : db.insert(learningCheckpointStates).values({
        ownerId,
        lessonId: session.lessonId,
        checkpointId: result.checkpointId,
        currentRevision: checkpointRevision,
        status: result.status,
        updatedAt: nowMs,
      }),
  ]);
  const statements = [
    d1TransactionalInvariantGuard(db, sql`EXISTS (
      SELECT 1 FROM ${learningSessions}
      WHERE ${learningSessions.ownerId} = ${ownerId}
        AND ${learningSessions.sessionId} = ${session.sessionId}
        AND ${learningSessions.revision} = ${input.expectedRevision}
        AND ${learningSessions.transcriptRevision} = ${input.expectedTranscriptRevision}
        AND ${learningSessions.state} != 'completed'
    )`),
    ...(completion ? [
      d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${learningLessons}
        WHERE ${learningLessons.ownerId} = ${ownerId}
          AND ${learningLessons.lessonId} = ${session.lessonId}
          AND ${learningLessons.currentRevision} = ${session.lessonRevision}
          AND ${learningLessons.state} != 'completed'
      )`),
      ...completion.checkpointGuards,
      ...completion.courseLessonGuards,
      ...(completion.enrollment ? [d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${learningEnrollments}
        WHERE ${learningEnrollments.ownerId} = ${ownerId}
          AND ${learningEnrollments.enrollmentId} = ${completion.enrollment.enrollmentId}
          AND ${learningEnrollments.revision} = ${completion.enrollment.revision}
          AND ${learningEnrollments.state} = 'active'
      )`)] : []),
    ] : []),
    db.insert(learningSessionFinalizationRevisions).values({
      ownerId,
      sessionId: session.sessionId,
      revision: finalizationRevision,
      operationId: input.operationId,
      requestFingerprint,
      snapshot: finalizationSnapshot,
      createdAt: nowMs,
    }),
    ...checkpointStatements,
    ...(completion ? [
      db.insert(learningLessonRevisions).values({
        ownerId,
        lessonId: session.lessonId,
        revision: completion.pointer.currentRevision + 1,
        operationId: input.operationId,
        requestFingerprint,
        blueprintRevision: session.blueprintRevision,
        snapshot: { ...lesson, state: "completed" },
        createdAt: nowMs,
      }),
      db.update(learningLessons).set({
        currentRevision: completion.pointer.currentRevision + 1,
        state: "completed",
        updatedAt: nowMs,
      }).where(and(
        eq(learningLessons.ownerId, ownerId),
        eq(learningLessons.lessonId, session.lessonId),
        eq(learningLessons.currentRevision, completion.pointer.currentRevision),
      )),
      ...(completion.enrollment ? [db.update(learningEnrollments).set({
        state: completion.courseCompleted ? "completed" : "active",
        currentModuleId: completion.nextLesson?.moduleId ?? completion.enrollment.currentModuleId,
        currentLessonId: completion.nextLesson?.lessonId ?? completion.enrollment.currentLessonId,
        revision: completion.enrollment.revision + 1,
        completedAt: completion.courseCompleted ? nowMs : null,
        updatedAt: nowMs,
      }).where(and(
        eq(learningEnrollments.ownerId, ownerId),
        eq(learningEnrollments.enrollmentId, completion.enrollment.enrollmentId),
        eq(learningEnrollments.revision, completion.enrollment.revision),
      ))] : []),
      ...(completion.courseCompleted && session.courseId ? [db.update(learningCourses).set({
        state: "completed",
        updatedAt: nowMs,
      }).where(and(
        eq(learningCourses.ownerId, ownerId),
        eq(learningCourses.courseId, session.courseId),
      ))] : []),
    ] : []),
    ...(closeInterval ? [closeInterval] : []),
    db.update(learningSessions).set({
      state: "completed",
      accumulatedSeconds,
      runningSince: null,
      completedAt: nowMs,
      revision,
      finalizationRevision,
      updatedAt: nowMs,
    }).where(and(
      eq(learningSessions.ownerId, ownerId),
      eq(learningSessions.sessionId, session.sessionId),
      eq(learningSessions.revision, input.expectedRevision),
    )),
    db.insert(learningOperations).values({
      ownerId,
      operationId: input.operationId,
      aggregateType: "session",
      aggregateId: session.sessionId,
      action: "finish_session",
      requestFingerprint,
      receipt,
      createdAt: nowMs,
    }),
  ];
  try {
    await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
  } catch {
    const racedReplay = await replayLearningOperation(ownerId, input.operationId, requestFingerprint);
    if (racedReplay) return racedReplay;
    throw new LearningError("learning_session_revision_conflict", "The Learning Session changed; reread it before retrying.");
  }
  return { ...receipt, duplicate: false };
}

function displayArtifact(row: typeof learningArtifacts.$inferSelect) {
  return {
    ownerId: row.ownerId,
    artifactId: row.artifactId,
    lessonId: row.lessonId,
    sessionId: row.sessionId,
    homeworkId: row.homeworkId,
    kind: row.kind,
    label: row.label,
    mediaType: row.mediaType,
    sizeBytes: row.sizeBytes,
    contentHash: row.contentHash,
    createdAt: row.createdAt,
  };
}

export async function queryLearningEvidence(ownerId: string, inputValue: unknown = {}) {
  const input = queryLearningEvidenceSchema.parse(inputValue);
  const db = getDb();
  const [states, events, homework, homeworkHistory, artifacts, finalizations] = await Promise.all([
    db.select().from(learningCheckpointStates).where(and(
      eq(learningCheckpointStates.ownerId, ownerId),
      input.lessonId ? eq(learningCheckpointStates.lessonId, input.lessonId) : undefined,
    )),
    db.select().from(learningCheckpointResultEvents).where(and(
      eq(learningCheckpointResultEvents.ownerId, ownerId),
      input.lessonId ? eq(learningCheckpointResultEvents.lessonId, input.lessonId) : undefined,
      input.sessionId ? eq(learningCheckpointResultEvents.sessionId, input.sessionId) : undefined,
    )).orderBy(asc(learningCheckpointResultEvents.createdAt)),
    db.select().from(learningHomework).where(and(
      eq(learningHomework.ownerId, ownerId),
      input.lessonId ? eq(learningHomework.lessonId, input.lessonId) : undefined,
    )),
    db.select().from(learningHomeworkStateEvents).where(and(
      eq(learningHomeworkStateEvents.ownerId, ownerId),
      input.lessonId ? eq(learningHomeworkStateEvents.lessonId, input.lessonId) : undefined,
    )).orderBy(asc(learningHomeworkStateEvents.createdAt)),
    db.select().from(learningArtifacts).where(and(
      eq(learningArtifacts.ownerId, ownerId),
      input.lessonId ? eq(learningArtifacts.lessonId, input.lessonId) : undefined,
      input.sessionId ? eq(learningArtifacts.sessionId, input.sessionId) : undefined,
    )).orderBy(asc(learningArtifacts.createdAt)),
    input.sessionId
      ? db.select().from(learningSessionFinalizationRevisions).where(and(
        eq(learningSessionFinalizationRevisions.ownerId, ownerId),
        eq(learningSessionFinalizationRevisions.sessionId, input.sessionId),
      )).orderBy(asc(learningSessionFinalizationRevisions.revision))
      : Promise.resolve([]),
  ]);
  return {
    checkpointStates: states,
    checkpointHistory: events,
    homework,
    homeworkHistory,
    artifacts: artifacts.map(displayArtifact),
    finalizations,
  };
}

export async function queryLearningJourney(ownerId: string, inputValue: unknown = {}) {
  const input = queryLearningJourneySchema.parse(inputValue);
  const db = getDb();
  const [courses, enrollments, lessons, lessonRevisions, sessions, checkpoints, homework] = await Promise.all([
    db.select().from(learningCourses).where(and(
      eq(learningCourses.ownerId, ownerId),
      input.courseId ? eq(learningCourses.courseId, input.courseId) : undefined,
    )),
    db.select().from(learningEnrollments).where(and(
      eq(learningEnrollments.ownerId, ownerId),
      input.courseId ? eq(learningEnrollments.courseId, input.courseId) : undefined,
      eq(learningEnrollments.state, "completed"),
    )),
    db.select().from(learningLessons).where(and(
      eq(learningLessons.ownerId, ownerId),
      input.courseId ? eq(learningLessons.courseId, input.courseId) : undefined,
    )),
    db.select().from(learningLessonRevisions).where(eq(learningLessonRevisions.ownerId, ownerId))
      .orderBy(asc(learningLessonRevisions.revision)),
    db.select().from(learningSessions).where(and(
      eq(learningSessions.ownerId, ownerId),
      input.courseId ? eq(learningSessions.courseId, input.courseId) : undefined,
      eq(learningSessions.state, "completed"),
    )),
    db.select().from(learningCheckpointResultEvents).where(and(
      eq(learningCheckpointResultEvents.ownerId, ownerId),
      eq(learningCheckpointResultEvents.status, "demonstrated"),
    )),
    db.select().from(learningHomeworkStateEvents).where(and(
      eq(learningHomeworkStateEvents.ownerId, ownerId),
      eq(learningHomeworkStateEvents.state, "completed"),
    )),
  ]);
  const courseById = new Map(courses.map((course) => [course.courseId, course]));
  const lessonById = new Map(lessons.map((lesson) => [lesson.lessonId, lesson]));
  const allowedLessonIds = new Set(lessons.map((lesson) => lesson.lessonId));
  const firstLessonCompletion = new Map<string, { revision: number; createdAt: number }>();
  lessonRevisions.forEach((row) => {
    if (!allowedLessonIds.has(row.lessonId)) return;
    const snapshot = learningLessonSnapshotSchema.parse(row.snapshot);
    if (snapshot.state === "completed" && !firstLessonCompletion.has(row.lessonId)) {
      firstLessonCompletion.set(row.lessonId, { revision: row.revision, createdAt: row.createdAt });
    }
  });
  const events = [
    ...enrollments.map((enrollment) => ({
      eventId: `course:${enrollment.courseId}:${enrollment.revision}`,
      kind: "course_completed" as const,
      occurredAt: enrollment.completedAt as number,
      courseId: enrollment.courseId,
      title: courseById.get(enrollment.courseId)?.title ?? enrollment.courseId,
      revision: enrollment.revision,
    })),
    ...[...firstLessonCompletion.entries()].map(([lessonId, completion]) => {
      const lesson = lessonById.get(lessonId);
      return {
        eventId: `lesson:${lessonId}:${completion.revision}`,
        kind: "lesson_completed" as const,
        occurredAt: completion.createdAt,
        courseId: lesson?.courseId ?? null,
        lessonId,
        title: lesson?.title ?? lessonId,
        revision: completion.revision,
      };
    }),
    ...sessions.map((session) => ({
      eventId: `session:${session.sessionId}`,
      kind: "session_finished" as const,
      occurredAt: session.completedAt as number,
      courseId: session.courseId,
      lessonId: session.lessonId,
      sessionId: session.sessionId,
      recordedSeconds: session.accumulatedSeconds,
    })),
    ...checkpoints.filter((event) => allowedLessonIds.has(event.lessonId)).map((event) => ({
      eventId: `checkpoint:${event.lessonId}:${event.checkpointId}:${event.revision}`,
      kind: "checkpoint_demonstrated" as const,
      occurredAt: event.createdAt,
      courseId: lessonById.get(event.lessonId)?.courseId ?? null,
      lessonId: event.lessonId,
      sessionId: event.sessionId,
      checkpointId: event.checkpointId,
      revision: event.revision,
      supersedesRevision: event.supersedesRevision,
    })),
    ...homework.filter((event) => allowedLessonIds.has(event.lessonId)).map((event) => ({
      eventId: `homework:${event.lessonId}:${event.homeworkId}:${event.revision}`,
      kind: "homework_completed" as const,
      occurredAt: event.createdAt,
      courseId: lessonById.get(event.lessonId)?.courseId ?? null,
      lessonId: event.lessonId,
      homeworkId: event.homeworkId,
      revision: event.revision,
    })),
  ].sort((left, right) => right.occurredAt - left.occurredAt || left.eventId.localeCompare(right.eventId));
  return {
    events: events.slice(0, input.limit),
    truncated: events.length > input.limit,
    evidencePolicy: "factual_events_only" as const,
  };
}

const pacificDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function pacificDate(value: number) {
  const parts = Object.fromEntries(pacificDateFormatter.formatToParts(new Date(value))
    .filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function mondayForDate(date: string) {
  const instant = new Date(`${date}T12:00:00Z`);
  const offset = (instant.getUTCDay() + 6) % 7;
  instant.setUTCDate(instant.getUTCDate() - offset);
  return instant.toISOString().slice(0, 10);
}

function aggregateSessionTime(
  sessions: Array<typeof learningSessions.$inferSelect>,
  keyFor: (session: typeof learningSessions.$inferSelect) => string,
) {
  const values = new Map<string, { sessionCount: number; recordedSeconds: number }>();
  sessions.forEach((session) => {
    const key = keyFor(session);
    const current = values.get(key) ?? { sessionCount: 0, recordedSeconds: 0 };
    values.set(key, {
      sessionCount: current.sessionCount + 1,
      recordedSeconds: current.recordedSeconds + session.accumulatedSeconds,
    });
  });
  return [...values.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({ key, ...value }));
}

export async function queryLearningAnalytics(ownerId: string, inputValue: unknown = {}) {
  const input = queryLearningAnalyticsSchema.parse(inputValue);
  const db = getDb();
  const [courses, enrollments, lessons, lessonRevisions, sessions, homework, checkpoints] = await Promise.all([
    db.select().from(learningCourses).where(and(
      eq(learningCourses.ownerId, ownerId),
      input.courseId ? eq(learningCourses.courseId, input.courseId) : undefined,
    )),
    db.select().from(learningEnrollments).where(and(
      eq(learningEnrollments.ownerId, ownerId),
      input.courseId ? eq(learningEnrollments.courseId, input.courseId) : undefined,
    )),
    db.select().from(learningLessons).where(and(
      eq(learningLessons.ownerId, ownerId),
      input.courseId ? eq(learningLessons.courseId, input.courseId) : undefined,
    )),
    db.select().from(learningLessonRevisions).where(eq(learningLessonRevisions.ownerId, ownerId)),
    db.select().from(learningSessions).where(and(
      eq(learningSessions.ownerId, ownerId),
      input.courseId ? eq(learningSessions.courseId, input.courseId) : undefined,
    )),
    db.select().from(learningHomework).where(eq(learningHomework.ownerId, ownerId)),
    db.select().from(learningCheckpointStates).where(eq(learningCheckpointStates.ownerId, ownerId)),
  ]);
  const allowedLessonIds = new Set(lessons.map((lesson) => lesson.lessonId));
  const revisionByLessonId = new Map(lessonRevisions.filter((revision) => {
    const lesson = lessons.find((candidate) => candidate.lessonId === revision.lessonId);
    return lesson?.currentRevision === revision.revision;
  }).map((revision) => [revision.lessonId, learningLessonSnapshotSchema.parse(revision.snapshot)]));
  const checkpointByLessonAndId = new Map(checkpoints.filter((state) => allowedLessonIds.has(state.lessonId))
    .map((state) => [`${state.lessonId}:${state.checkpointId}`, state]));
  const completedSessions = sessions.filter((session) => session.state === "completed" && session.completedAt !== null);
  const relevantHomework = homework.filter((item) => allowedLessonIds.has(item.lessonId));
  const allCheckpointDefinitions = lessons.flatMap((lesson) => (
    revisionByLessonId.get(lesson.lessonId)?.checkpoints.map((checkpoint) => ({ lesson, checkpoint })) ?? []
  ));
  const requiredCheckpoints = allCheckpointDefinitions.filter(({ checkpoint }) => checkpoint.required);
  const checkpointStatus = (lessonId: string, checkpointId: string) => (
    checkpointByLessonAndId.get(`${lessonId}:${checkpointId}`)?.status ?? "not_attempted"
  );
  const byCourse = courses.map((course) => {
    const courseLessons = lessons.filter((lesson) => lesson.courseId === course.courseId);
    const courseLessonIds = new Set(courseLessons.map((lesson) => lesson.lessonId));
    const courseSessions = sessions.filter((session) => session.courseId === course.courseId);
    const courseCompletedSessions = completedSessions.filter((session) => session.courseId === course.courseId);
    const courseHomework = relevantHomework.filter((item) => courseLessonIds.has(item.lessonId));
    const definitions = requiredCheckpoints.filter(({ lesson }) => lesson.courseId === course.courseId);
    const enrollment = enrollments.find((candidate) => candidate.courseId === course.courseId) ?? null;
    const lastActivityAt = courseSessions.reduce<number | null>((latest, session) => (
      latest === null || session.updatedAt > latest ? session.updatedAt : latest
    ), null);
    return {
      courseId: course.courseId,
      title: course.title,
      state: course.state,
      currentLessonId: enrollment?.currentLessonId ?? null,
      currentModuleId: enrollment?.currentModuleId ?? null,
      lastActivityAt,
      sessionCount: courseSessions.length,
      completedSessionCount: courseCompletedSessions.length,
      recordedSeconds: courseSessions.reduce((total, session) => total + session.accumulatedSeconds, 0),
      lessonCount: courseLessons.length,
      completedLessonCount: courseLessons.filter((lesson) => lesson.state === "completed").length,
      requiredCheckpointCount: definitions.length,
      demonstratedCheckpointCount: definitions.filter(({ lesson, checkpoint }) => (
        checkpointStatus(lesson.lessonId, checkpoint.checkpointId) === "demonstrated"
      )).length,
      needsAnotherPassCheckpointCount: definitions.filter(({ lesson, checkpoint }) => (
        checkpointStatus(lesson.lessonId, checkpoint.checkpointId) === "needs_another_pass"
      )).length,
      openHomeworkCount: courseHomework.filter((item) => item.state === "open").length,
      completedHomeworkCount: courseHomework.filter((item) => item.state === "completed").length,
      timeByModule: aggregateSessionTime(courseSessions, (session) => (
        lessons.find((lesson) => lesson.lessonId === session.lessonId)?.moduleId ?? "unassigned"
      )),
    };
  });
  const lessonTitleById = new Map(lessons.map((lesson) => [lesson.lessonId, lesson.title]));
  const courseTitleById = new Map(courses.map((course) => [course.courseId, course.title]));
  const recentTopics: Array<{ lessonId: string; courseId: string | null; title: string; lastActivityAt: number }> = [];
  const seenTopics = new Set<string>();
  [...completedSessions].sort((left, right) => (right.completedAt as number) - (left.completedAt as number))
    .forEach((session) => {
      if (seenTopics.has(session.lessonId) || recentTopics.length >= 12) return;
      seenTopics.add(session.lessonId);
      recentTopics.push({
        lessonId: session.lessonId,
        courseId: session.courseId,
        title: lessonTitleById.get(session.lessonId) ?? session.lessonId,
        lastActivityAt: session.completedAt as number,
      });
    });
  const demonstratedRequired = requiredCheckpoints.filter(({ lesson, checkpoint }) => (
    checkpointStatus(lesson.lessonId, checkpoint.checkpointId) === "demonstrated"
  )).length;
  return {
    courses: byCourse,
    overall: {
      courseCount: courses.length,
      activeCourseCount: courses.filter((course) => course.state === "active").length,
      completedCourseCount: courses.filter((course) => course.state === "completed").length,
      lessonCount: lessons.filter((lesson) => lesson.scopeType === "course").length,
      completedLessonCount: lessons.filter(
        (lesson) => lesson.scopeType === "course" && lesson.state === "completed",
      ).length,
      quickStudyCount: lessons.filter((lesson) => lesson.scopeType === "quick_study").length,
      quickStudySessionCount: completedSessions.filter((session) => session.scopeType === "quick_study").length,
      sessionCount: sessions.length,
      completedSessionCount: completedSessions.length,
      recordedSeconds: sessions.reduce((total, session) => total + session.accumulatedSeconds, 0),
      activeLearningDays: new Set(completedSessions.map((session) => pacificDate(session.completedAt as number))).size,
      requiredCheckpointCount: requiredCheckpoints.length,
      demonstratedCheckpointCount: demonstratedRequired,
      checkpointCoverage: requiredCheckpoints.length ? demonstratedRequired / requiredCheckpoints.length : null,
      needsAnotherPassCheckpointCount: requiredCheckpoints.filter(({ lesson, checkpoint }) => (
        checkpointStatus(lesson.lessonId, checkpoint.checkpointId) === "needs_another_pass"
      )).length,
      openHomeworkCount: relevantHomework.filter((item) => item.state === "open").length,
      completedHomeworkCount: relevantHomework.filter((item) => item.state === "completed").length,
    },
    time: {
      byDay: aggregateSessionTime(completedSessions, (session) => pacificDate(session.completedAt as number)),
      byWeek: aggregateSessionTime(completedSessions, (session) => mondayForDate(pacificDate(session.completedAt as number))),
      byMonth: aggregateSessionTime(completedSessions, (session) => pacificDate(session.completedAt as number).slice(0, 7)),
      byCourse: aggregateSessionTime(sessions, (session) => session.courseId ?? "quick_study").map((item) => ({
        ...item,
        title: item.key === "quick_study" ? "Quick Study" : courseTitleById.get(item.key) ?? item.key,
      })),
    },
    recentTopics,
    sessionDurationTrend: completedSessions.sort(
      (left, right) => (left.completedAt as number) - (right.completedAt as number),
    ).map((session) => ({
      sessionId: session.sessionId,
      courseId: session.courseId,
      lessonId: session.lessonId,
      completedAt: session.completedAt,
      recordedSeconds: session.accumulatedSeconds,
    })),
    evidencePolicy: "factual_analytics_only" as const,
  };
}

export async function queryLearningSessions(ownerId: string, inputValue: unknown = {}) {
  const input = queryLearningSessionsSchema.parse(inputValue);
  const db = getDb();
  const rows = await db.select().from(learningSessions).where(and(
    eq(learningSessions.ownerId, ownerId),
    input.sessionId ? eq(learningSessions.sessionId, input.sessionId) : undefined,
    input.lessonId ? eq(learningSessions.lessonId, input.lessonId) : undefined,
    input.includeCompleted ? undefined : ne(learningSessions.state, "completed"),
  )).orderBy(desc(learningSessions.updatedAt)).limit(100);
  const sessions = await Promise.all(rows.map(async (session) => {
    const [intervals, turns] = await Promise.all([
      db.select().from(learningSessionIntervals).where(and(
        eq(learningSessionIntervals.ownerId, ownerId),
        eq(learningSessionIntervals.sessionId, session.sessionId),
      )).orderBy(asc(learningSessionIntervals.startedAt)),
      db.select().from(learningTranscriptTurns).where(and(
        eq(learningTranscriptTurns.ownerId, ownerId),
        eq(learningTranscriptTurns.sessionId, session.sessionId),
      )).orderBy(asc(learningTranscriptTurns.sequence)),
    ]);
    return { session, intervals, turns, evidencePolicy: "transcript_only" as const };
  }));
  return { sessions, truncated: rows.length === 100 };
}

export async function assertLearningAudioForbidden(ownerId: string, subjectId: string) {
  const rows = await getDb().select({ sessionId: learningSessions.sessionId }).from(learningSessions).where(and(
    eq(learningSessions.ownerId, ownerId),
    eq(learningSessions.sessionId, subjectId),
  )).limit(1);
  if (rows[0]) {
    throw new LearningError(
      "learning_audio_forbidden",
      "Learning Sessions are transcript-only. Do not upload audio, register private-audio metadata, or create delivery analysis.",
    );
  }
}

function displayBlueprint(row: { revision: number; snapshot: unknown; createdAt: number }) {
  return {
    ...orderedBlueprint(learningCourseBlueprintSchema.parse(row.snapshot)),
    revision: row.revision,
    createdAt: row.createdAt,
  };
}

function displayLesson(row: { revision: number; snapshot: unknown; createdAt: number }) {
  return {
    ...learningLessonSnapshotSchema.parse(row.snapshot),
    revision: row.revision,
    createdAt: row.createdAt,
  };
}

export async function queryLearningWorkspace(ownerId: string, inputValue: unknown = {}) {
  const input = queryLearningWorkspaceSchema.parse(inputValue);
  const db = getDb();
  const courseConditions = [eq(learningCourses.ownerId, ownerId)];
  if (input.courseId) courseConditions.push(eq(learningCourses.courseId, input.courseId));
  if (!input.includeArchived) courseConditions.push(ne(learningCourses.state, "archived"));
  const courseRows = await db.select().from(learningCourses).where(and(...courseConditions)).orderBy(
    desc(learningCourses.updatedAt),
  ).limit(100);

  const courses = await Promise.all(courseRows.map(async (course) => {
    const blueprintRevision = input.courseId === course.courseId && input.blueprintRevision
      ? input.blueprintRevision
      : course.currentBlueprintRevision;
    const [blueprintRows, enrollmentRows, lessonRows] = await Promise.all([
      db.select().from(learningCourseBlueprintRevisions).where(and(
        eq(learningCourseBlueprintRevisions.ownerId, ownerId),
        eq(learningCourseBlueprintRevisions.courseId, course.courseId),
        eq(learningCourseBlueprintRevisions.revision, blueprintRevision),
      )).limit(1),
      db.select().from(learningEnrollments).where(and(
        eq(learningEnrollments.ownerId, ownerId),
        eq(learningEnrollments.courseId, course.courseId),
      )).limit(1),
      db.select().from(learningLessons).where(and(
        eq(learningLessons.ownerId, ownerId),
        eq(learningLessons.courseId, course.courseId),
        input.includeArchived ? undefined : ne(learningLessons.state, "archived"),
      )).orderBy(learningLessons.createdAt),
    ]);
    const lessons = await Promise.all(lessonRows.map(async (lesson) => {
      const revision = input.lessonId === lesson.lessonId && input.lessonRevision
        ? input.lessonRevision
        : lesson.currentRevision;
      const revisions = await db.select().from(learningLessonRevisions).where(and(
        eq(learningLessonRevisions.ownerId, ownerId),
        eq(learningLessonRevisions.lessonId, lesson.lessonId),
        eq(learningLessonRevisions.revision, revision),
      )).limit(1);
      return { ...lesson, current: revisions[0] ? displayLesson(revisions[0]) : null };
    }));
    return {
      course,
      blueprint: blueprintRows[0] ? displayBlueprint(blueprintRows[0]) : null,
      enrollment: enrollmentRows[0] ?? null,
      lessons,
    };
  }));

  const quickRows = await db.select().from(learningLessons).where(and(
    eq(learningLessons.ownerId, ownerId),
    eq(learningLessons.scopeType, "quick_study"),
    input.lessonId ? eq(learningLessons.lessonId, input.lessonId) : undefined,
    input.includeArchived ? undefined : ne(learningLessons.state, "archived"),
  )).orderBy(desc(learningLessons.updatedAt)).limit(100);
  const quickStudies = await Promise.all(quickRows.map(async (lesson) => {
    const revision = input.lessonId === lesson.lessonId && input.lessonRevision
      ? input.lessonRevision
      : lesson.currentRevision;
    const rows = await db.select().from(learningLessonRevisions).where(and(
      eq(learningLessonRevisions.ownerId, ownerId),
      eq(learningLessonRevisions.lessonId, lesson.lessonId),
      eq(learningLessonRevisions.revision, revision),
    )).limit(1);
    return { lesson, current: rows[0] ? displayLesson(rows[0]) : null };
  }));

  const [allCourses, allLessons, activeEnrollments, allSessions, allHomework, checkpointStates] = await Promise.all([
    db.select({ state: learningCourses.state }).from(learningCourses).where(eq(learningCourses.ownerId, ownerId)),
    db.select({ scopeType: learningLessons.scopeType, state: learningLessons.state }).from(learningLessons).where(
      eq(learningLessons.ownerId, ownerId),
    ),
    db.select({ enrollmentId: learningEnrollments.enrollmentId }).from(learningEnrollments).where(and(
      eq(learningEnrollments.ownerId, ownerId),
      eq(learningEnrollments.state, "active"),
    )),
    db.select({ state: learningSessions.state, accumulatedSeconds: learningSessions.accumulatedSeconds })
      .from(learningSessions).where(eq(learningSessions.ownerId, ownerId)),
    db.select({ state: learningHomework.state }).from(learningHomework).where(eq(learningHomework.ownerId, ownerId)),
    db.select({ status: learningCheckpointStates.status }).from(learningCheckpointStates).where(
      eq(learningCheckpointStates.ownerId, ownerId),
    ),
  ]);
  return {
    courses,
    quickStudies,
    facts: {
      courseCount: allCourses.length,
      draftCourseCount: allCourses.filter((course) => course.state === "draft").length,
      activeCourseCount: allCourses.filter((course) => course.state === "active").length,
      completedCourseCount: allCourses.filter((course) => course.state === "completed").length,
      activeEnrollmentCount: activeEnrollments.length,
      lessonCount: allLessons.filter((lesson) => lesson.scopeType === "course").length,
      completedLessonCount: allLessons.filter((lesson) => lesson.scopeType === "course" && lesson.state === "completed").length,
      quickStudyCount: allLessons.filter((lesson) => lesson.scopeType === "quick_study").length,
      sessionCount: allSessions.length,
      completedSessionCount: allSessions.filter((session) => session.state === "completed").length,
      recordedLearningSeconds: allSessions.reduce((total, session) => total + session.accumulatedSeconds, 0),
      homeworkCount: allHomework.length,
      completedHomeworkCount: allHomework.filter((homework) => homework.state === "completed").length,
      checkpointResultCount: checkpointStates.length,
      demonstratedCheckpointCount: checkpointStates.filter((checkpoint) => checkpoint.status === "demonstrated").length,
      needsAnotherPassCheckpointCount: checkpointStates.filter(
        (checkpoint) => checkpoint.status === "needs_another_pass",
      ).length,
    },
    truncated: courseRows.length === 100 || quickRows.length === 100,
  };
}
