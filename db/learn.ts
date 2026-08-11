import { and, desc, eq, ne, sql } from "drizzle-orm";

import { d1TransactionalInvariantGuard } from "./d1-transactional-guard";
import { getDb } from "./index";
import {
  learningCourseBlueprintRevisions,
  learningCourses,
  learningEnrollments,
  learningLessonRevisions,
  learningLessons,
  learningOperations,
} from "./schema";
import {
  approveLearningEnrollmentSchema,
  createLearningCourseBlueprintSchema,
  learningCourseBlueprintSchema,
  learningLessonSnapshotSchema,
  queryLearningWorkspaceSchema,
  reviseLearningCourseBlueprintSchema,
  saveLearningLessonRevisionSchema,
  type ApproveLearningEnrollmentInput,
  type CreateLearningCourseBlueprintInput,
  type LearningCourseBlueprint,
  type ReviseLearningCourseBlueprintInput,
  type SaveLearningLessonRevisionInput,
} from "./learn-policy";

export {
  approveLearningEnrollmentSchema,
  createLearningCourseBlueprintSchema,
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

  const [allCourses, allLessons, activeEnrollments] = await Promise.all([
    db.select({ state: learningCourses.state }).from(learningCourses).where(eq(learningCourses.ownerId, ownerId)),
    db.select({ scopeType: learningLessons.scopeType, state: learningLessons.state }).from(learningLessons).where(
      eq(learningLessons.ownerId, ownerId),
    ),
    db.select({ enrollmentId: learningEnrollments.enrollmentId }).from(learningEnrollments).where(and(
      eq(learningEnrollments.ownerId, ownerId),
      eq(learningEnrollments.state, "active"),
    )),
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
    },
    truncated: courseRows.length === 100 || quickRows.length === 100,
  };
}
