import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

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

async function projectRegistryRows(ownerId: string) {
  const db = getDb();
  const [sources, evidence, stories] = await Promise.all([
    db.select({ projectId: behavioralEvidenceSources.projectKey }).from(behavioralEvidenceSources)
      .where(eq(behavioralEvidenceSources.ownerId, ownerId)),
    db.select({ projectId: behavioralEvidenceItems.projectKey }).from(behavioralEvidenceItems)
      .where(eq(behavioralEvidenceItems.ownerId, ownerId)),
    db.select({ projectId: behavioralStories.projectKey }).from(behavioralStories)
      .where(eq(behavioralStories.ownerId, ownerId)),
  ]);
  const counts = new Map<string, { sourceCount: number; evidenceCount: number; storyCount: number }>();
  const touch = (projectId: string) => {
    const current = counts.get(projectId) ?? { sourceCount: 0, evidenceCount: 0, storyCount: 0 };
    counts.set(projectId, current);
    return current;
  };
  for (const row of sources) touch(row.projectId).sourceCount += 1;
  for (const row of evidence) touch(row.projectId).evidenceCount += 1;
  for (const row of stories) touch(row.projectId).storyCount += 1;
  return [...counts.entries()].map(([projectId, countsByKind]) => ({ projectId, ...countsByKind }))
    .sort((left, right) => left.projectId.localeCompare(right.projectId));
}

async function assertProjectExists(ownerId: string, projectId: string) {
  const registry = await projectRegistryRows(ownerId);
  if (!registry.some((project) => project.projectId === projectId)) {
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
    const existingIdentity = {
      activityId: existing.activityId,
      questionId: existing.questionId,
      bindingRevision: existing.bindingRevision,
      projectId: existing.projectId,
      focus: existing.focus,
      sourceClaimId: existing.sourceClaimId,
    };
    const immutableIdentity = {
      activityId: identity.activityId,
      questionId: identity.questionId,
      bindingRevision: identity.bindingRevision,
      projectId: identity.projectId,
      focus: identity.focus,
      sourceClaimId: identity.sourceClaimId,
    };
    if (JSON.stringify(existingIdentity) !== JSON.stringify(immutableIdentity)) {
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

async function migrationReview(ownerId: string, registry: Awaited<ReturnType<typeof projectRegistryRows>>) {
  const db = getDb();
  const [questions, bindings] = await Promise.all([
    db.select().from(ownerBankQuestions).where(and(
      eq(ownerBankQuestions.ownerId, ownerId),
      eq(ownerBankQuestions.specialty, "behavioral"),
      eq(ownerBankQuestions.active, true),
    )).orderBy(asc(ownerBankQuestions.questionId)),
    db.select().from(behavioralProjectQuestionBindings).where(eq(behavioralProjectQuestionBindings.ownerId, ownerId)),
  ]);
  const knownProjects = new Set(registry.map((project) => project.projectId));
  const bindingByQuestion = new Map(bindings.map((binding) => [binding.questionId, binding]));
  const review = [];
  for (const question of questions) {
    const tags = tagsOf(question);
    const isOverview = tags.includes("resume-foundation");
    const isClaim = tags.includes("resume-bullet");
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
    const projects = tags.filter((tag) => tag.startsWith("experience:")).map((tag) => tag.slice("experience:".length)).filter(Boolean);
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
    const claims = tags.filter((tag) => tag.startsWith("claim:") || tag.startsWith("resume-claim:"))
      .map((tag) => tag.slice(tag.indexOf(":") + 1)).filter(Boolean);
    if (claims.length !== 1) {
      review.push({ questionId: question.questionId, status: "needs_review", reason: claims.length ? "multiple_source_claim_ids" : "missing_source_claim_id", projectId });
      continue;
    }
    try {
      const resolvedProject = await claimProject(ownerId, claims[0]);
      review.push(resolvedProject === projectId
        ? { questionId: question.questionId, status: "ready", projectId, focus: "resume_claim", sourceClaimId: claims[0] }
        : { questionId: question.questionId, status: "needs_review", reason: "source_claim_project_mismatch", projectId });
    } catch (error) {
      review.push({
        questionId: question.questionId,
        status: "needs_review",
        reason: error instanceof BehavioralProjectDeepDiveError ? error.code : "source_claim_unavailable",
        projectId,
      });
    }
  }
  return review;
}

export async function queryBehavioralProjectDeepDives(ownerId: string, inputValue: unknown) {
  const input = behavioralProjectQuerySchema.parse(inputValue);
  const db = getDb();
  const registry = await projectRegistryRows(ownerId);
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
  const [profiles, activityLinks] = await Promise.all([
    questionIds.length ? db.select({
      questionId: problemSolutionProfiles.questionId,
      currentRevision: problemSolutionProfiles.currentRevision,
      title: problemSolutionProfiles.title,
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
  ]);
  const profileByQuestion = new Map(profiles.map((profile) => [profile.questionId, profile]));
  const bindingProjection = visibleBindings.map((binding) => ({
    ...binding,
    solutionProfile: profileByQuestion.get(binding.questionId) ?? null,
  }));
  return {
    projects: input.projectId ? registry.filter((project) => project.projectId === input.projectId) : registry,
    bindings: bindingProjection,
    bindingsTruncated: bindings.length > 50,
    activityLinks: activityLinks.slice(0, 100),
    activityLinksTruncated: activityLinks.length > 100,
    learnProjection: bindingProjection.map((binding) => ({
      projectId: binding.projectId,
      questionId: binding.questionId,
      focus: binding.focus,
      ...(binding.sourceClaimId ? { sourceClaimId: binding.sourceClaimId } : {}),
      bindingRevision: binding.currentRevision,
      solutionProfileRevision: binding.solutionProfile?.currentRevision ?? null,
    })),
    ...(input.includeMigrationReview ? { migrationReview: await migrationReview(ownerId, registry) } : {}),
  };
}
