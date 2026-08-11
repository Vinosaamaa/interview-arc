import { and, asc, desc, eq, ne, sql } from "drizzle-orm";

import { d1TransactionalInvariantGuard } from "./d1-transactional-guard";
import { getDb } from "./index";
import {
  learningCourseBlueprintRevisions,
  learningCourses,
  learningEnrollments,
  learningLessonRevisions,
  learningLessons,
  learningOperations,
  learningSessionIntervals,
  learningSessions,
  learningTranscriptTurns,
} from "./schema";
import {
  appendLearningTranscriptSchema,
  approveLearningEnrollmentSchema,
  controlLearningSessionSchema,
  createLearningCourseBlueprintSchema,
  createLearningSessionSchema,
  learningCourseBlueprintSchema,
  learningLessonSnapshotSchema,
  queryLearningWorkspaceSchema,
  queryLearningSessionsSchema,
  reviseLearningCourseBlueprintSchema,
  saveLearningLessonRevisionSchema,
  type ApproveLearningEnrollmentInput,
  type AppendLearningTranscriptInput,
  type ControlLearningSessionInput,
  type CreateLearningCourseBlueprintInput,
  type CreateLearningSessionInput,
  type LearningCourseBlueprint,
  type ReviseLearningCourseBlueprintInput,
  type SaveLearningLessonRevisionInput,
} from "./learn-policy";

export {
  appendLearningTranscriptSchema,
  approveLearningEnrollmentSchema,
  controlLearningSessionSchema,
  createLearningCourseBlueprintSchema,
  createLearningSessionSchema,
  queryLearningSessionsSchema,
  queryLearningWorkspaceSchema,
  reviseLearningCourseBlueprintSchema,
  saveLearningLessonRevisionSchema,
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
    || (input.action === "resume" && current.state === "paused")
    || (input.action === "finish" && (current.state === "running" || current.state === "paused"));
  if (!valid) {
    throw new LearningError(
      "learning_session_transition_invalid",
      `Cannot ${input.action} a ${current.state} Learning Session.`,
    );
  }

  const revision = current.revision + 1;
  const accumulatedSeconds = elapsedSeconds(current, nowMs);
  const nextState = input.action === "finish"
    ? "completed" as const
    : input.action === "pause"
      ? "paused" as const
      : "running" as const;
  const nextRunningSince = nextState === "running" ? nowMs : null;
  const nextStartedAt = current.startedAt ?? nowMs;
  const completedAt = nextState === "completed" ? nowMs : null;
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

  const [allCourses, allLessons, activeEnrollments, allSessions] = await Promise.all([
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
    },
    truncated: courseRows.length === 100 || quickRows.length === 100,
  };
}
