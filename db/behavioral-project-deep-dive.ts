import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";

import { d1TransactionalInvariantGuard } from "./d1-transactional-guard";
import { getDb } from "./index";
import {
  activitySolutionLinks,
  behavioralClaims,
  behavioralEvidenceItems,
  behavioralEvidenceSources,
  behavioralProjectActivityLinks,
  behavioralProjectOperations,
  behavioralProjectQuestionBindingRevisions,
  behavioralProjectQuestionBindings,
  behavioralStories,
  contentBank,
  extraActivities,
  outcomes,
  ownerBankQuestions,
  problemSolutionProfiles,
  timers,
} from "./schema";
import {
  behavioralProjectBindingWriteSchema,
  behavioralProjectActivityLinkMatches,
  behavioralProjectCompletedAttemptLinkSchema,
  behavioralProjectProfileMissingRequirements,
  behavioralProjectQuerySchema,
  type BehavioralProjectBindingWrite,
  type BehavioralProjectProfileBinding,
} from "./behavioral-project-deep-dive-policy";

export {
  behavioralProjectBindingWriteSchema,
  behavioralProjectCompletedAttemptLinkSchema,
  behavioralProjectProfileBindingSchema,
  behavioralProjectQuerySchema,
} from "./behavioral-project-deep-dive-policy";

export class BehavioralProjectDeepDiveError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "BehavioralProjectDeepDiveError";
    this.code = code;
    this.retryable = retryable;
  }
}

type BehavioralProjectOperationReceipt = Record<string, unknown> & {
  status: string;
  questionId?: string;
  activityId?: string;
  projectId?: string;
};

const PROJECT_REGISTRY_LIMIT = 100;
const MIGRATION_REVIEW_LIMIT = 100;

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requestFingerprint(value: unknown) {
  return sha256(JSON.stringify(value));
}

async function replayOperation(ownerId: string, operationId: string, fingerprint: string) {
  const rows = await getDb().select().from(behavioralProjectOperations).where(and(
    eq(behavioralProjectOperations.ownerId, ownerId),
    eq(behavioralProjectOperations.operationId, operationId),
  )).limit(1);
  const operation = rows[0];
  if (!operation) return null;
  if (operation.requestFingerprint !== fingerprint) {
    throw new BehavioralProjectDeepDiveError(
      "behavioral_project_operation_conflict",
      "That Project Deep Dive operation ID already belongs to a different request.",
    );
  }
  return { ...(operation.receipt as BehavioralProjectOperationReceipt), duplicate: true as const };
}

async function projectRegistryRows(ownerId: string, projectId?: string, afterProjectId?: string) {
  const db = getDb();
  const [sources, evidence, stories] = await Promise.all([
    db.select({
      projectId: behavioralEvidenceSources.projectKey,
      count: sql<number>`count(*)`,
    }).from(behavioralEvidenceSources).where(and(
      eq(behavioralEvidenceSources.ownerId, ownerId),
      projectId ? eq(behavioralEvidenceSources.projectKey, projectId) : undefined,
      afterProjectId ? gt(behavioralEvidenceSources.projectKey, afterProjectId) : undefined,
    )).groupBy(behavioralEvidenceSources.projectKey).orderBy(asc(behavioralEvidenceSources.projectKey))
      .limit(projectId ? 1 : PROJECT_REGISTRY_LIMIT + 1),
    db.select({
      projectId: behavioralEvidenceItems.projectKey,
      count: sql<number>`count(*)`,
    }).from(behavioralEvidenceItems).where(and(
      eq(behavioralEvidenceItems.ownerId, ownerId),
      projectId ? eq(behavioralEvidenceItems.projectKey, projectId) : undefined,
      afterProjectId ? gt(behavioralEvidenceItems.projectKey, afterProjectId) : undefined,
    )).groupBy(behavioralEvidenceItems.projectKey).orderBy(asc(behavioralEvidenceItems.projectKey))
      .limit(projectId ? 1 : PROJECT_REGISTRY_LIMIT + 1),
    db.select({
      projectId: behavioralStories.projectKey,
      count: sql<number>`count(*)`,
    }).from(behavioralStories).where(and(
      eq(behavioralStories.ownerId, ownerId),
      projectId ? eq(behavioralStories.projectKey, projectId) : undefined,
      afterProjectId ? gt(behavioralStories.projectKey, afterProjectId) : undefined,
    )).groupBy(behavioralStories.projectKey).orderBy(asc(behavioralStories.projectKey))
      .limit(projectId ? 1 : PROJECT_REGISTRY_LIMIT + 1),
  ]);
  const counts = new Map<string, { sourceCount: number; evidenceCount: number; storyCount: number }>();
  const touch = (projectId: string) => {
    const current = counts.get(projectId) ?? { sourceCount: 0, evidenceCount: 0, storyCount: 0 };
    counts.set(projectId, current);
    return current;
  };
  for (const row of sources) touch(row.projectId).sourceCount += Number(row.count);
  for (const row of evidence) touch(row.projectId).evidenceCount += Number(row.count);
  for (const row of stories) touch(row.projectId).storyCount += Number(row.count);
  const projects = [...counts.entries()].map(([stableProjectId, countsByKind]) => ({ projectId: stableProjectId, ...countsByKind }))
    .sort((left, right) => left.projectId.localeCompare(right.projectId));
  return {
    projects: projects.slice(0, PROJECT_REGISTRY_LIMIT),
    truncated: !projectId && (
      projects.length > PROJECT_REGISTRY_LIMIT
      || sources.length > PROJECT_REGISTRY_LIMIT
      || evidence.length > PROJECT_REGISTRY_LIMIT
      || stories.length > PROJECT_REGISTRY_LIMIT
    ),
  };
}

async function assertProjectExists(ownerId: string, projectId: string) {
  const db = getDb();
  const [source, evidence, story] = await Promise.all([
    db.select({ projectId: behavioralEvidenceSources.projectKey }).from(behavioralEvidenceSources).where(and(
      eq(behavioralEvidenceSources.ownerId, ownerId),
      eq(behavioralEvidenceSources.projectKey, projectId),
    )).limit(1),
    db.select({ projectId: behavioralEvidenceItems.projectKey }).from(behavioralEvidenceItems).where(and(
      eq(behavioralEvidenceItems.ownerId, ownerId),
      eq(behavioralEvidenceItems.projectKey, projectId),
    )).limit(1),
    db.select({ projectId: behavioralStories.projectKey }).from(behavioralStories).where(and(
      eq(behavioralStories.ownerId, ownerId),
      eq(behavioralStories.projectKey, projectId),
    )).limit(1),
  ]);
  if (!source[0] && !evidence[0] && !story[0]) {
    throw new BehavioralProjectDeepDiveError(
      "behavioral_project_not_found",
      "That stable project ID is unavailable in the same owner's Behavioral evidence registry.",
    );
  }
}

async function assertQuestionExists(ownerId: string, questionId: string) {
  const db = getDb();
  const [personal, shared] = await Promise.all([
    db.select({ questionId: ownerBankQuestions.questionId }).from(ownerBankQuestions).where(and(
      eq(ownerBankQuestions.ownerId, ownerId),
      eq(ownerBankQuestions.specialty, "behavioral"),
      eq(ownerBankQuestions.questionId, questionId),
    )).limit(1),
    db.select({ questionId: contentBank.id }).from(contentBank).where(and(
      eq(contentBank.category, "behavioral"),
      eq(contentBank.id, questionId),
    )).limit(1),
  ]);
  if (!personal[0] && !shared[0]) {
    throw new BehavioralProjectDeepDiveError(
      "behavioral_project_question_not_found",
      "That exact Behavioral Problem Bank question is unavailable.",
    );
  }
}

async function claimProject(ownerId: string, claimId: string) {
  const db = getDb();
  const claimRows = await db.select().from(behavioralClaims).where(and(
    eq(behavioralClaims.ownerId, ownerId),
    eq(behavioralClaims.claimId, claimId),
  )).limit(1);
  const claim = claimRows[0];
  if (!claim || claim.status === "contradicted") {
    throw new BehavioralProjectDeepDiveError(
      "behavioral_project_claim_unavailable",
      "That source claim is missing or contradicted for this owner.",
    );
  }
  const evidenceIds = [...new Set(claim.evidenceIds as string[])];
  if (!evidenceIds.length) {
    throw new BehavioralProjectDeepDiveError(
      "behavioral_project_claim_project_unresolved",
      "That source claim has no accepted evidence from which an exact project ID can be resolved.",
    );
  }
  const evidence = await db.select({
    evidenceId: behavioralEvidenceItems.evidenceId,
    projectId: behavioralEvidenceItems.projectKey,
    state: behavioralEvidenceItems.candidateState,
  }).from(behavioralEvidenceItems).where(and(
    eq(behavioralEvidenceItems.ownerId, ownerId),
    inArray(behavioralEvidenceItems.evidenceId, evidenceIds),
  ));
  if (evidence.length !== evidenceIds.length || evidence.some((row) => row.state !== "accepted")) {
    throw new BehavioralProjectDeepDiveError(
      "behavioral_project_claim_evidence_unavailable",
      "Every source-claim evidence link must be accepted and owner-private.",
    );
  }
  const projects = [...new Set(evidence.map((row) => row.projectId))];
  if (projects.length !== 1) {
    throw new BehavioralProjectDeepDiveError(
      "behavioral_project_claim_project_conflict",
      "The source claim does not resolve to exactly one stable project ID.",
    );
  }
  return projects[0];
}

function bindingSnapshot(input: BehavioralProjectBindingWrite) {
  return {
    projectId: input.projectId,
    focus: input.focus,
    sourceClaimId: input.sourceClaimId ?? null,
    state: input.state,
  };
}

function currentBindingSnapshot(row: typeof behavioralProjectQuestionBindings.$inferSelect) {
  return {
    projectId: row.projectId,
    focus: row.focus,
    sourceClaimId: row.sourceClaimId,
    state: row.state,
  };
}

export async function readCurrentBehavioralProjectBinding(ownerId: string, questionId: string) {
  const rows = await getDb().select().from(behavioralProjectQuestionBindings).where(and(
    eq(behavioralProjectQuestionBindings.ownerId, ownerId),
    eq(behavioralProjectQuestionBindings.questionId, questionId),
  )).limit(1);
  return rows[0] ?? null;
}

export async function setBehavioralProjectQuestionBinding(
  ownerId: string,
  inputValue: unknown,
  nowMs = Date.now(),
) {
  const input = behavioralProjectBindingWriteSchema.parse(inputValue);
  const db = getDb();
  const fingerprint = await requestFingerprint(input);
  const replay = await replayOperation(ownerId, input.operationId, fingerprint);
  if (replay) return replay;
  await Promise.all([assertProjectExists(ownerId, input.projectId), assertQuestionExists(ownerId, input.questionId)]);
  if (input.sourceClaimId) {
    const resolvedProject = await claimProject(ownerId, input.sourceClaimId);
    if (resolvedProject !== input.projectId) {
      throw new BehavioralProjectDeepDiveError(
        "behavioral_project_claim_project_mismatch",
        "The source claim belongs to a different stable project ID.",
      );
    }
  }
  const current = await readCurrentBehavioralProjectBinding(ownerId, input.questionId);
  const currentRevision = current?.currentRevision ?? 0;
  if (currentRevision !== input.expectedRevision) {
    throw new BehavioralProjectDeepDiveError(
      "behavioral_project_binding_revision_conflict",
      "The question's Project Deep Dive binding changed; reread it before retrying.",
      true,
    );
  }
  const unchanged = current && JSON.stringify(currentBindingSnapshot(current)) === JSON.stringify(bindingSnapshot(input));
  const status = unchanged ? "unchanged" as const : current ? "revised" as const : "created" as const;
  const revision = unchanged ? currentRevision : currentRevision + 1;
  const receipt = {
    status,
    questionId: input.questionId,
    projectId: input.projectId,
    focus: input.focus,
    ...(input.sourceClaimId ? { sourceClaimId: input.sourceClaimId } : {}),
    bindingRevision: revision,
    state: input.state,
  };
  const currentCondition = current
    ? sql`EXISTS (
        SELECT 1 FROM ${behavioralProjectQuestionBindings}
        WHERE ${behavioralProjectQuestionBindings.ownerId} = ${ownerId}
          AND ${behavioralProjectQuestionBindings.questionId} = ${input.questionId}
          AND ${behavioralProjectQuestionBindings.currentRevision} = ${currentRevision}
      )`
    : sql`NOT EXISTS (
        SELECT 1 FROM ${behavioralProjectQuestionBindings}
        WHERE ${behavioralProjectQuestionBindings.ownerId} = ${ownerId}
          AND ${behavioralProjectQuestionBindings.questionId} = ${input.questionId}
      )`;
  const uniquenessCondition = input.state === "archived"
    ? sql`1 = 1`
    : input.focus === "project_overview"
      ? sql`NOT EXISTS (
          SELECT 1 FROM ${behavioralProjectQuestionBindings}
          WHERE ${behavioralProjectQuestionBindings.ownerId} = ${ownerId}
            AND ${behavioralProjectQuestionBindings.projectId} = ${input.projectId}
            AND ${behavioralProjectQuestionBindings.focus} = 'project_overview'
            AND ${behavioralProjectQuestionBindings.state} = 'active'
            AND ${behavioralProjectQuestionBindings.questionId} <> ${input.questionId}
        )`
      : input.focus === "resume_claim"
        ? sql`NOT EXISTS (
            SELECT 1 FROM ${behavioralProjectQuestionBindings}
            WHERE ${behavioralProjectQuestionBindings.ownerId} = ${ownerId}
              AND ${behavioralProjectQuestionBindings.projectId} = ${input.projectId}
              AND ${behavioralProjectQuestionBindings.focus} = 'resume_claim'
              AND ${behavioralProjectQuestionBindings.sourceClaimId} = ${input.sourceClaimId!}
              AND ${behavioralProjectQuestionBindings.state} = 'active'
              AND ${behavioralProjectQuestionBindings.questionId} <> ${input.questionId}
          )`
        : sql`1 = 1`;
  const statements: unknown[] = [
    d1TransactionalInvariantGuard(db, currentCondition),
    d1TransactionalInvariantGuard(db, uniquenessCondition),
  ];
  if (!unchanged) {
    statements.push(db.insert(behavioralProjectQuestionBindingRevisions).values({
      ownerId,
      questionId: input.questionId,
      revision,
      operationId: input.operationId,
      requestFingerprint: fingerprint,
      projectId: input.projectId,
      focus: input.focus,
      sourceClaimId: input.sourceClaimId ?? null,
      state: input.state,
      reason: input.reason,
      createdAt: nowMs,
    }));
    statements.push(current
      ? db.update(behavioralProjectQuestionBindings).set({
          currentRevision: revision,
          projectId: input.projectId,
          focus: input.focus,
          sourceClaimId: input.sourceClaimId ?? null,
          state: input.state,
          updatedAt: nowMs,
        }).where(and(
          eq(behavioralProjectQuestionBindings.ownerId, ownerId),
          eq(behavioralProjectQuestionBindings.questionId, input.questionId),
          eq(behavioralProjectQuestionBindings.currentRevision, currentRevision),
        ))
      : db.insert(behavioralProjectQuestionBindings).values({
          ownerId,
          questionId: input.questionId,
          currentRevision: revision,
          projectId: input.projectId,
          focus: input.focus,
          sourceClaimId: input.sourceClaimId ?? null,
          state: input.state,
          createdAt: nowMs,
          updatedAt: nowMs,
        }));
  }
  statements.push(db.insert(behavioralProjectOperations).values({
    ownerId,
    operationId: input.operationId,
    action: "set_question_binding",
    requestFingerprint: fingerprint,
    receipt,
    createdAt: nowMs,
  }));
  try {
    await db.batch(statements as unknown as Parameters<typeof db.batch>[0]);
  } catch {
    const racedReplay = await replayOperation(ownerId, input.operationId, fingerprint);
    if (racedReplay) return racedReplay;
    const raced = await readCurrentBehavioralProjectBinding(ownerId, input.questionId);
    if ((raced?.currentRevision ?? 0) !== currentRevision) {
      throw new BehavioralProjectDeepDiveError(
        "behavioral_project_binding_revision_conflict",
        "The question's Project Deep Dive binding changed while saving; reread it before retrying.",
        true,
      );
    }
    throw new BehavioralProjectDeepDiveError(
      "behavioral_project_binding_scope_conflict",
      "That active project overview or resume claim is already bound to another question.",
    );
  }
  return { ...receipt, duplicate: false };
}

function activityIdentity(payloadValue: unknown) {
  const payload = payloadValue as Record<string, unknown>;
  if (payload.type !== "behavioral" || typeof payload.questionId !== "string") {
    throw new BehavioralProjectDeepDiveError(
      "behavioral_project_activity_not_behavioral",
      "Only an exact Behavioral practice attempt can receive a Project Deep Dive link.",
    );
  }
  return { questionId: payload.questionId };
}

export async function linkCompletedBehavioralProjectAttempt(
  ownerId: string,
  inputValue: unknown,
  nowMs = Date.now(),
) {
  const input = behavioralProjectCompletedAttemptLinkSchema.parse(inputValue);
  const db = getDb();
  const fingerprint = await requestFingerprint(input);
  const replay = await replayOperation(ownerId, input.operationId, fingerprint);
  if (replay) return replay;
  const [activityRows, timerRows, outcomeRows, bindingRows, existingLinks, solutionLinks] = await Promise.all([
    db.select().from(extraActivities).where(and(eq(extraActivities.ownerId, ownerId), eq(extraActivities.id, input.activityId))).limit(1),
    db.select().from(timers).where(and(eq(timers.ownerId, ownerId), eq(timers.subjectId, input.activityId), eq(timers.kind, "activity"))).limit(1),
    db.select().from(outcomes).where(and(eq(outcomes.ownerId, ownerId), eq(outcomes.activityId, input.activityId))).limit(1),
    db.select().from(behavioralProjectQuestionBindingRevisions).where(and(
      eq(behavioralProjectQuestionBindingRevisions.ownerId, ownerId),
      eq(behavioralProjectQuestionBindingRevisions.questionId, input.questionId),
      eq(behavioralProjectQuestionBindingRevisions.revision, input.bindingRevision),
    )).limit(1),
    db.select().from(behavioralProjectActivityLinks).where(and(
      eq(behavioralProjectActivityLinks.ownerId, ownerId),
      eq(behavioralProjectActivityLinks.activityId, input.activityId),
    )).limit(1),
    db.select().from(activitySolutionLinks).where(and(
      eq(activitySolutionLinks.ownerId, ownerId),
      eq(activitySolutionLinks.activityId, input.activityId),
    )).limit(1),
  ]);
  const activity = activityRows[0];
  const timer = timerRows[0];
  const outcome = outcomeRows[0];
  const binding = bindingRows[0];
  if (!activity) throw new BehavioralProjectDeepDiveError("behavioral_project_activity_not_found", "That owner-private attempt is unavailable.");
  if (activityIdentity(activity.payload).questionId !== input.questionId) {
    throw new BehavioralProjectDeepDiveError("behavioral_project_activity_question_mismatch", "The attempt belongs to a different stable question ID.");
  }
  if (!timer?.startedAt || !timer.completed || !timer.completedAt || !outcome) {
    throw new BehavioralProjectDeepDiveError(
      "behavioral_project_activity_not_completed",
      "Historical linking requires an authoritative completed timer and explicit result.",
    );
  }
  if (outcome.updatedAt > timer.completedAt) {
    throw new BehavioralProjectDeepDiveError(
      "behavioral_project_result_changed_after_completion",
      "The activity result changed after completion, so its completion-time state cannot be reconstructed safely.",
    );
  }
  if (!binding || binding.state !== "active") {
    throw new BehavioralProjectDeepDiveError(
      "behavioral_project_binding_revision_not_found",
      "That exact active Project Deep Dive binding revision is unavailable.",
    );
  }
  const existing = existingLinks[0];
  if (existing) {
    const same = existing.questionId === input.questionId && existing.bindingRevision === input.bindingRevision;
    if (!same) {
      throw new BehavioralProjectDeepDiveError(
        "behavioral_project_activity_link_conflict",
        "That completed attempt already has a different immutable project link.",
      );
    }
    const receipt = {
      status: "unchanged" as const,
      activityId: input.activityId,
      questionId: input.questionId,
      projectId: existing.projectId,
      focus: existing.focus,
      bindingRevision: existing.bindingRevision,
      linkedAt: existing.linkedAt,
    };
    try {
      await db.insert(behavioralProjectOperations).values({
        ownerId,
        operationId: input.operationId,
        action: "link_completed_attempt",
        requestFingerprint: fingerprint,
        receipt,
        createdAt: nowMs,
      });
    } catch {
      const racedReplay = await replayOperation(ownerId, input.operationId, fingerprint);
      if (racedReplay) return racedReplay;
      throw new BehavioralProjectDeepDiveError(
        "behavioral_project_operation_conflict",
        "The completed-attempt link operation changed while saving; reread it before retrying.",
        true,
      );
    }
    return { ...receipt, duplicate: false };
  }
  const solution = solutionLinks[0]?.specialty === "behavioral" && solutionLinks[0].questionId === input.questionId
    ? solutionLinks[0]
    : null;
  const receipt = {
    status: "linked" as const,
    activityId: input.activityId,
    questionId: input.questionId,
    projectId: binding.projectId,
    focus: binding.focus,
    ...(binding.sourceClaimId ? { sourceClaimId: binding.sourceClaimId } : {}),
    bindingRevision: binding.revision,
    solutionRevision: solution?.solutionRevision ?? null,
    completedAt: timer.completedAt,
    linkedAt: nowMs,
  };
  const unchanged = sql`EXISTS (
    SELECT 1 FROM ${extraActivities}
    WHERE ${extraActivities.ownerId} = ${ownerId}
      AND ${extraActivities.id} = ${input.activityId}
      AND ${extraActivities.revision} = ${activity.revision}
      AND json_extract(${extraActivities.payload}, '$.type') = 'behavioral'
      AND json_extract(${extraActivities.payload}, '$.questionId') = ${input.questionId}
  ) AND EXISTS (
    SELECT 1 FROM ${timers}
    WHERE ${timers.ownerId} = ${ownerId}
      AND ${timers.subjectId} = ${input.activityId}
      AND ${timers.kind} = 'activity'
      AND ${timers.completed} = 1
      AND ${timers.completedAt} = ${timer.completedAt}
      AND ${timers.revision} = ${timer.revision}
  ) AND EXISTS (
    SELECT 1 FROM ${outcomes}
    WHERE ${outcomes.ownerId} = ${ownerId}
      AND ${outcomes.activityId} = ${input.activityId}
      AND ${outcomes.outcome} = ${outcome.outcome}
      AND ${outcomes.revision} = ${outcome.revision}
      AND ${outcomes.updatedAt} = ${outcome.updatedAt}
      AND ${outcomes.updatedAt} <= ${timer.completedAt}
  ) AND EXISTS (
    SELECT 1 FROM ${behavioralProjectQuestionBindingRevisions}
    WHERE ${behavioralProjectQuestionBindingRevisions.ownerId} = ${ownerId}
      AND ${behavioralProjectQuestionBindingRevisions.questionId} = ${input.questionId}
      AND ${behavioralProjectQuestionBindingRevisions.revision} = ${input.bindingRevision}
      AND ${behavioralProjectQuestionBindingRevisions.state} = 'active'
  ) AND NOT EXISTS (
    SELECT 1 FROM ${behavioralProjectActivityLinks}
    WHERE ${behavioralProjectActivityLinks.ownerId} = ${ownerId}
      AND ${behavioralProjectActivityLinks.activityId} = ${input.activityId}
  )`;
  try {
    await db.batch([
      d1TransactionalInvariantGuard(db, unchanged),
      db.insert(behavioralProjectActivityLinks).values({
        ownerId,
        activityId: input.activityId,
        questionId: input.questionId,
        bindingRevision: binding.revision,
        projectId: binding.projectId,
        focus: binding.focus,
        sourceClaimId: binding.sourceClaimId,
        solutionRevision: solution?.solutionRevision ?? null,
        source: "completed_attempt_backfill",
        operationId: input.operationId,
        requestFingerprint: fingerprint,
        linkedAt: nowMs,
      }),
      db.insert(behavioralProjectOperations).values({
        ownerId,
        operationId: input.operationId,
        action: "link_completed_attempt",
        requestFingerprint: fingerprint,
        receipt,
        createdAt: nowMs,
      }),
    ]);
  } catch {
    const racedReplay = await replayOperation(ownerId, input.operationId, fingerprint);
    if (racedReplay) return racedReplay;
    throw new BehavioralProjectDeepDiveError(
      "behavioral_project_completed_attempt_conflict",
      "The attempt or binding changed while linking; reread both before retrying.",
      true,
    );
  }
  return { ...receipt, duplicate: false };
}

export function expectedProjectProfileBinding(
  binding: typeof behavioralProjectQuestionBindings.$inferSelect | null,
): BehavioralProjectProfileBinding | null {
  if (!binding || binding.state !== "active") return null;
  return {
    projectId: binding.projectId,
    bindingRevision: binding.currentRevision,
    focus: binding.focus,
    ...(binding.sourceClaimId ? { sourceClaimId: binding.sourceClaimId } : {}),
  };
}

export function projectProfileMissingRequirements(
  profile: { sections: Array<{ sectionKey?: string }>; projectDeepDive?: unknown },
  binding: typeof behavioralProjectQuestionBindings.$inferSelect | null,
) {
  return behavioralProjectProfileMissingRequirements(profile, expectedProjectProfileBinding(binding));
}

export async function prepareBehavioralProjectFinalizationLink(input: {
  ownerId: string;
  activityId: string;
  questionId: string;
  solutionRevision: number;
  profile: { sections: Array<{ sectionKey?: string }>; projectDeepDive?: unknown };
}) {
  const binding = await readCurrentBehavioralProjectBinding(input.ownerId, input.questionId);
  const missing = projectProfileMissingRequirements(input.profile, binding);
  if (missing.length) {
    throw new BehavioralProjectDeepDiveError(
      "behavioral_project_profile_incomplete",
      `The Project Deep Dive Solution Profile is not reusable; missing: ${missing.join(", ")}.`,
    );
  }
  if (!binding || binding.state !== "active") return null;
  const identity = {
    activityId: input.activityId,
    questionId: input.questionId,
    bindingRevision: binding.currentRevision,
    projectId: binding.projectId,
    focus: binding.focus,
    sourceClaimId: binding.sourceClaimId,
    solutionRevision: input.solutionRevision,
    source: "finalization" as const,
  };
  const fingerprint = await requestFingerprint(identity);
  const operationId = `behavioral-project-finalization-${(await sha256(`${input.activityId}:${input.questionId}`)).slice(0, 40)}`;
  const existingRows = await getDb().select().from(behavioralProjectActivityLinks).where(and(
    eq(behavioralProjectActivityLinks.ownerId, input.ownerId),
    eq(behavioralProjectActivityLinks.activityId, input.activityId),
  )).limit(1);
  const existing = existingRows[0];
  if (existing) {
    if (!behavioralProjectActivityLinkMatches(existing, identity)) {
      throw new BehavioralProjectDeepDiveError(
        "behavioral_project_activity_link_conflict",
        "That attempt already has a different immutable Project Deep Dive link.",
      );
    }
  }
  return { binding, existing: existing ?? null, operationId, requestFingerprint: fingerprint, identity };
}

function tagsOf(row: typeof ownerBankQuestions.$inferSelect) {
  return [...new Set(((row.tags ?? []) as string[]).map((tag) => tag.trim().toLowerCase()))];
}

function migrationQuestionMetadata(row: typeof ownerBankQuestions.$inferSelect) {
  const tags = tagsOf(row);
  return {
    questionId: row.questionId,
    isOverview: tags.includes("resume-foundation"),
    isClaim: tags.includes("resume-bullet"),
    projects: tags.filter((tag) => tag.startsWith("experience:"))
      .map((tag) => tag.slice("experience:".length)).filter(Boolean),
    claims: tags.filter((tag) => tag.startsWith("claim:") || tag.startsWith("resume-claim:"))
      .map((tag) => tag.slice(tag.indexOf(":") + 1)).filter(Boolean),
  };
}

async function knownProjectIds(ownerId: string, projectIds: string[]) {
  const stableIds = [...new Set(projectIds)];
  if (!stableIds.length) return new Set<string>();
  const db = getDb();
  const [sources, evidence, stories] = await Promise.all([
    db.select({ projectId: behavioralEvidenceSources.projectKey }).from(behavioralEvidenceSources).where(and(
      eq(behavioralEvidenceSources.ownerId, ownerId),
      inArray(behavioralEvidenceSources.projectKey, stableIds),
    )),
    db.select({ projectId: behavioralEvidenceItems.projectKey }).from(behavioralEvidenceItems).where(and(
      eq(behavioralEvidenceItems.ownerId, ownerId),
      inArray(behavioralEvidenceItems.projectKey, stableIds),
    )),
    db.select({ projectId: behavioralStories.projectKey }).from(behavioralStories).where(and(
      eq(behavioralStories.ownerId, ownerId),
      inArray(behavioralStories.projectKey, stableIds),
    )),
  ]);
  return new Set([...sources, ...evidence, ...stories].map((row) => row.projectId));
}

type ClaimProjectResolution = { projectId: string } | { errorCode: string };

async function resolveClaimProjects(ownerId: string, claimIds: string[]) {
  const stableClaimIds = [...new Set(claimIds)];
  const resolutions = new Map<string, ClaimProjectResolution>();
  if (!stableClaimIds.length) return resolutions;
  const db = getDb();
  const claims = await db.select().from(behavioralClaims).where(and(
    eq(behavioralClaims.ownerId, ownerId),
    inArray(behavioralClaims.claimId, stableClaimIds),
  ));
  const claimById = new Map(claims.map((claim) => [claim.claimId, claim]));
  const evidenceIds = [...new Set(claims.flatMap((claim) => claim.evidenceIds as string[]))];
  const evidence = evidenceIds.length ? await db.select({
    evidenceId: behavioralEvidenceItems.evidenceId,
    projectId: behavioralEvidenceItems.projectKey,
    state: behavioralEvidenceItems.candidateState,
  }).from(behavioralEvidenceItems).where(and(
    eq(behavioralEvidenceItems.ownerId, ownerId),
    inArray(behavioralEvidenceItems.evidenceId, evidenceIds),
  )) : [];
  const evidenceById = new Map(evidence.map((item) => [item.evidenceId, item]));
  for (const claimId of stableClaimIds) {
    const claim = claimById.get(claimId);
    if (!claim || claim.status === "contradicted") {
      resolutions.set(claimId, { errorCode: "behavioral_project_claim_unavailable" });
      continue;
    }
    const linkedEvidenceIds = [...new Set(claim.evidenceIds as string[])];
    if (!linkedEvidenceIds.length) {
      resolutions.set(claimId, { errorCode: "behavioral_project_claim_project_unresolved" });
      continue;
    }
    const linkedEvidence = linkedEvidenceIds.map((evidenceId) => evidenceById.get(evidenceId));
    if (linkedEvidence.some((item) => !item || item.state !== "accepted")) {
      resolutions.set(claimId, { errorCode: "behavioral_project_claim_evidence_unavailable" });
      continue;
    }
    const projects = [...new Set(linkedEvidence.map((item) => item!.projectId))];
    resolutions.set(claimId, projects.length === 1
      ? { projectId: projects[0] }
      : { errorCode: "behavioral_project_claim_project_conflict" });
  }
  return resolutions;
}

async function migrationReview(ownerId: string, afterQuestionId?: string) {
  const db = getDb();
  const questionRows = await db.select().from(ownerBankQuestions).where(and(
    eq(ownerBankQuestions.ownerId, ownerId),
    eq(ownerBankQuestions.specialty, "behavioral"),
    eq(ownerBankQuestions.active, true),
    afterQuestionId ? gt(ownerBankQuestions.questionId, afterQuestionId) : undefined,
  )).orderBy(asc(ownerBankQuestions.questionId)).limit(MIGRATION_REVIEW_LIMIT + 1);
  const questions = questionRows.slice(0, MIGRATION_REVIEW_LIMIT).map(migrationQuestionMetadata);
  const questionIds = questions.map((question) => question.questionId);
  const bindings = questionIds.length ? await db.select().from(behavioralProjectQuestionBindings).where(and(
    eq(behavioralProjectQuestionBindings.ownerId, ownerId),
    inArray(behavioralProjectQuestionBindings.questionId, questionIds),
  )) : [];
  const [knownProjects, claimProjects] = await Promise.all([
    knownProjectIds(ownerId, questions.flatMap((question) => question.projects)),
    resolveClaimProjects(ownerId, questions.flatMap((question) => question.claims)),
  ]);
  const bindingByQuestion = new Map(bindings.map((binding) => [binding.questionId, binding]));
  const review: Array<Record<string, unknown>> = [];
  for (const question of questions) {
    const { isOverview, isClaim } = question;
    if (!isOverview && !isClaim) continue;
    const existing = bindingByQuestion.get(question.questionId);
    if (existing) {
      review.push({ questionId: question.questionId, status: "already_bound", bindingRevision: existing.currentRevision });
      continue;
    }
    if (isOverview && isClaim) {
      review.push({ questionId: question.questionId, status: "needs_review", reason: "conflicting_deep_dive_tags" });
      continue;
    }
    const { projects } = question;
    if (isOverview && projects.length === 0) {
      review.push({ questionId: question.questionId, status: "not_deep_dive", reason: "career_overview_without_project" });
      continue;
    }
    if (projects.length !== 1) {
      review.push({ questionId: question.questionId, status: "needs_review", reason: projects.length ? "multiple_project_ids" : "missing_project_id" });
      continue;
    }
    const projectId = projects[0];
    if (!knownProjects.has(projectId)) {
      review.push({ questionId: question.questionId, status: "needs_review", reason: "unknown_project_id", projectId });
      continue;
    }
    if (isOverview) {
      review.push({ questionId: question.questionId, status: "ready", projectId, focus: "project_overview" });
      continue;
    }
    const { claims } = question;
    if (claims.length !== 1) {
      review.push({ questionId: question.questionId, status: "needs_review", reason: claims.length ? "multiple_source_claim_ids" : "missing_source_claim_id", projectId });
      continue;
    }
    const resolvedClaim = claimProjects.get(claims[0]);
    review.push(resolvedClaim && "projectId" in resolvedClaim && resolvedClaim.projectId === projectId
      ? { questionId: question.questionId, status: "ready", projectId, focus: "resume_claim", sourceClaimId: claims[0] }
      : {
          questionId: question.questionId,
          status: "needs_review",
          reason: resolvedClaim && "errorCode" in resolvedClaim
            ? resolvedClaim.errorCode
            : resolvedClaim ? "source_claim_project_mismatch" : "behavioral_project_claim_unavailable",
          projectId,
        });
  }
  const truncated = questionRows.length > MIGRATION_REVIEW_LIMIT;
  return {
    review,
    truncated,
    nextQuestionCursor: truncated ? questions.at(-1)?.questionId ?? null : null,
  };
}

export async function queryBehavioralProjectDeepDives(ownerId: string, inputValue: unknown) {
  const input = behavioralProjectQuerySchema.parse(inputValue);
  const db = getDb();
  const registry = await projectRegistryRows(ownerId, input.projectId, input.projectAfterId);
  const bindingWhere = and(
    eq(behavioralProjectQuestionBindings.ownerId, ownerId),
    input.projectId ? eq(behavioralProjectQuestionBindings.projectId, input.projectId) : undefined,
    input.questionId ? eq(behavioralProjectQuestionBindings.questionId, input.questionId) : undefined,
    input.includeArchived ? undefined : eq(behavioralProjectQuestionBindings.state, "active"),
  );
  const bindings = await db.select().from(behavioralProjectQuestionBindings)
    .where(bindingWhere).orderBy(asc(behavioralProjectQuestionBindings.projectId), asc(behavioralProjectQuestionBindings.questionId)).limit(51);
  const visibleBindings = bindings.slice(0, 50);
  const questionIds = visibleBindings.map((binding) => binding.questionId);
  const [profiles, activityLinks, bindingRevisions] = await Promise.all([
    questionIds.length ? db.select({
      questionId: problemSolutionProfiles.questionId,
      currentRevision: problemSolutionProfiles.currentRevision,
      title: problemSolutionProfiles.title,
      payload: problemSolutionProfiles.payload,
    }).from(problemSolutionProfiles).where(and(
      eq(problemSolutionProfiles.ownerId, ownerId),
      eq(problemSolutionProfiles.specialty, "behavioral"),
      inArray(problemSolutionProfiles.questionId, questionIds),
    )) : Promise.resolve([]),
    db.select().from(behavioralProjectActivityLinks).where(and(
      eq(behavioralProjectActivityLinks.ownerId, ownerId),
      input.projectId ? eq(behavioralProjectActivityLinks.projectId, input.projectId) : undefined,
      input.questionId ? eq(behavioralProjectActivityLinks.questionId, input.questionId) : undefined,
    )).orderBy(desc(behavioralProjectActivityLinks.linkedAt)).limit(101),
    db.select().from(behavioralProjectQuestionBindingRevisions).where(and(
      eq(behavioralProjectQuestionBindingRevisions.ownerId, ownerId),
      input.projectId ? eq(behavioralProjectQuestionBindingRevisions.projectId, input.projectId) : undefined,
      input.questionId ? eq(behavioralProjectQuestionBindingRevisions.questionId, input.questionId) : undefined,
      input.includeArchived ? undefined : eq(behavioralProjectQuestionBindingRevisions.state, "active"),
    )).orderBy(
      desc(behavioralProjectQuestionBindingRevisions.createdAt),
      desc(behavioralProjectQuestionBindingRevisions.revision),
    ).limit(101),
  ]);
  const profileByQuestion = new Map(profiles.map((profile) => [profile.questionId, profile]));
  const bindingProjection = visibleBindings.map((binding) => {
    const profile = profileByQuestion.get(binding.questionId);
    const missingRequirements = profile
      ? behavioralProjectProfileMissingRequirements(
          profile.payload as { sections: Array<{ sectionKey?: string }>; projectDeepDive?: unknown },
          expectedProjectProfileBinding(binding),
        )
      : [];
    return {
      ...binding,
      solutionProfile: profile ? {
        questionId: profile.questionId,
        currentRevision: profile.currentRevision,
        title: profile.title,
        reusable: missingRequirements.length === 0,
        missingRequirements,
      } : null,
    };
  });
  const migration = input.includeMigrationReview ? await migrationReview(ownerId, input.migrationAfterQuestionId) : null;
  return {
    projects: registry.projects,
    projectsTruncated: registry.truncated,
    nextProjectCursor: registry.truncated ? registry.projects.at(-1)?.projectId ?? null : null,
    bindings: bindingProjection,
    bindingsTruncated: bindings.length > 50,
    bindingRevisions: bindingRevisions.slice(0, 100),
    bindingRevisionsTruncated: bindingRevisions.length > 100,
    activityLinks: activityLinks.slice(0, 100),
    activityLinksTruncated: activityLinks.length > 100,
    learnProjection: bindingProjection.map((binding) => ({
      projectId: binding.projectId,
      questionId: binding.questionId,
      focus: binding.focus,
      ...(binding.sourceClaimId ? { sourceClaimId: binding.sourceClaimId } : {}),
      bindingRevision: binding.currentRevision,
      solutionProfileRevision: binding.solutionProfile?.reusable ? binding.solutionProfile.currentRevision : null,
      solutionProfileReusable: binding.solutionProfile?.reusable ?? false,
    })),
    ...(migration ? {
      migrationReview: migration.review,
      migrationReviewTruncated: migration.truncated,
      nextMigrationQuestionCursor: migration.nextQuestionCursor,
    } : {}),
  };
}
