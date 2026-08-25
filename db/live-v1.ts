import { and, asc, desc, eq, inArray, notInArray, or, sql } from "drizzle-orm";
import {
  d1TransactionalInvariantGuard,
  isD1TransactionalInvariantFailure,
} from "./d1-transactional-guard";
import {
  prepareVoiceCapturesForFinish,
  voiceFinishGuardMessage,
} from "./durable-practice";
import { getDb } from "./index";
import { dateInPracticeTimeZone } from "./practice-snapshot";
import { reviewIntervalDays, type ReviewReason } from "./review-cadence";
import { foldElapsed, nextTimerState } from "./timer-state";
import {
  activityAudioClips,
  extraActivities,
  liveActivityClips,
  liveActivityLeases,
  liveCandidateEvidenceConfirmations,
  liveMutationReceipts,
  liveOwnerRevisions,
  liveSessions,
  liveTurnPairs,
  liveTurnReservations,
  outcomes,
  practiceFocus,
  practiceWorkbenches,
  practiceTranscriptTurns,
  publicationStatuses,
  reviewSchedules,
  timerIntervals,
  timers,
  voiceCaptureIntents,
  voiceResponseGroupMembers,
  voiceResponseGroups,
  voiceSpecialistResponses,
} from "./schema";

export const LIVE_LEASE_TTL_MS = 90_000;

type LiveDb = ReturnType<typeof getDb>;
type LiveDbStatement = Parameters<LiveDb["batch"]>[0][number];

export class LiveV1Error extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "LiveV1Error";
  }
}

export type LiveLeaseIdentity = {
  holderId: string;
  holderSessionId: string;
  fencingToken: number;
};

type StoredLiveReceipt = {
  protocolVersion: 1;
  operationId: string;
  activityId: string;
  operation: string;
  committedAt: number;
  result: Record<string, unknown>;
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  )).join(",")}}`;
}

export async function liveRequestDigest(value: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type ActivityPayload = {
  id: string;
  questionId?: string;
  date: string;
  source?: string;
  type: "leetcode" | "system_design" | "behavioral";
  title: string;
  prompt?: string;
  allocatedSeconds: number;
  sessionId?: string | null;
  reviewOfActivityId?: string;
  reviewReason?: ReviewReason;
};

type SessionPayload = {
  id: string;
  date?: string;
  label?: string;
  activityIds: string[];
  allocatedSeconds?: number;
};

function timerProjection(row: typeof timers.$inferSelect | undefined) {
  if (!row) return null;
  return {
    accumulatedSeconds: row.accumulatedSeconds,
    startedAt: row.startedAt,
    runningSince: row.runningSince,
    completed: row.completed,
    completedAt: row.completedAt,
    revision: row.revision,
  };
}

type LiveRoomActivityType = "system_design" | "leetcode" | "behavioral";

function isLiveRoomActivityType(type: unknown): type is LiveRoomActivityType {
  return type === "system_design" || type === "leetcode" || type === "behavioral";
}

function validActivity(payload: unknown): payload is ActivityPayload {
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as Partial<ActivityPayload>;
  return typeof candidate.id === "string"
    && typeof candidate.date === "string"
    && ["leetcode", "system_design", "behavioral"].includes(String(candidate.type))
    && typeof candidate.title === "string"
    && typeof candidate.allocatedSeconds === "number";
}

function validSession(payload: unknown): payload is SessionPayload {
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as Partial<SessionPayload>;
  return typeof candidate.id === "string"
    && Array.isArray(candidate.activityIds)
    && candidate.activityIds.every((id) => typeof id === "string");
}

async function loadOpenWorkbench(ownerId: string, detailActivityId = "") {
  const db = getDb();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const workbenches = await db.select().from(practiceWorkbenches).where(and(
      eq(practiceWorkbenches.ownerId, ownerId),
      eq(practiceWorkbenches.status, "open"),
    )).orderBy(desc(practiceWorkbenches.openedAt)).limit(1);
    const candidateWorkbench = workbenches[0];
    if (!candidateWorkbench) return null;

    // D1 batch statements execute in one transaction. Reading every projection
    // dependency here prevents a timer/pair/lease mutation from producing a
    // mixed resume bundle assembled from different database moments.
    const statements: LiveDbStatement[] = [
      db.select().from(practiceWorkbenches).where(and(
        eq(practiceWorkbenches.ownerId, ownerId),
        eq(practiceWorkbenches.id, candidateWorkbench.id),
        eq(practiceWorkbenches.status, "open"),
        eq(practiceWorkbenches.updatedAt, candidateWorkbench.updatedAt),
      )),
      db.select().from(extraActivities).where(and(
        eq(extraActivities.ownerId, ownerId),
        eq(extraActivities.workbenchId, candidateWorkbench.id),
      )).orderBy(asc(extraActivities.updatedAt), asc(extraActivities.id)),
      db.select().from(liveSessions).where(and(
        eq(liveSessions.ownerId, ownerId),
        eq(liveSessions.workbenchId, candidateWorkbench.id),
      )).orderBy(asc(liveSessions.updatedAt), asc(liveSessions.id)),
      db.select().from(practiceFocus).where(eq(practiceFocus.ownerId, ownerId)),
      db.select().from(liveOwnerRevisions).where(eq(liveOwnerRevisions.ownerId, ownerId)),
      db.select().from(timers).where(eq(timers.ownerId, ownerId)),
      db.select().from(outcomes).where(eq(outcomes.ownerId, ownerId)),
      db.select().from(liveTurnPairs).where(and(
        eq(liveTurnPairs.ownerId, ownerId),
        eq(liveTurnPairs.activityId, detailActivityId),
      )).orderBy(asc(liveTurnPairs.candidateSequence)),
      db.select().from(liveActivityClips).where(and(
        eq(liveActivityClips.ownerId, ownerId),
        eq(liveActivityClips.activityId, detailActivityId),
      )).orderBy(asc(liveActivityClips.createdAt), asc(liveActivityClips.clipId)),
      db.select().from(liveActivityLeases).where(and(
        eq(liveActivityLeases.ownerId, ownerId),
        eq(liveActivityLeases.activityId, detailActivityId),
      )),
      db.select().from(practiceTranscriptTurns).where(and(
        eq(practiceTranscriptTurns.ownerId, ownerId),
        eq(practiceTranscriptTurns.activityId, detailActivityId),
      )).orderBy(asc(practiceTranscriptTurns.sequence), asc(practiceTranscriptTurns.occurredAt)),
    ];
    const snapshot = await db.batch(statements as [LiveDbStatement, ...LiveDbStatement[]]);
    const workbenchRows = snapshot[0] as unknown as (typeof practiceWorkbenches.$inferSelect)[];
    const workbench = workbenchRows[0];
    if (!workbench) continue;
    const activityRows = snapshot[1] as unknown as (typeof extraActivities.$inferSelect)[];
    const sessionRows = snapshot[2] as unknown as (typeof liveSessions.$inferSelect)[];
    const focusRows = snapshot[3] as unknown as (typeof practiceFocus.$inferSelect)[];
    const revisionRows = snapshot[4] as unknown as (typeof liveOwnerRevisions.$inferSelect)[];
    const allTimerRows = snapshot[5] as unknown as (typeof timers.$inferSelect)[];
    const allOutcomeRows = snapshot[6] as unknown as (typeof outcomes.$inferSelect)[];
    const pairRows = snapshot[7] as unknown as (typeof liveTurnPairs.$inferSelect)[];
    const clipRows = snapshot[8] as unknown as (typeof liveActivityClips.$inferSelect)[];
    const leaseRows = snapshot[9] as unknown as (typeof liveActivityLeases.$inferSelect)[];
    const transcriptRows = snapshot[10] as unknown as (typeof practiceTranscriptTurns.$inferSelect)[];
    const activities = activityRows.flatMap((row) => validActivity(row.payload)
      ? [{ row, payload: row.payload }]
      : []);
    const activityIds = new Set(activities.map(({ row }) => row.id));
    const sessions = sessionRows.flatMap((row) => validSession(row.payload)
      ? [{
          row,
          payload: {
            ...row.payload,
            activityIds: row.payload.activityIds.filter((activityId) => activityIds.has(activityId)),
          },
        }]
      : []);
    const subjectIds = new Set([
      ...activities.map(({ row }) => row.id),
      ...sessions.map(({ row }) => row.id),
    ]);
    const timerRows = allTimerRows.filter((row) => subjectIds.has(row.subjectId));
    const outcomeRows = allOutcomeRows.filter((row) => activityIds.has(row.activityId));
    const timerByKey = new Map(timerRows.map((row) => [`${row.kind}:${row.subjectId}`, row]));
    const outcomeByActivity = new Map(outcomeRows.map((row) => [row.activityId, row]));
    const canonicalSessionByActivity = new Map<string, string>();
    const canonicalActivityOrder = new Map<string, number>();
    let nextActivityOrder = 0;
    sessions.forEach(({ row, payload }) => payload.activityIds.forEach((activityId) => {
      if (!canonicalSessionByActivity.has(activityId)) canonicalSessionByActivity.set(activityId, row.id);
      if (!canonicalActivityOrder.has(activityId)) {
        canonicalActivityOrder.set(activityId, nextActivityOrder);
        nextActivityOrder += 1;
      }
    }));
    activities.forEach(({ row }) => {
      if (!canonicalActivityOrder.has(row.id)) {
        canonicalActivityOrder.set(row.id, nextActivityOrder);
        nextActivityOrder += 1;
      }
    });
    activities.sort((left, right) => (
      (canonicalActivityOrder.get(left.row.id) ?? Number.MAX_SAFE_INTEGER)
      - (canonicalActivityOrder.get(right.row.id) ?? Number.MAX_SAFE_INTEGER)
    ));
    return {
      workbench,
      activities,
      sessions,
      focus: focusRows[0] ?? null,
      ownerRevision: revisionRows[0]?.revision ?? 0,
      timerByKey,
      outcomeByActivity,
      canonicalSessionByActivity,
      pairRows,
      clipRows,
      leaseRows,
      transcriptRows,
    };
  }
  throw new LiveV1Error(
    "revision_conflict",
    "The open workbench changed while the projection was being read. Retry the snapshot.",
    409,
    true,
  );
}

function activityProjection(
  loaded: NonNullable<Awaited<ReturnType<typeof loadOpenWorkbench>>>,
  item: (typeof loaded.activities)[number],
) {
  const timer = loaded.timerByKey.get(`activity:${item.row.id}`);
  const result = loaded.outcomeByActivity.get(item.row.id);
  const sessionId = loaded.canonicalSessionByActivity.get(item.row.id)
    ?? item.payload.sessionId
    ?? null;
  return {
    id: item.row.id,
    questionId: item.payload.questionId ?? null,
    date: item.payload.date,
    source: item.payload.source ?? null,
    type: item.payload.type,
    title: item.payload.title,
    prompt: item.payload.prompt ?? null,
    allocatedSeconds: item.payload.allocatedSeconds,
    sessionId,
    lifecycle: timer?.completed ? "completed" : timer?.startedAt ? "running" : "planned",
    revision: item.row.revision,
    timer: timerProjection(timer),
    result: {
      value: result?.outcome ?? null,
      revision: result?.revision ?? 0,
    },
  };
}

function workbenchProjection(loaded: NonNullable<Awaited<ReturnType<typeof loadOpenWorkbench>>>) {
  return {
    id: loaded.workbench.id,
    revision: loaded.workbench.updatedAt,
    openedPacificDate: loaded.workbench.openedPacificDate,
    openedAt: loaded.workbench.openedAt,
  };
}

function focusProjection(loaded: NonNullable<Awaited<ReturnType<typeof loadOpenWorkbench>>>) {
  return {
    activityId: loaded.focus?.activityId ?? null,
    sessionId: loaded.focus?.sessionId ?? null,
    focusedAt: loaded.focus?.focusedAt ?? null,
  };
}

function sessionProjection(
  loaded: NonNullable<Awaited<ReturnType<typeof loadOpenWorkbench>>>,
  item: (typeof loaded.sessions)[number],
) {
  return {
    id: item.row.id,
    label: item.payload.label ?? item.row.id,
    activityIds: item.payload.activityIds,
    allocatedSeconds: item.payload.allocatedSeconds ?? null,
    revision: item.row.revision,
    timer: timerProjection(loaded.timerByKey.get(`session:${item.row.id}`)),
  };
}

function emptyTodayProjection(now: number, revision: number) {
  return {
    protocolVersion: 1 as const,
    serverTime: now,
    ownerRevision: revision,
    workbench: null,
    focus: { activityId: null, sessionId: null, focusedAt: null },
    sessions: [],
    activities: [],
  };
}

function todayProjection(
  loaded: NonNullable<Awaited<ReturnType<typeof loadOpenWorkbench>>>,
  now: number,
) {
  return {
    protocolVersion: 1 as const,
    serverTime: now,
    ownerRevision: loaded.ownerRevision,
    workbench: workbenchProjection(loaded),
    focus: focusProjection(loaded),
    sessions: loaded.sessions.map((item) => sessionProjection(loaded, item)),
    activities: loaded.activities
      .filter(({ row }) => !loaded.timerByKey.get(`activity:${row.id}`)?.completed)
      .map((item) => activityProjection(loaded, item)),
  };
}

function detailedActivityProjection(
  loaded: NonNullable<Awaited<ReturnType<typeof loadOpenWorkbench>>>,
  activityId: string,
  now: number,
) {
  const item = loaded.activities.find(({ row }) => row.id === activityId);
  if (!item || !isLiveRoomActivityType(item.payload.type)) return null;
  const { pairRows, clipRows, leaseRows, transcriptRows } = loaded;
  const sessionId = loaded.canonicalSessionByActivity.get(activityId)
    ?? item.payload.sessionId
    ?? null;
  const session = sessionId
    ? loaded.sessions.find(({ row }) => row.id === sessionId)
    : undefined;
  const lease = leaseRows[0];
  const leaseActive = Boolean(lease?.holderId && lease.expiresAt && lease.expiresAt > now);
  const transcriptById = new Map(transcriptRows.map((turn) => [turn.turnId, turn]));
  const pairs = pairRows.flatMap((pair) => {
    const candidateTurn = transcriptById.get(pair.candidateTurnId);
    const interviewerTurn = transcriptById.get(pair.interviewerTurnId);
    if (!candidateTurn
        || !interviewerTurn
        || candidateTurn.speaker !== "user"
        || interviewerTurn.speaker !== "specialist"
        || candidateTurn.sequence + 1 !== interviewerTurn.sequence) return [];
    const evidenceSatisfied = pair.candidateEvidenceStatus === "verified"
      || pair.candidateEvidenceStatus === "best_available"
      || pair.evidenceConfirmedAt != null;
    return [{
      pairId: pair.pairId,
      candidate: {
        turnId: candidateTurn.turnId,
        text: candidateTurn.body,
        evidenceStatus: pair.candidateEvidenceStatus,
        evidenceConfirmedAt: pair.evidenceConfirmedAt,
        evidenceSatisfied,
        occurredAt: candidateTurn.occurredAt,
        sequence: candidateTurn.sequence,
      },
      interviewer: {
        turnId: interviewerTurn.turnId,
        displayMarkdown: interviewerTurn.body,
        spokenText: pair.interviewerSpokenText,
        occurredAt: interviewerTurn.occurredAt,
        sequence: interviewerTurn.sequence,
      },
      clipId: pair.clipId,
      committedAt: pair.createdAt,
    }];
  });
  return {
    protocolVersion: 1 as const,
    serverTime: now,
    ownerRevision: loaded.ownerRevision,
    workbench: workbenchProjection(loaded),
    focus: focusProjection(loaded),
    session: session ? sessionProjection(loaded, session) : null,
    activity: {
      ...activityProjection(loaded, item),
      textEvidenceSatisfied: pairs.some((pair) => pair.candidate.evidenceSatisfied),
    },
    lease: {
      active: leaseActive,
      holderPresent: leaseActive,
      expiresAt: leaseActive ? lease!.expiresAt : null,
    },
    pairs,
    clips: clipRows.map((clip) => ({
      clipId: clip.clipId,
      candidateTurnId: clip.candidateTurnId,
      pairId: clip.pairId,
      mimeType: clip.expectedMimeType,
      byteSize: clip.expectedByteSize,
      sha256: clip.expectedSha256,
      status: clip.status,
      failureCode: clip.failureCode,
      createdAt: clip.createdAt,
      updatedAt: clip.updatedAt,
    })),
  };
}

export async function readLiveTodayProjection(ownerId: string, now = Date.now()) {
  const loaded = await loadOpenWorkbench(ownerId);
  return loaded
    ? todayProjection(loaded, now)
    : emptyTodayProjection(now, await ownerRevision(ownerId));
}

export async function readLiveActivityProjection(ownerId: string, activityId: string, now = Date.now()) {
  const loaded = await loadOpenWorkbench(ownerId, activityId);
  return loaded ? detailedActivityProjection(loaded, activityId, now) : null;
}

export async function readLiveCommandProjection(ownerId: string, activityId: string, now = Date.now()) {
  const loaded = await loadOpenWorkbench(ownerId, activityId);
  if (!loaded) {
    return {
      activity: null,
      today: emptyTodayProjection(now, await ownerRevision(ownerId)),
    };
  }
  return {
    activity: detailedActivityProjection(loaded, activityId, now),
    today: todayProjection(loaded, now),
  };
}

function liveActivityInvariant(ownerId: string, activityId: string) {
  const db = getDb();
  return d1TransactionalInvariantGuard(db, sql`EXISTS (
    SELECT 1
    FROM ${extraActivities}
    INNER JOIN ${practiceWorkbenches}
      ON ${practiceWorkbenches.ownerId} = ${extraActivities.ownerId}
      AND ${practiceWorkbenches.id} = ${extraActivities.workbenchId}
    WHERE ${extraActivities.ownerId} = ${ownerId}
      AND ${extraActivities.id} = ${activityId}
      AND ${practiceWorkbenches.status} = 'open'
      AND json_extract(${extraActivities.payload}, '$.type') IN ('system_design', 'leetcode', 'behavioral')
  )`);
}

function leaseInvariant(
  ownerId: string,
  activityId: string,
  lease: typeof liveActivityLeases.$inferSelect | undefined,
) {
  const db = getDb();
  if (!lease) {
    return d1TransactionalInvariantGuard(db, sql`NOT EXISTS (
      SELECT 1 FROM ${liveActivityLeases}
      WHERE ${liveActivityLeases.ownerId} = ${ownerId}
        AND ${liveActivityLeases.activityId} = ${activityId}
    )`);
  }
  return d1TransactionalInvariantGuard(db, sql`EXISTS (
    SELECT 1 FROM ${liveActivityLeases}
    WHERE ${liveActivityLeases.ownerId} = ${ownerId}
      AND ${liveActivityLeases.activityId} = ${activityId}
      AND ${liveActivityLeases.fencingToken} = ${lease.fencingToken}
      AND COALESCE(${liveActivityLeases.holderId}, '') = ${lease.holderId ?? ""}
      AND COALESCE(${liveActivityLeases.holderSessionId}, '') = ${lease.holderSessionId ?? ""}
      AND COALESCE(${liveActivityLeases.expiresAt}, 0) = ${lease.expiresAt ?? 0}
  )`);
}

function currentLeaseInvariant(
  ownerId: string,
  activityId: string,
  identity: LiveLeaseIdentity,
) {
  const db = getDb();
  return d1TransactionalInvariantGuard(db, sql`EXISTS (
    SELECT 1 FROM ${liveActivityLeases}
    WHERE ${liveActivityLeases.ownerId} = ${ownerId}
      AND ${liveActivityLeases.activityId} = ${activityId}
      AND ${liveActivityLeases.holderId} = ${identity.holderId}
      AND ${liveActivityLeases.holderSessionId} = ${identity.holderSessionId}
      AND ${liveActivityLeases.fencingToken} = ${identity.fencingToken}
      AND ${liveActivityLeases.expiresAt}
        > CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
  )`);
}

function transcriptPairInvariant(input: {
  ownerId: string;
  activityId: string;
  pairId: string;
  candidateTurnId: string;
  interviewerTurnId: string;
  latestSequence: number;
}) {
  const db = getDb();
  return d1TransactionalInvariantGuard(db, sql`
    COALESCE((
      SELECT MAX(${practiceTranscriptTurns.sequence})
      FROM ${practiceTranscriptTurns}
      WHERE ${practiceTranscriptTurns.ownerId} = ${input.ownerId}
        AND ${practiceTranscriptTurns.activityId} = ${input.activityId}
    ), -1) = ${input.latestSequence}
    AND NOT EXISTS (
      SELECT 1 FROM ${practiceTranscriptTurns}
      WHERE ${practiceTranscriptTurns.ownerId} = ${input.ownerId}
        AND ${practiceTranscriptTurns.activityId} = ${input.activityId}
        AND ${practiceTranscriptTurns.turnId} IN (${input.candidateTurnId}, ${input.interviewerTurnId})
    )
    AND NOT EXISTS (
      SELECT 1 FROM ${liveTurnReservations}
      WHERE ${liveTurnReservations.ownerId} = ${input.ownerId}
        AND ${liveTurnReservations.activityId} = ${input.activityId}
        AND (
          ${liveTurnReservations.turnId} IN (${input.candidateTurnId}, ${input.interviewerTurnId})
          OR ${liveTurnReservations.pairId} = ${input.pairId}
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM ${liveTurnPairs}
      WHERE ${liveTurnPairs.ownerId} = ${input.ownerId}
        AND ${liveTurnPairs.activityId} = ${input.activityId}
        AND (
          ${liveTurnPairs.pairId} = ${input.pairId}
          OR ${liveTurnPairs.candidateTurnId} IN (${input.candidateTurnId}, ${input.interviewerTurnId})
          OR ${liveTurnPairs.interviewerTurnId} IN (${input.candidateTurnId}, ${input.interviewerTurnId})
        )
    )
  `);
}

function ownerRevisionStatement(ownerId: string, now: number) {
  return getDb().insert(liveOwnerRevisions).values({
    ownerId,
    revision: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: liveOwnerRevisions.ownerId,
    set: {
      revision: sql`CASE
        WHEN ${liveOwnerRevisions.revision} >= ${now}
          THEN ${liveOwnerRevisions.revision} + 1
        ELSE ${now}
      END`,
      updatedAt: now,
    },
  });
}

function receiptInsert(
  ownerId: string,
  activityId: string,
  operationId: string,
  operation: string,
  requestDigest: string,
  receipt: StoredLiveReceipt,
) {
  return getDb().insert(liveMutationReceipts).values({
    ownerId,
    activityId,
    operationId,
    operation,
    requestDigest,
    receipt,
    createdAt: receipt.committedAt,
  });
}

async function ownerRevision(ownerId: string) {
  const rows = await getDb().select().from(liveOwnerRevisions).where(
    eq(liveOwnerRevisions.ownerId, ownerId),
  );
  return rows[0]?.revision ?? 0;
}

async function leaseRow(ownerId: string, activityId: string) {
  const rows = await getDb().select().from(liveActivityLeases).where(and(
    eq(liveActivityLeases.ownerId, ownerId),
    eq(liveActivityLeases.activityId, activityId),
  ));
  return rows[0];
}

export async function readLiveMutationReceipt(
  ownerId: string,
  activityId: string,
  operationId: string,
) {
  const rows = await getDb().select().from(liveMutationReceipts).where(and(
    eq(liveMutationReceipts.ownerId, ownerId),
    eq(liveMutationReceipts.activityId, activityId),
    eq(liveMutationReceipts.operationId, operationId),
  ));
  const row = rows[0];
  return row ? {
    operation: row.operation,
    requestDigest: row.requestDigest,
    receipt: row.receipt as StoredLiveReceipt,
  } : null;
}

async function receiptReplay(
  ownerId: string,
  activityId: string,
  operationId: string,
  operation: string,
  requestDigest: string,
) {
  const existing = await readLiveMutationReceipt(ownerId, activityId, operationId);
  if (!existing) return null;
  if (existing.operation !== operation || existing.requestDigest !== requestDigest) {
    throw new LiveV1Error(
      "idempotency_conflict",
      "That operation identifier was already used for different Live content.",
      409,
      false,
    );
  }
  return existing.receipt;
}

function leaseHeld(lease: typeof liveActivityLeases.$inferSelect): never {
  throw new LiveV1Error(
    "lease_held",
    "Another Live room currently holds this activity lease.",
    409,
    false,
    { holderPresent: true, expiresAt: lease.expiresAt },
  );
}

function leaseConflict(): never {
  throw new LiveV1Error(
    "lease_conflict",
    "The Live writer lease is stale, expired, or belongs to another room.",
    409,
    true,
  );
}

async function requireLiveActivity(ownerId: string, activityId: string) {
  const projection = await readLiveActivityProjection(ownerId, activityId);
  if (!projection || !isLiveRoomActivityType(projection.activity.type)) {
    throw new LiveV1Error(
      "activity_not_found",
      "The activity is unavailable in the current workbench.",
      404,
      false,
    );
  }
  return projection;
}

type LiveMutationCommit = {
  duplicate: boolean;
  receipt: StoredLiveReceipt;
  ownerRevision: number;
};

export function acquireLiveActivityLease(input: {
  ownerId: string;
  activityId: string;
  operationId: string;
  holderId: string;
  holderSessionId: string;
  requestDigest: string;
  now: number;
}): Promise<LiveMutationCommit> {
  return acquireLiveActivityLeaseAttempt(input, 0);
}

async function acquireLiveActivityLeaseAttempt(input: {
  ownerId: string;
  activityId: string;
  operationId: string;
  holderId: string;
  holderSessionId: string;
  requestDigest: string;
  now: number;
}, attempt: number): Promise<LiveMutationCommit> {
  const operation = "lease.acquire";
  const replay = await receiptReplay(
    input.ownerId,
    input.activityId,
    input.operationId,
    operation,
    input.requestDigest,
  );
  if (replay) return { duplicate: true, receipt: replay, ownerRevision: await ownerRevision(input.ownerId) };
  await requireLiveActivity(input.ownerId, input.activityId);

  const existing = await leaseRow(input.ownerId, input.activityId);
  const active = Boolean(existing?.holderId && existing.expiresAt && existing.expiresAt > input.now);
  if (active && (
    existing!.holderId !== input.holderId
    || existing!.holderSessionId !== input.holderSessionId
  )) leaseHeld(existing!);

  const fencingToken = active ? existing!.fencingToken : (existing?.fencingToken ?? 0) + 1;
  const expiresAt = active ? existing!.expiresAt! : input.now + LIVE_LEASE_TTL_MS;
  const receipt: StoredLiveReceipt = {
    protocolVersion: 1,
    operationId: input.operationId,
    activityId: input.activityId,
    operation,
    committedAt: input.now,
    result: {
      lease: {
        fencingToken,
        expiresAt,
        holderSessionId: input.holderSessionId,
      },
    },
  };
  const db = getDb();
  const statements: Parameters<typeof db.batch>[0][number][] = [
    liveActivityInvariant(input.ownerId, input.activityId),
    leaseInvariant(input.ownerId, input.activityId, existing),
  ];
  if (active) {
    statements.push(currentLeaseInvariant(input.ownerId, input.activityId, {
      holderId: input.holderId,
      holderSessionId: input.holderSessionId,
      fencingToken,
    }));
  }
  if (!active) {
    statements.push(db.insert(liveActivityLeases).values({
      ownerId: input.ownerId,
      activityId: input.activityId,
      holderId: input.holderId,
      holderSessionId: input.holderSessionId,
      fencingToken,
      expiresAt,
      acquiredAt: input.now,
      renewedAt: input.now,
      updatedAt: input.now,
    }).onConflictDoUpdate({
      target: [liveActivityLeases.ownerId, liveActivityLeases.activityId],
      set: {
        holderId: input.holderId,
        holderSessionId: input.holderSessionId,
        fencingToken,
        expiresAt,
        acquiredAt: input.now,
        renewedAt: input.now,
        updatedAt: input.now,
      },
    }));
  }
  statements.push(
    receiptInsert(
      input.ownerId,
      input.activityId,
      input.operationId,
      operation,
      input.requestDigest,
      receipt,
    ),
    ownerRevisionStatement(input.ownerId, input.now),
  );
  try {
    await db.batch(statements as [typeof statements[number], ...typeof statements[number][]]);
  } catch (error) {
    const committed = await receiptReplay(
      input.ownerId,
      input.activityId,
      input.operationId,
      operation,
      input.requestDigest,
    );
    if (committed) return { duplicate: true, receipt: committed, ownerRevision: await ownerRevision(input.ownerId) };
    if (isD1TransactionalInvariantFailure(error)) {
      const latest = await leaseRow(input.ownerId, input.activityId);
      const retryNow = Date.now();
      if (latest?.holderId && latest.expiresAt && latest.expiresAt > retryNow) {
        if (latest.holderId !== input.holderId
            || latest.holderSessionId !== input.holderSessionId) leaseHeld(latest);
      }
      if (attempt < 2) {
        return acquireLiveActivityLeaseAttempt({ ...input, now: retryNow }, attempt + 1);
      }
      leaseConflict();
    }
    throw error;
  }
  return { duplicate: false, receipt, ownerRevision: await ownerRevision(input.ownerId) };
}

function hasCurrentLease(
  lease: typeof liveActivityLeases.$inferSelect | undefined,
  identity: LiveLeaseIdentity,
  now: number,
) {
  return Boolean(
    lease?.holderId === identity.holderId
    && lease.holderSessionId === identity.holderSessionId
    && lease.fencingToken === identity.fencingToken
    && lease.expiresAt
    && lease.expiresAt > now,
  );
}

async function mutateCurrentLease(input: {
  ownerId: string;
  activityId: string;
  operationId: string;
  operation: "lease.renew" | "lease.release";
  identity: LiveLeaseIdentity;
  requestDigest: string;
  now: number;
}) {
  const replay = await receiptReplay(
    input.ownerId,
    input.activityId,
    input.operationId,
    input.operation,
    input.requestDigest,
  );
  if (replay) return { duplicate: true, receipt: replay, ownerRevision: await ownerRevision(input.ownerId) };
  await requireLiveActivity(input.ownerId, input.activityId);
  const existing = await leaseRow(input.ownerId, input.activityId);
  if (!hasCurrentLease(existing, input.identity, input.now)) leaseConflict();

  const expiresAt = input.operation === "lease.renew"
    ? input.now + LIVE_LEASE_TTL_MS
    : null;
  const receipt: StoredLiveReceipt = {
    protocolVersion: 1,
    operationId: input.operationId,
    activityId: input.activityId,
    operation: input.operation,
    committedAt: input.now,
    result: {
      lease: {
        fencingToken: input.identity.fencingToken,
        expiresAt,
        holderSessionId: input.identity.holderSessionId,
      },
    },
  };
  const statements = [
    liveActivityInvariant(input.ownerId, input.activityId),
    leaseInvariant(input.ownerId, input.activityId, existing),
    currentLeaseInvariant(input.ownerId, input.activityId, input.identity),
    getDb().update(liveActivityLeases).set(input.operation === "lease.renew" ? {
      expiresAt,
      renewedAt: input.now,
      updatedAt: input.now,
    } : {
      holderId: null,
      holderSessionId: null,
      expiresAt: null,
      renewedAt: input.now,
      updatedAt: input.now,
    }).where(and(
      eq(liveActivityLeases.ownerId, input.ownerId),
      eq(liveActivityLeases.activityId, input.activityId),
    )),
    receiptInsert(
      input.ownerId,
      input.activityId,
      input.operationId,
      input.operation,
      input.requestDigest,
      receipt,
    ),
    ownerRevisionStatement(input.ownerId, input.now),
  ];
  try {
    await getDb().batch(statements as [typeof statements[number], ...typeof statements[number][]]);
  } catch (error) {
    const committed = await receiptReplay(
      input.ownerId,
      input.activityId,
      input.operationId,
      input.operation,
      input.requestDigest,
    );
    if (committed) return { duplicate: true, receipt: committed, ownerRevision: await ownerRevision(input.ownerId) };
    if (isD1TransactionalInvariantFailure(error)) leaseConflict();
    throw error;
  }
  return { duplicate: false, receipt, ownerRevision: await ownerRevision(input.ownerId) };
}

export function renewLiveActivityLease(input: {
  ownerId: string;
  activityId: string;
  operationId: string;
  identity: LiveLeaseIdentity;
  requestDigest: string;
  now: number;
}) {
  return mutateCurrentLease({ ...input, operation: "lease.renew" });
}

export function releaseLiveActivityLease(input: {
  ownerId: string;
  activityId: string;
  operationId: string;
  identity: LiveLeaseIdentity;
  requestDigest: string;
  now: number;
}) {
  return mutateCurrentLease({ ...input, operation: "lease.release" });
}

export type LiveCandidateEvidenceStatus =
  | "verified"
  | "best_available"
  | "possible_contamination";

export type CommitLiveTurnPairInput = {
  ownerId: string;
  activityId: string;
  operationId: string;
  identity: LiveLeaseIdentity;
  pairId: string;
  candidate: {
    turnId: string;
    text: string;
    evidenceStatus: LiveCandidateEvidenceStatus;
    occurredAt: number;
  };
  interviewer: {
    turnId: string;
    displayMarkdown: string;
    spokenText: string;
    occurredAt: number;
  };
  clipId?: string;
  requestDigest: string;
  now: number;
};

async function pairIdentityExists(input: CommitLiveTurnPairInput) {
  const db = getDb();
  const ids = [input.candidate.turnId, input.interviewer.turnId];
  const [pairs, reservations, transcript] = await Promise.all([
    db.select({ pairId: liveTurnPairs.pairId }).from(liveTurnPairs).where(and(
      eq(liveTurnPairs.ownerId, input.ownerId),
      eq(liveTurnPairs.activityId, input.activityId),
      or(
        eq(liveTurnPairs.pairId, input.pairId),
        inArray(liveTurnPairs.candidateTurnId, ids),
        inArray(liveTurnPairs.interviewerTurnId, ids),
      ),
    )).limit(1),
    db.select({ turnId: liveTurnReservations.turnId }).from(liveTurnReservations).where(and(
      eq(liveTurnReservations.ownerId, input.ownerId),
      eq(liveTurnReservations.activityId, input.activityId),
      or(
        eq(liveTurnReservations.pairId, input.pairId),
        inArray(liveTurnReservations.turnId, ids),
      ),
    )).limit(1),
    db.select({ turnId: practiceTranscriptTurns.turnId }).from(practiceTranscriptTurns).where(and(
      eq(practiceTranscriptTurns.ownerId, input.ownerId),
      eq(practiceTranscriptTurns.activityId, input.activityId),
      inArray(practiceTranscriptTurns.turnId, ids),
    )).limit(1),
  ]);
  return Boolean(pairs[0] || reservations[0] || transcript[0]);
}

function pairIdentityConflict(): never {
  throw new LiveV1Error(
    "idempotency_conflict",
    "A stable Live pair or turn identity already belongs to immutable evidence.",
    409,
    false,
  );
}

export async function commitLiveTurnPair(
  input: CommitLiveTurnPairInput,
): Promise<LiveMutationCommit> {
  const operation = "turn_pair.commit";
  const replay = await receiptReplay(
    input.ownerId,
    input.activityId,
    input.operationId,
    operation,
    input.requestDigest,
  );
  if (replay) return { duplicate: true, receipt: replay, ownerRevision: await ownerRevision(input.ownerId) };
  const projection = await requireLiveActivity(input.ownerId, input.activityId);
  const lease = await leaseRow(input.ownerId, input.activityId);
  if (!hasCurrentLease(lease, input.identity, input.now)) leaseConflict();
  if (input.candidate.turnId === input.interviewer.turnId || await pairIdentityExists(input)) {
    pairIdentityConflict();
  }

  const db = getDb();
  const latestRows = await db.select({ sequence: practiceTranscriptTurns.sequence })
    .from(practiceTranscriptTurns)
    .where(and(
      eq(practiceTranscriptTurns.ownerId, input.ownerId),
      eq(practiceTranscriptTurns.activityId, input.activityId),
    ))
    .orderBy(desc(practiceTranscriptTurns.sequence))
    .limit(1);
  const latestSequence = latestRows[0]?.sequence ?? -1;
  const candidateSequence = latestSequence + 1;
  const interviewerSequence = latestSequence + 2;
  const candidateClipRows = await db.select().from(liveActivityClips).where(and(
    eq(liveActivityClips.ownerId, input.ownerId),
    eq(liveActivityClips.activityId, input.activityId),
    eq(liveActivityClips.candidateTurnId, input.candidate.turnId),
  ));
  const candidateClip = candidateClipRows[0];
  const clip = input.clipId
    ? candidateClipRows.find((candidate) => candidate.clipId === input.clipId)
    : candidateClip?.status === "abandoned" ? undefined : candidateClip;
  if (input.clipId && (
    !clip
    || clip.candidateTurnId !== input.candidate.turnId
    || (clip.pairId != null && clip.pairId !== input.pairId)
    || clip.status === "abandoned"
  )) {
    throw new LiveV1Error(
      "idempotency_conflict",
      "The staged clip identity or candidate association does not match this pair.",
      409,
      false,
    );
  }

  const receipt: StoredLiveReceipt = {
    protocolVersion: 1,
    operationId: input.operationId,
    activityId: input.activityId,
    operation,
    committedAt: input.now,
    result: {
      pairId: input.pairId,
      candidateSequence,
      interviewerSequence,
    },
  };
  const statements: Parameters<typeof db.batch>[0][number][] = [
    liveActivityInvariant(input.ownerId, input.activityId),
    currentLeaseInvariant(input.ownerId, input.activityId, input.identity),
    transcriptPairInvariant({
      ownerId: input.ownerId,
      activityId: input.activityId,
      pairId: input.pairId,
      candidateTurnId: input.candidate.turnId,
      interviewerTurnId: input.interviewer.turnId,
      latestSequence,
    }),
    db.insert(liveTurnReservations).values([
      {
        ownerId: input.ownerId,
        activityId: input.activityId,
        turnId: input.candidate.turnId,
        pairId: input.pairId,
        side: "candidate",
        sequence: candidateSequence,
        createdAt: input.now,
      },
      {
        ownerId: input.ownerId,
        activityId: input.activityId,
        turnId: input.interviewer.turnId,
        pairId: input.pairId,
        side: "interviewer",
        sequence: interviewerSequence,
        createdAt: input.now,
      },
    ]),
    db.insert(practiceTranscriptTurns).values([
      {
        ownerId: input.ownerId,
        activityId: input.activityId,
        turnId: input.candidate.turnId,
        specialty: projection.activity.type,
        speaker: "user",
        body: input.candidate.text,
        source: "audio_transcript",
        sequence: candidateSequence,
        occurredAt: input.candidate.occurredAt,
        updatedAt: input.now,
      },
      {
        ownerId: input.ownerId,
        activityId: input.activityId,
        turnId: input.interviewer.turnId,
        specialty: projection.activity.type,
        speaker: "specialist",
        body: input.interviewer.displayMarkdown,
        source: "codex",
        sequence: interviewerSequence,
        occurredAt: input.interviewer.occurredAt,
        updatedAt: input.now,
      },
    ]),
    db.insert(liveTurnPairs).values({
      ownerId: input.ownerId,
      activityId: input.activityId,
      pairId: input.pairId,
      candidateTurnId: input.candidate.turnId,
      interviewerTurnId: input.interviewer.turnId,
      candidateText: input.candidate.text,
      candidateEvidenceStatus: input.candidate.evidenceStatus,
      interviewerDisplayMarkdown: input.interviewer.displayMarkdown,
      interviewerSpokenText: input.interviewer.spokenText,
      candidateOccurredAt: input.candidate.occurredAt,
      interviewerOccurredAt: input.interviewer.occurredAt,
      candidateSequence,
      interviewerSequence,
      clipId: clip?.clipId ?? null,
      requestDigest: input.requestDigest,
      evidenceConfirmedAt: null,
      createdAt: input.now,
    }),
  ];
  if (candidateClip) {
    statements.splice(2, 0, clipInvariant(candidateClip));
  } else {
    statements.splice(2, 0, d1TransactionalInvariantGuard(db, sql`NOT EXISTS (
      SELECT 1 FROM ${liveActivityClips}
      WHERE ${liveActivityClips.ownerId} = ${input.ownerId}
        AND ${liveActivityClips.activityId} = ${input.activityId}
        AND ${liveActivityClips.candidateTurnId} = ${input.candidate.turnId}
    )`));
  }
  if (clip) {
    statements.push(db.update(liveActivityClips).set({
      pairId: input.pairId,
      updatedAt: input.now,
    }).where(and(
      eq(liveActivityClips.ownerId, input.ownerId),
      eq(liveActivityClips.activityId, input.activityId),
      eq(liveActivityClips.clipId, clip.clipId),
    )));
  }
  statements.push(
    receiptInsert(
      input.ownerId,
      input.activityId,
      input.operationId,
      operation,
      input.requestDigest,
      receipt,
    ),
    ownerRevisionStatement(input.ownerId, input.now),
  );
  try {
    await db.batch(statements as [typeof statements[number], ...typeof statements[number][]]);
  } catch (error) {
    const committed = await receiptReplay(
      input.ownerId,
      input.activityId,
      input.operationId,
      operation,
      input.requestDigest,
    );
    if (committed) return { duplicate: true, receipt: committed, ownerRevision: await ownerRevision(input.ownerId) };
    const latestLease = await leaseRow(input.ownerId, input.activityId);
    if (!hasCurrentLease(latestLease, input.identity, Date.now())) leaseConflict();
    if (await pairIdentityExists(input)) pairIdentityConflict();
    if (isD1TransactionalInvariantFailure(error)) {
      throw new LiveV1Error(
        "revision_conflict",
        "The canonical transcript order changed while the pair was committing. Reread before retrying.",
        409,
        true,
      );
    }
    throw error;
  }
  return { duplicate: false, receipt, ownerRevision: await ownerRevision(input.ownerId) };
}

export type StageLiveClipInput = {
  ownerId: string;
  activityId: string;
  operationId: string;
  identity: LiveLeaseIdentity;
  clipId: string;
  candidateTurnId: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  requestDigest: string;
  now: number;
};

export async function readLiveClipStorage(
  ownerId: string,
  activityId: string,
  clipId: string,
) {
  const rows = await getDb().select().from(liveActivityClips).where(and(
    eq(liveActivityClips.ownerId, ownerId),
    eq(liveActivityClips.activityId, activityId),
    eq(liveActivityClips.clipId, clipId),
  ));
  return rows[0] ?? null;
}

function clipInvariant(clip: typeof liveActivityClips.$inferSelect) {
  const db = getDb();
  return d1TransactionalInvariantGuard(db, sql`EXISTS (
    SELECT 1 FROM ${liveActivityClips}
    WHERE ${liveActivityClips.ownerId} = ${clip.ownerId}
      AND ${liveActivityClips.activityId} = ${clip.activityId}
      AND ${liveActivityClips.clipId} = ${clip.clipId}
      AND ${liveActivityClips.candidateTurnId} = ${clip.candidateTurnId}
      AND COALESCE(${liveActivityClips.pairId}, '') = ${clip.pairId ?? ""}
      AND ${liveActivityClips.expectedMimeType} = ${clip.expectedMimeType}
      AND ${liveActivityClips.expectedByteSize} = ${clip.expectedByteSize}
      AND ${liveActivityClips.expectedSha256} = ${clip.expectedSha256}
      AND ${liveActivityClips.status} = ${clip.status}
      AND COALESCE(${liveActivityClips.uploadOperationId}, '') = ${clip.uploadOperationId ?? ""}
      AND COALESCE(${liveActivityClips.uploadRequestDigest}, '') = ${clip.uploadRequestDigest ?? ""}
      AND COALESCE(${liveActivityClips.uploadHolderId}, '') = ${clip.uploadHolderId ?? ""}
      AND COALESCE(${liveActivityClips.uploadHolderSessionId}, '') = ${clip.uploadHolderSessionId ?? ""}
      AND COALESCE(${liveActivityClips.uploadFencingToken}, 0) = ${clip.uploadFencingToken ?? 0}
  )`);
}

function pairClipInvariant(pair: typeof liveTurnPairs.$inferSelect) {
  const db = getDb();
  return d1TransactionalInvariantGuard(db, sql`EXISTS (
    SELECT 1 FROM ${liveTurnPairs}
    WHERE ${liveTurnPairs.ownerId} = ${pair.ownerId}
      AND ${liveTurnPairs.activityId} = ${pair.activityId}
      AND ${liveTurnPairs.pairId} = ${pair.pairId}
      AND ${liveTurnPairs.candidateTurnId} = ${pair.candidateTurnId}
      AND COALESCE(${liveTurnPairs.clipId}, '') = ${pair.clipId ?? ""}
  )`);
}

function clipIdentityMatches(clip: typeof liveActivityClips.$inferSelect, input: StageLiveClipInput) {
  return clip.candidateTurnId === input.candidateTurnId
    && clip.expectedMimeType === input.mimeType
    && clip.expectedByteSize === input.byteSize
    && clip.expectedSha256 === input.sha256;
}

function clipIdentityConflict(): never {
  throw new LiveV1Error(
    "idempotency_conflict",
    "That immutable Live clip identity already has different metadata or association.",
    409,
    false,
  );
}

export async function stageLiveClip(input: StageLiveClipInput): Promise<LiveMutationCommit> {
  const operation = "clip.stage";
  const replay = await receiptReplay(
    input.ownerId,
    input.activityId,
    input.operationId,
    operation,
    input.requestDigest,
  );
  if (replay) return { duplicate: true, receipt: replay, ownerRevision: await ownerRevision(input.ownerId) };
  await requireLiveActivity(input.ownerId, input.activityId);
  const lease = await leaseRow(input.ownerId, input.activityId);
  if (!hasCurrentLease(lease, input.identity, input.now)) leaseConflict();
  const db = getDb();
  const existing = await readLiveClipStorage(input.ownerId, input.activityId, input.clipId);
  const candidateClipRows = await db.select().from(liveActivityClips).where(and(
    eq(liveActivityClips.ownerId, input.ownerId),
    eq(liveActivityClips.activityId, input.activityId),
    eq(liveActivityClips.candidateTurnId, input.candidateTurnId),
  ));
  if ((existing && !clipIdentityMatches(existing, input))
      || (!existing && candidateClipRows[0])) clipIdentityConflict();

  const pairRows = await db.select().from(liveTurnPairs).where(and(
    eq(liveTurnPairs.ownerId, input.ownerId),
    eq(liveTurnPairs.activityId, input.activityId),
    eq(liveTurnPairs.candidateTurnId, input.candidateTurnId),
  ));
  const pair = pairRows[0];
  const pairId = existing?.pairId ?? pair?.pairId ?? null;
  if ((existing?.pairId && pair && existing.pairId !== pair.pairId)
      || (pair?.clipId && pair.clipId !== input.clipId)) clipIdentityConflict();
  const receipt: StoredLiveReceipt = {
    protocolVersion: 1,
    operationId: input.operationId,
    activityId: input.activityId,
    operation,
    committedAt: input.now,
    result: {
      clipId: input.clipId,
      status: existing?.status ?? "staged",
    },
  };
  const statements: Parameters<typeof db.batch>[0][number][] = [
    liveActivityInvariant(input.ownerId, input.activityId),
    currentLeaseInvariant(input.ownerId, input.activityId, input.identity),
  ];
  if (existing) {
    statements.push(clipInvariant(existing));
  } else {
    statements.push(
      d1TransactionalInvariantGuard(db, sql`NOT EXISTS (
        SELECT 1 FROM ${liveActivityClips}
        WHERE ${liveActivityClips.ownerId} = ${input.ownerId}
          AND ${liveActivityClips.activityId} = ${input.activityId}
          AND (
            ${liveActivityClips.clipId} = ${input.clipId}
            OR ${liveActivityClips.candidateTurnId} = ${input.candidateTurnId}
          )
      )`),
      db.insert(liveActivityClips).values({
        ownerId: input.ownerId,
        activityId: input.activityId,
        clipId: input.clipId,
        candidateTurnId: input.candidateTurnId,
        pairId,
        expectedMimeType: input.mimeType,
        expectedByteSize: input.byteSize,
        expectedSha256: input.sha256,
        objectKey: `live/${input.ownerId}/${input.activityId}/${input.clipId}`,
        status: "staged",
        createdAt: input.now,
        updatedAt: input.now,
      }),
    );
  }
  if (pair) {
    statements.push(
      pairClipInvariant(pair),
      db.update(liveTurnPairs).set({ clipId: input.clipId }).where(and(
        eq(liveTurnPairs.ownerId, input.ownerId),
        eq(liveTurnPairs.activityId, input.activityId),
        eq(liveTurnPairs.pairId, pair.pairId),
      )),
    );
    if (existing && existing.pairId !== pair.pairId) {
      statements.push(db.update(liveActivityClips).set({
        pairId: pair.pairId,
        updatedAt: input.now,
      }).where(and(
        eq(liveActivityClips.ownerId, input.ownerId),
        eq(liveActivityClips.activityId, input.activityId),
        eq(liveActivityClips.clipId, input.clipId),
      )));
    }
  } else {
    statements.push(d1TransactionalInvariantGuard(db, sql`NOT EXISTS (
      SELECT 1 FROM ${liveTurnPairs}
      WHERE ${liveTurnPairs.ownerId} = ${input.ownerId}
        AND ${liveTurnPairs.activityId} = ${input.activityId}
        AND ${liveTurnPairs.candidateTurnId} = ${input.candidateTurnId}
    )`));
  }
  statements.push(
    receiptInsert(
      input.ownerId,
      input.activityId,
      input.operationId,
      operation,
      input.requestDigest,
      receipt,
    ),
    ownerRevisionStatement(input.ownerId, input.now),
  );
  try {
    await db.batch(statements as [typeof statements[number], ...typeof statements[number][]]);
  } catch (error) {
    const committed = await receiptReplay(
      input.ownerId,
      input.activityId,
      input.operationId,
      operation,
      input.requestDigest,
    );
    if (committed) return { duplicate: true, receipt: committed, ownerRevision: await ownerRevision(input.ownerId) };
    const latestLease = await leaseRow(input.ownerId, input.activityId);
    if (!hasCurrentLease(latestLease, input.identity, Date.now())) leaseConflict();
    const latestClip = await readLiveClipStorage(input.ownerId, input.activityId, input.clipId);
    if (latestClip && !clipIdentityMatches(latestClip, input)) clipIdentityConflict();
    const latestCandidateClips = await db.select().from(liveActivityClips).where(and(
      eq(liveActivityClips.ownerId, input.ownerId),
      eq(liveActivityClips.activityId, input.activityId),
      eq(liveActivityClips.candidateTurnId, input.candidateTurnId),
    )).limit(1);
    if (latestCandidateClips[0]?.clipId !== input.clipId && latestCandidateClips[0]) {
      clipIdentityConflict();
    }
    if (isD1TransactionalInvariantFailure(error)) {
      throw new LiveV1Error(
        "revision_conflict",
        "The clip association changed while it was being staged. Reread before retrying.",
        409,
        true,
      );
    }
    throw error;
  }
  return {
    duplicate: false,
    receipt,
    ownerRevision: await ownerRevision(input.ownerId),
  };
}

export type LiveClipUploadInput = {
  ownerId: string;
  activityId: string;
  clipId: string;
  operationId: string;
  identity: LiveLeaseIdentity;
  mimeType: string;
  byteSize: number;
  sha256: string;
  requestDigest: string;
  now: number;
};

export type LiveClipUploadClaim = {
  duplicate: boolean;
  receipt: StoredLiveReceipt | null;
  ownerRevision: number;
  clip: typeof liveActivityClips.$inferSelect;
};

function requireUploadMetadata(
  clip: typeof liveActivityClips.$inferSelect,
  input: LiveClipUploadInput,
) {
  if (clip.expectedMimeType !== input.mimeType
      || clip.expectedByteSize !== input.byteSize
      || clip.expectedSha256 !== input.sha256) clipIdentityConflict();
  if (clip.status === "abandoned") {
    throw new LiveV1Error(
      "idempotency_conflict",
      "An abandoned Live clip cannot be uploaded.",
      409,
      false,
    );
  }
}

function uploadReceipt(input: LiveClipUploadInput): StoredLiveReceipt {
  return {
    protocolVersion: 1,
    operationId: input.operationId,
    activityId: input.activityId,
    operation: "clip.upload",
    committedAt: input.now,
    result: { clipId: input.clipId, status: "available" },
  };
}

export async function beginLiveClipUpload(input: LiveClipUploadInput): Promise<LiveClipUploadClaim> {
  const operation = "clip.upload";
  const replay = await receiptReplay(
    input.ownerId,
    input.activityId,
    input.operationId,
    operation,
    input.requestDigest,
  );
  if (replay) {
    const clip = await readLiveClipStorage(input.ownerId, input.activityId, input.clipId);
    if (!clip) clipIdentityConflict();
    return { duplicate: true, receipt: replay, ownerRevision: await ownerRevision(input.ownerId), clip };
  }
  await requireLiveActivity(input.ownerId, input.activityId);
  const lease = await leaseRow(input.ownerId, input.activityId);
  if (!hasCurrentLease(lease, input.identity, input.now)) leaseConflict();
  const clip = await readLiveClipStorage(input.ownerId, input.activityId, input.clipId);
  if (!clip) {
    throw new LiveV1Error("clip_not_found", "Stage the clip before uploading content.", 404, false);
  }
  requireUploadMetadata(clip, input);
  if (clip.uploadOperationId === input.operationId
      && clip.uploadRequestDigest
      && clip.uploadRequestDigest !== input.requestDigest) {
    throw new LiveV1Error(
      "idempotency_conflict",
      "That immutable clip upload operation already has a different request digest.",
      409,
      false,
    );
  }
  const db = getDb();
  if (clip.status === "available") {
    // A different operation ID is a new upload attempt, not an exact replay.
    // The Worker must consume and checksum its stream before this operation can
    // receive a receipt, even though the immutable object is already available.
    return { duplicate: false, receipt: null, ownerRevision: await ownerRevision(input.ownerId), clip };
  }
  const sameUploadWriter = clip.uploadHolderId === input.identity.holderId
    && clip.uploadHolderSessionId === input.identity.holderSessionId
    && clip.uploadFencingToken === input.identity.fencingToken;
  if (clip.status === "uploading"
      && sameUploadWriter
      && (clip.uploadOperationId !== input.operationId
        || clip.uploadRequestDigest !== input.requestDigest)) {
    throw new LiveV1Error(
      "clip_upload_in_progress",
      "Another immutable upload operation is already streaming this clip.",
      409,
      true,
    );
  }
  if (clip.status !== "uploading" || !sameUploadWriter) {
    const statements: Parameters<typeof db.batch>[0][number][] = [
      liveActivityInvariant(input.ownerId, input.activityId),
      currentLeaseInvariant(input.ownerId, input.activityId, input.identity),
      clipInvariant(clip),
      db.update(liveActivityClips).set({
        status: "uploading",
        uploadOperationId: input.operationId,
        uploadRequestDigest: input.requestDigest,
        uploadHolderId: input.identity.holderId,
        uploadHolderSessionId: input.identity.holderSessionId,
        uploadFencingToken: input.identity.fencingToken,
        failureCode: null,
        updatedAt: input.now,
      }).where(and(
        eq(liveActivityClips.ownerId, input.ownerId),
        eq(liveActivityClips.activityId, input.activityId),
        eq(liveActivityClips.clipId, input.clipId),
      )),
      ownerRevisionStatement(input.ownerId, input.now),
    ];
    try {
      await db.batch(statements as [typeof statements[number], ...typeof statements[number][]]);
    } catch (error) {
      const committed = await receiptReplay(
        input.ownerId,
        input.activityId,
        input.operationId,
        operation,
        input.requestDigest,
      );
      if (committed) {
        const available = await readLiveClipStorage(input.ownerId, input.activityId, input.clipId);
        if (!available) clipIdentityConflict();
        return { duplicate: true, receipt: committed, ownerRevision: await ownerRevision(input.ownerId), clip: available };
      }
      if (isD1TransactionalInvariantFailure(error)) {
        const latestLease = await leaseRow(input.ownerId, input.activityId);
        if (!hasCurrentLease(latestLease, input.identity, Date.now())) leaseConflict();
        throw new LiveV1Error(
          "clip_upload_in_progress",
          "The clip upload claim changed. Reread before retrying the exact operation.",
          409,
          true,
        );
      }
      throw error;
    }
  }
  const claimed = await readLiveClipStorage(input.ownerId, input.activityId, input.clipId);
  if (!claimed) clipIdentityConflict();
  return { duplicate: false, receipt: null, ownerRevision: await ownerRevision(input.ownerId), clip: claimed };
}

export async function completeLiveClipUpload(input: LiveClipUploadInput): Promise<LiveMutationCommit> {
  const operation = "clip.upload";
  const replay = await receiptReplay(
    input.ownerId,
    input.activityId,
    input.operationId,
    operation,
    input.requestDigest,
  );
  if (replay) return { duplicate: true, receipt: replay, ownerRevision: await ownerRevision(input.ownerId) };
  const lease = await leaseRow(input.ownerId, input.activityId);
  if (!hasCurrentLease(lease, input.identity, input.now)) leaseConflict();
  const clip = await readLiveClipStorage(input.ownerId, input.activityId, input.clipId);
  const claimedUpload = clip?.status === "uploading"
    && clip.uploadOperationId === input.operationId
    && clip.uploadRequestDigest === input.requestDigest
    && clip.uploadHolderId === input.identity.holderId
    && clip.uploadHolderSessionId === input.identity.holderSessionId
    && clip.uploadFencingToken === input.identity.fencingToken;
  if (!clip || (clip.status !== "available" && !claimedUpload)) clipIdentityConflict();
  const receipt = uploadReceipt(input);
  const db = getDb();
  const statements: Parameters<typeof db.batch>[0][number][] = [
    liveActivityInvariant(input.ownerId, input.activityId),
    currentLeaseInvariant(input.ownerId, input.activityId, input.identity),
    clipInvariant(clip),
  ];
  if (claimedUpload) {
    statements.push(db.update(liveActivityClips).set({
        status: "available",
        failureCode: null,
        updatedAt: input.now,
      }).where(and(
        eq(liveActivityClips.ownerId, input.ownerId),
        eq(liveActivityClips.activityId, input.activityId),
        eq(liveActivityClips.clipId, input.clipId),
      )));
  }
  statements.push(
    receiptInsert(
      input.ownerId,
      input.activityId,
      input.operationId,
      operation,
      input.requestDigest,
      receipt,
    ),
    ownerRevisionStatement(input.ownerId, input.now),
  );
  try {
    await db.batch(statements as [typeof statements[number], ...typeof statements[number][]]);
  } catch (error) {
    const committed = await receiptReplay(
      input.ownerId,
      input.activityId,
      input.operationId,
      operation,
      input.requestDigest,
    );
    if (committed) return { duplicate: true, receipt: committed, ownerRevision: await ownerRevision(input.ownerId) };
    const latestLease = await leaseRow(input.ownerId, input.activityId);
    if (!hasCurrentLease(latestLease, input.identity, Date.now())) leaseConflict();
    if (isD1TransactionalInvariantFailure(error)) {
      throw new LiveV1Error(
        "revision_conflict",
        "The clip upload state changed before finalization. Reread before retrying.",
        409,
        true,
      );
    }
    throw error;
  }
  return { duplicate: false, receipt, ownerRevision: await ownerRevision(input.ownerId) };
}

export async function failLiveClipUpload(input: {
  ownerId: string;
  activityId: string;
  clipId: string;
  operationId: string;
  identity: LiveLeaseIdentity;
  requestDigest: string;
  failureCode: string;
  now: number;
}) {
  const lease = await leaseRow(input.ownerId, input.activityId);
  if (!hasCurrentLease(lease, input.identity, input.now)) leaseConflict();
  const clip = await readLiveClipStorage(input.ownerId, input.activityId, input.clipId);
  if (!clip || clip.status === "available" || clip.status === "abandoned") {
    return ownerRevision(input.ownerId);
  }
  if (clip.uploadOperationId !== input.operationId
      || clip.uploadRequestDigest !== input.requestDigest
      || clip.uploadHolderId !== input.identity.holderId
      || clip.uploadHolderSessionId !== input.identity.holderSessionId
      || clip.uploadFencingToken !== input.identity.fencingToken) return ownerRevision(input.ownerId);
  const db = getDb();
  const statements: Parameters<typeof db.batch>[0][number][] = [
    currentLeaseInvariant(input.ownerId, input.activityId, input.identity),
    clipInvariant(clip),
    db.update(liveActivityClips).set({
      status: "failed",
      failureCode: input.failureCode.slice(0, 80),
      updatedAt: input.now,
    }).where(and(
      eq(liveActivityClips.ownerId, input.ownerId),
      eq(liveActivityClips.activityId, input.activityId),
      eq(liveActivityClips.clipId, input.clipId),
    )),
    ownerRevisionStatement(input.ownerId, input.now),
  ];
  try {
    await db.batch(statements as [typeof statements[number], ...typeof statements[number][]]);
  } catch (error) {
    if (!isD1TransactionalInvariantFailure(error)) throw error;
  }
  return ownerRevision(input.ownerId);
}

export type LiveActivityCommand =
  | "start"
  | "pause"
  | "finish"
  | "set_result"
  | "clear_result"
  | "confirm_candidate_evidence"
  | "finish-next";

export type LiveResult = "solved" | "solved_after_reviewing_approach" | "failed";

export type LiveActivityCommandInput = {
  ownerId: string;
  activityId: string;
  operationId: string;
  command: LiveActivityCommand;
  identity: LiveLeaseIdentity;
  expectedWorkbenchRevision: number;
  expectedTimerRevision?: number;
  expectedResultRevision?: number;
  expectedNextTimerRevision?: number;
  nextActivityId?: string;
  result?: LiveResult;
  pairId?: string;
  requestDigest: string;
  now: number;
};

export type LiveActivityCommandCommit = LiveMutationCommit & {
  selectedNextActivityId: string | null;
};

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function workbenchRevisionInvariant(
  ownerId: string,
  workbenchId: string,
  expectedRevision: number,
) {
  const db = getDb();
  return d1TransactionalInvariantGuard(db, sql`EXISTS (
    SELECT 1 FROM ${practiceWorkbenches}
    WHERE ${practiceWorkbenches.ownerId} = ${ownerId}
      AND ${practiceWorkbenches.id} = ${workbenchId}
      AND ${practiceWorkbenches.status} = 'open'
      AND ${practiceWorkbenches.updatedAt} = ${expectedRevision}
  )`);
}

function timerRevisionInvariant(
  ownerId: string,
  subjectId: string,
  kind: "activity" | "session",
  expectedRevision: number,
) {
  const db = getDb();
  return d1TransactionalInvariantGuard(db, sql`COALESCE((
    SELECT ${timers.revision} FROM ${timers}
    WHERE ${timers.ownerId} = ${ownerId}
      AND ${timers.subjectId} = ${subjectId}
      AND ${timers.kind} = ${kind}
  ), 0) = ${expectedRevision}`);
}

function timerSnapshotInvariant(timer: typeof timers.$inferSelect) {
  const db = getDb();
  return d1TransactionalInvariantGuard(db, sql`EXISTS (
    SELECT 1 FROM ${timers}
    WHERE ${timers.ownerId} = ${timer.ownerId}
      AND ${timers.subjectId} = ${timer.subjectId}
      AND ${timers.kind} = ${timer.kind}
      AND ${timers.revision} = ${timer.revision}
      AND COALESCE(${timers.runningSince}, 0) = ${timer.runningSince ?? 0}
      AND ${timers.completed} = ${timer.completed}
  )`);
}

function outcomeRevisionInvariant(
  ownerId: string,
  activityId: string,
  expectedRevision: number,
) {
  const db = getDb();
  return d1TransactionalInvariantGuard(db, sql`COALESCE((
    SELECT ${outcomes.revision} FROM ${outcomes}
    WHERE ${outcomes.ownerId} = ${ownerId}
      AND ${outcomes.activityId} = ${activityId}
  ), 0) = ${expectedRevision}`);
}

function pauseTimerStatements(timer: typeof timers.$inferSelect, now: number): LiveDbStatement[] {
  const db = getDb();
  return [
    timerSnapshotInvariant(timer),
    db.update(timerIntervals).set({ endedAt: now }).where(and(
      eq(timerIntervals.ownerId, timer.ownerId),
      eq(timerIntervals.subjectId, timer.subjectId),
      eq(timerIntervals.kind, timer.kind),
      sql`${timerIntervals.endedAt} IS NULL`,
    )),
    db.update(timers).set({
      accumulatedSeconds: foldElapsed(timer.accumulatedSeconds, timer.runningSince, now),
      runningSince: null,
      revision: timer.revision + 1,
      updatedAt: now,
    }).where(and(
      eq(timers.ownerId, timer.ownerId),
      eq(timers.subjectId, timer.subjectId),
      eq(timers.kind, timer.kind),
      eq(timers.revision, timer.revision),
    )),
  ];
}

function pauseRunningTimersStatements(
  ownerId: string,
  kind: "activity" | "session",
  now: number,
  exceptSubjectIds: string[],
): LiveDbStatement[] {
  const db = getDb();
  const timerExclusion = exceptSubjectIds.length
    ? notInArray(timers.subjectId, exceptSubjectIds)
    : undefined;
  const intervalExclusion = exceptSubjectIds.length
    ? notInArray(timerIntervals.subjectId, exceptSubjectIds)
    : undefined;
  return [
    db.update(timerIntervals).set({ endedAt: now }).where(and(
      eq(timerIntervals.ownerId, ownerId),
      eq(timerIntervals.kind, kind),
      sql`${timerIntervals.endedAt} IS NULL`,
      intervalExclusion,
      sql`EXISTS (
        SELECT 1 FROM ${timers}
        WHERE ${timers.ownerId} = ${ownerId}
          AND ${timers.subjectId} = ${timerIntervals.subjectId}
          AND ${timers.kind} = ${kind}
          AND ${timers.runningSince} IS NOT NULL
      )`,
    )),
    db.update(timers).set({
      accumulatedSeconds: sql`${timers.accumulatedSeconds} + MAX(
        0,
        CAST((${now} - COALESCE(${timers.runningSince}, ${now})) / 1000 AS INTEGER)
      )`,
      runningSince: null,
      revision: sql`${timers.revision} + 1`,
      updatedAt: now,
    }).where(and(
      eq(timers.ownerId, ownerId),
      eq(timers.kind, kind),
      sql`${timers.runningSince} IS NOT NULL`,
      timerExclusion,
    )),
  ];
}

function startTimerStatements(
  ownerId: string,
  subjectId: string,
  kind: "activity" | "session",
  existing: typeof timers.$inferSelect | undefined,
  now: number,
): LiveDbStatement[] {
  if (existing?.runningSince) return [timerSnapshotInvariant(existing)];
  const db = getDb();
  const expectedRevision = existing?.revision ?? 0;
  const next = nextTimerState(existing, "start", now);
  return [
    timerRevisionInvariant(ownerId, subjectId, kind, expectedRevision),
    db.insert(timers).values({
      ownerId,
      subjectId,
      kind,
      accumulatedSeconds: next.accumulatedSeconds,
      startedAt: existing?.startedAt ?? now,
      runningSince: now,
      completed: false,
      completedAt: null,
      revision: next.revision,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [timers.ownerId, timers.subjectId, timers.kind],
      set: {
        accumulatedSeconds: next.accumulatedSeconds,
        startedAt: existing?.startedAt ?? now,
        runningSince: now,
        completed: false,
        completedAt: null,
        revision: next.revision,
        updatedAt: now,
      },
      setWhere: eq(timers.revision, expectedRevision),
    }),
    db.insert(timerIntervals).values({ ownerId, subjectId, kind, startedAt: now })
      .onConflictDoNothing(),
  ];
}

function finishTimerStatements(timer: typeof timers.$inferSelect, now: number): LiveDbStatement[] {
  const db = getDb();
  const next = nextTimerState(timer, "finish", now);
  return [
    timerSnapshotInvariant(timer),
    db.update(timerIntervals).set({ endedAt: now }).where(and(
      eq(timerIntervals.ownerId, timer.ownerId),
      eq(timerIntervals.subjectId, timer.subjectId),
      eq(timerIntervals.kind, timer.kind),
      sql`${timerIntervals.endedAt} IS NULL`,
    )),
    db.update(timers).set({
      accumulatedSeconds: next.accumulatedSeconds,
      runningSince: null,
      completed: true,
      completedAt: now,
      revision: next.revision,
      updatedAt: now,
    }).where(and(
      eq(timers.ownerId, timer.ownerId),
      eq(timers.subjectId, timer.subjectId),
      eq(timers.kind, timer.kind),
      eq(timers.revision, timer.revision),
    )),
  ];
}

function unfinishedSessionChildren(
  ownerId: string,
  activityIds: string[],
) {
  return sql`EXISTS (
    SELECT 1
    FROM json_each(${JSON.stringify(activityIds)}) AS child
    WHERE NOT EXISTS (
      SELECT 1 FROM ${timers}
      WHERE ${timers.ownerId} = ${ownerId}
        AND ${timers.subjectId} = CAST(child.value AS TEXT)
        AND ${timers.kind} = 'activity'
        AND ${timers.completed} = 1
    )
  )`;
}

function finishSessionWhenChildrenCompleteStatements(
  ownerId: string,
  sessionId: string,
  activityIds: string[],
  now: number,
): LiveDbStatement[] {
  const db = getDb();
  const hasUnfinishedChild = unfinishedSessionChildren(ownerId, activityIds);
  return [
    db.update(timerIntervals).set({ endedAt: now }).where(and(
      eq(timerIntervals.ownerId, ownerId),
      eq(timerIntervals.subjectId, sessionId),
      eq(timerIntervals.kind, "session"),
      sql`${timerIntervals.endedAt} IS NULL`,
      sql`NOT (${hasUnfinishedChild})`,
    )),
    db.update(timers).set({
      accumulatedSeconds: sql`${timers.accumulatedSeconds} + MAX(
        0,
        CAST((${now} - COALESCE(${timers.runningSince}, ${now})) / 1000 AS INTEGER)
      )`,
      runningSince: null,
      completed: true,
      completedAt: now,
      revision: sql`${timers.revision} + 1`,
      updatedAt: now,
    }).where(and(
      eq(timers.ownerId, ownerId),
      eq(timers.subjectId, sessionId),
      eq(timers.kind, "session"),
      sql`${timers.startedAt} IS NOT NULL`,
      eq(timers.completed, false),
      sql`NOT (${hasUnfinishedChild})`,
    )),
  ];
}

function voiceFinishInvariant(ownerId: string, activityId: string) {
  const db = getDb();
  return d1TransactionalInvariantGuard(db, sql`NOT EXISTS (
    SELECT 1 FROM ${voiceCaptureIntents} AS intent
    WHERE intent.owner_id = ${ownerId}
      AND intent.activity_id = ${activityId}
      AND (
        intent.status IN ('activity_related', 'uncertain', 'deleting', 'quarantined_conflict')
        OR (intent.status = 'accepted' AND (
          NOT EXISTS (
            SELECT 1 FROM ${activityAudioClips} AS clip
            WHERE clip.owner_id = intent.owner_id
              AND clip.id = intent.clip_id
              AND (
                clip.status = 'available'
                OR (clip.status = 'audio_lost' AND clip.audio_lost_acknowledged_at IS NOT NULL)
              )
          )
          OR NOT (
            EXISTS (
              SELECT 1
              FROM ${voiceSpecialistResponses} AS response
              WHERE response.owner_id = intent.owner_id
                AND response.capture_id = intent.capture_id
                AND response.activity_id = intent.activity_id
                AND response.specialty = intent.specialty
                AND response.status = 'materialized'
                AND EXISTS (
                  SELECT 1 FROM ${practiceTranscriptTurns} AS user_turn
                  WHERE user_turn.owner_id = intent.owner_id
                    AND user_turn.activity_id = intent.activity_id
                    AND user_turn.turn_id = response.user_turn_id
                    AND user_turn.speaker = 'user'
                    AND user_turn.source = 'audio_transcript'
                )
                AND EXISTS (
                  SELECT 1 FROM ${practiceTranscriptTurns} AS specialist_turn
                  WHERE specialist_turn.owner_id = intent.owner_id
                    AND specialist_turn.activity_id = intent.activity_id
                    AND specialist_turn.turn_id = response.response_turn_id
                    AND specialist_turn.speaker = 'specialist'
                    AND specialist_turn.source = 'codex'
                    AND specialist_turn.body = response.response_body
                )
            )
            OR EXISTS (
              SELECT 1
              FROM ${voiceResponseGroupMembers} AS member
              INNER JOIN ${voiceResponseGroups} AS response_group
                ON response_group.owner_id = member.owner_id
                AND response_group.response_turn_id = member.response_turn_id
              WHERE member.owner_id = intent.owner_id
                AND member.capture_id = intent.capture_id
                AND member.activity_id = intent.activity_id
                AND response_group.activity_id = intent.activity_id
                AND response_group.specialty = intent.specialty
                AND response_group.status = 'materialized'
                AND EXISTS (
                  SELECT 1 FROM ${practiceTranscriptTurns} AS user_turn
                  WHERE user_turn.owner_id = intent.owner_id
                    AND user_turn.activity_id = intent.activity_id
                    AND user_turn.turn_id = member.user_turn_id
                    AND user_turn.speaker = 'user'
                    AND user_turn.source = 'audio_transcript'
                )
                AND EXISTS (
                  SELECT 1 FROM ${practiceTranscriptTurns} AS specialist_turn
                  WHERE specialist_turn.owner_id = intent.owner_id
                    AND specialist_turn.activity_id = intent.activity_id
                    AND specialist_turn.turn_id = response_group.response_turn_id
                    AND specialist_turn.speaker = 'specialist'
                    AND specialist_turn.source = 'codex'
                    AND specialist_turn.body = response_group.response_body
                )
            )
          )
        ))
      )
  )`);
}

function candidateEvidenceInvariant(ownerId: string, activityId: string) {
  const db = getDb();
  return d1TransactionalInvariantGuard(db, sql`EXISTS (
    SELECT 1 FROM ${liveTurnPairs}
    WHERE ${liveTurnPairs.ownerId} = ${ownerId}
      AND ${liveTurnPairs.activityId} = ${activityId}
      AND (
        ${liveTurnPairs.candidateEvidenceStatus} IN ('verified', 'best_available')
        OR ${liveTurnPairs.evidenceConfirmedAt} IS NOT NULL
      )
  )`);
}

function discardPendingVoiceStatements(ownerId: string, activityId: string, now: number): LiveDbStatement[] {
  const db = getDb();
  return [
    db.update(voiceSpecialistResponses).set({
      status: "discarded",
      updatedAt: now,
    }).where(and(
      eq(voiceSpecialistResponses.ownerId, ownerId),
      eq(voiceSpecialistResponses.status, "provisional"),
      sql`EXISTS (
        SELECT 1 FROM ${voiceCaptureIntents}
        WHERE ${voiceCaptureIntents.ownerId} = ${ownerId}
          AND ${voiceCaptureIntents.activityId} = ${activityId}
          AND ${voiceCaptureIntents.captureId} = ${voiceSpecialistResponses.captureId}
          AND ${voiceCaptureIntents.status} = 'pending'
      )`,
    )),
    db.update(voiceCaptureIntents).set({
      status: "discarded_unclassified",
      decisionSource: "finish_guard",
      decisionReason: "The capture remained unclassified when the activity was finished.",
      decidedAt: now,
      updatedAt: now,
    }).where(and(
      eq(voiceCaptureIntents.ownerId, ownerId),
      eq(voiceCaptureIntents.activityId, activityId),
      eq(voiceCaptureIntents.status, "pending"),
    )),
  ];
}

function resultReviewReason(
  result: LiveResult,
  reviewOfActivityId?: string,
): ReviewReason | null {
  if (result === "failed") return "failed";
  if (result === "solved_after_reviewing_approach") return "approach_review";
  if (result === "solved" && reviewOfActivityId) return "successful_recall";
  return null;
}

function scheduleReviewStatements(input: {
  ownerId: string;
  activityId: string;
  questionId?: string;
  reviewOfActivityId?: string;
  specialty: LiveRoomActivityType;
  result: LiveResult;
  completedDate: string;
  prior: typeof reviewSchedules.$inferSelect | undefined;
  now: number;
}): LiveDbStatement[] {
  const db = getDb();
  const reason = resultReviewReason(input.result, input.reviewOfActivityId);
  if (!reason) {
    return [db.delete(reviewSchedules).where(and(
      eq(reviewSchedules.ownerId, input.ownerId),
      eq(reviewSchedules.activityId, input.activityId),
    ))];
  }
  const reviewKey = `${input.specialty}:${input.questionId ?? input.activityId}`;
  const intervalDays = reviewIntervalDays(reason, input.prior?.intervalDays);
  const successfulRecall = reason === "successful_recall";
  return [db.insert(reviewSchedules).values({
    ownerId: input.ownerId,
    reviewKey,
    activityId: input.activityId,
    questionId: input.questionId ?? null,
    specialty: input.specialty,
    status: "scheduled",
    reason,
    dueDate: addDays(input.completedDate, intervalDays),
    intervalDays,
    stage: successfulRecall ? (input.prior?.stage ?? 0) + 1 : 0,
    reviewCount: successfulRecall
      ? (input.prior?.reviewCount ?? 0) + 1
      : (input.prior?.reviewCount ?? 0),
    createdAt: input.prior?.createdAt ?? input.now,
    updatedAt: input.now,
  }).onConflictDoUpdate({
    target: [reviewSchedules.ownerId, reviewSchedules.reviewKey],
    set: {
      activityId: input.activityId,
      questionId: input.questionId ?? null,
      specialty: input.specialty,
      status: "scheduled",
      reason,
      dueDate: addDays(input.completedDate, intervalDays),
      intervalDays,
      stage: successfulRecall ? (input.prior?.stage ?? 0) + 1 : 0,
      reviewCount: successfulRecall
        ? (input.prior?.reviewCount ?? 0) + 1
        : (input.prior?.reviewCount ?? 0),
      updatedAt: input.now,
    },
  })];
}

function publicationReadyStatement(
  ownerId: string,
  activityId: string,
  date: string,
  existing: typeof publicationStatuses.$inferSelect | undefined,
  now: number,
) {
  const db = getDb();
  return db.insert(publicationStatuses).values({
    ownerId,
    activityId,
    date,
    status: "ready",
    revision: (existing?.revision ?? 0) + 1,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [publicationStatuses.ownerId, publicationStatuses.activityId],
    set: {
      date,
      status: sql`CASE
        WHEN ${publicationStatuses.status} = 'published' THEN ${publicationStatuses.status}
        ELSE 'ready'
      END`,
      revision: sql`${publicationStatuses.revision} + 1`,
      updatedAt: now,
    },
  });
}

function unpublishedResultInvariant(ownerId: string, activityId: string) {
  const db = getDb();
  return d1TransactionalInvariantGuard(db, sql`NOT EXISTS (
    SELECT 1 FROM ${publicationStatuses}
    WHERE ${publicationStatuses.ownerId} = ${ownerId}
      AND ${publicationStatuses.activityId} = ${activityId}
      AND ${publicationStatuses.status} = 'published'
  )`);
}

function finishPreconditionError(code: string, message: string): never {
  throw new LiveV1Error(code, message, 409, false);
}

function revisionConflict(): never {
  throw new LiveV1Error(
    "revision_conflict",
    "The workbench, result, or timer changed. Reread the authoritative projection before retrying.",
    409,
    true,
  );
}

export async function applyLiveActivityCommand(
  input: LiveActivityCommandInput,
): Promise<LiveActivityCommandCommit> {
  const operation = `command.${input.command}`;
  const replay = await receiptReplay(
    input.ownerId,
    input.activityId,
    input.operationId,
    operation,
    input.requestDigest,
  );
  if (replay) {
    return {
      duplicate: true,
      receipt: replay,
      ownerRevision: await ownerRevision(input.ownerId),
      selectedNextActivityId: typeof replay.result.selectedNextActivityId === "string"
        ? replay.result.selectedNextActivityId
        : null,
    };
  }

  const loaded = await loadOpenWorkbench(input.ownerId);
  if (!loaded) {
    throw new LiveV1Error("activity_not_found", "The activity is unavailable.", 404, false);
  }
  const item = loaded.activities.find(({ row }) => row.id === input.activityId);
  if (!item || !isLiveRoomActivityType(item.payload.type)) {
    throw new LiveV1Error("activity_not_found", "The activity is unavailable.", 404, false);
  }
  if (loaded.workbench.updatedAt !== input.expectedWorkbenchRevision) revisionConflict();

  const lease = await leaseRow(input.ownerId, input.activityId);
  if (!hasCurrentLease(lease, input.identity, input.now)) leaseConflict();

  const db = getDb();
  const timer = loaded.timerByKey.get(`activity:${input.activityId}`);
  const result = loaded.outcomeByActivity.get(input.activityId);
  const sessionId = loaded.canonicalSessionByActivity.get(input.activityId)
    ?? item.payload.sessionId
    ?? null;
  const session = sessionId
    ? loaded.sessions.find(({ row }) => row.id === sessionId)
    : undefined;
  const sessionTimer = sessionId ? loaded.timerByKey.get(`session:${sessionId}`) : undefined;
  const allTimerRows = [...loaded.timerByKey.values()];
  const statements: LiveDbStatement[] = [
    liveActivityInvariant(input.ownerId, input.activityId),
    currentLeaseInvariant(input.ownerId, input.activityId, input.identity),
    workbenchRevisionInvariant(input.ownerId, loaded.workbench.id, input.expectedWorkbenchRevision),
  ];
  let selectedNextActivityId: string | null = null;
  let confirmation: Record<string, unknown> | null = null;

  if (input.command === "set_result" || input.command === "clear_result") {
    if (input.expectedResultRevision == null
        || input.expectedResultRevision !== (result?.revision ?? 0)) revisionConflict();
    if (input.command === "set_result" && !input.result) {
      throw new LiveV1Error("invalid_request", "set_result requires a supported result.", 400, false);
    }
    const publicationRows = await db.select({ status: publicationStatuses.status })
      .from(publicationStatuses)
      .where(and(
        eq(publicationStatuses.ownerId, input.ownerId),
        eq(publicationStatuses.activityId, input.activityId),
      ));
    if (publicationRows[0]?.status === "published") {
      finishPreconditionError("timer_completed", "Published results are permanently read-only.");
    }
    statements.push(
      outcomeRevisionInvariant(
        input.ownerId,
        input.activityId,
        input.expectedResultRevision,
      ),
      unpublishedResultInvariant(input.ownerId, input.activityId),
    );
    if (input.command === "clear_result") {
      if (result) {
        statements.push(db.delete(outcomes).where(and(
          eq(outcomes.ownerId, input.ownerId),
          eq(outcomes.activityId, input.activityId),
          eq(outcomes.revision, input.expectedResultRevision),
        )));
      }
      statements.push(db.delete(reviewSchedules).where(and(
        eq(reviewSchedules.ownerId, input.ownerId),
        eq(reviewSchedules.activityId, input.activityId),
      )));
    } else {
      statements.push(db.insert(outcomes).values({
        ownerId: input.ownerId,
        activityId: input.activityId,
        outcome: input.result!,
        revision: input.expectedResultRevision + 1,
        updatedAt: input.now,
      }).onConflictDoUpdate({
        target: [outcomes.ownerId, outcomes.activityId],
        set: {
          outcome: input.result!,
          revision: input.expectedResultRevision + 1,
          updatedAt: input.now,
        },
        setWhere: eq(outcomes.revision, input.expectedResultRevision),
      }));
      if (timer?.completed) {
        const reviewKey = `${item.payload.type}:${item.payload.questionId ?? input.activityId}`;
        const priorRows = await db.select().from(reviewSchedules).where(and(
          eq(reviewSchedules.ownerId, input.ownerId),
          eq(reviewSchedules.reviewKey, reviewKey),
        ));
        statements.push(...scheduleReviewStatements({
          ownerId: input.ownerId,
          activityId: input.activityId,
          questionId: item.payload.questionId,
          reviewOfActivityId: item.payload.reviewOfActivityId,
          specialty: item.payload.type,
          result: input.result!,
          completedDate: dateInPracticeTimeZone(new Date(timer.completedAt ?? input.now)),
          prior: priorRows[0],
          now: input.now,
        }));
      }
    }
  } else if (input.command === "confirm_candidate_evidence") {
    if (!input.pairId) {
      throw new LiveV1Error("invalid_request", "Evidence confirmation requires a pair identity.", 400, false);
    }
    const pairRows = await db.select().from(liveTurnPairs).where(and(
      eq(liveTurnPairs.ownerId, input.ownerId),
      eq(liveTurnPairs.activityId, input.activityId),
      eq(liveTurnPairs.pairId, input.pairId),
    ));
    const pair = pairRows[0];
    if (!pair) {
      throw new LiveV1Error("pair_not_found", "The immutable Live pair is unavailable.", 404, false);
    }
    if (pair.candidateEvidenceStatus !== "possible_contamination") {
      finishPreconditionError(
        "idempotency_conflict",
        "Only possible-contamination evidence needs explicit confirmation.",
      );
    }
    if (pair.evidenceConfirmedAt != null) {
      throw new LiveV1Error(
        "idempotency_conflict",
        "That immutable evidence pair was confirmed by another operation.",
        409,
        false,
      );
    }
    statements.push(
      d1TransactionalInvariantGuard(db, sql`EXISTS (
        SELECT 1 FROM ${liveTurnPairs}
        WHERE ${liveTurnPairs.ownerId} = ${input.ownerId}
          AND ${liveTurnPairs.activityId} = ${input.activityId}
          AND ${liveTurnPairs.pairId} = ${input.pairId}
          AND ${liveTurnPairs.candidateEvidenceStatus} = 'possible_contamination'
          AND ${liveTurnPairs.evidenceConfirmedAt} IS NULL
      )`),
      db.insert(liveCandidateEvidenceConfirmations).values({
        ownerId: input.ownerId,
        activityId: input.activityId,
        pairId: input.pairId,
        operationId: input.operationId,
        confirmedAt: input.now,
      }),
      db.update(liveTurnPairs).set({ evidenceConfirmedAt: input.now }).where(and(
        eq(liveTurnPairs.ownerId, input.ownerId),
        eq(liveTurnPairs.activityId, input.activityId),
        eq(liveTurnPairs.pairId, input.pairId),
        sql`${liveTurnPairs.evidenceConfirmedAt} IS NULL`,
      )),
    );
    confirmation = { pairId: input.pairId, confirmedAt: input.now };
  } else {
    if (input.expectedTimerRevision == null
        || input.expectedTimerRevision !== (timer?.revision ?? 0)) revisionConflict();
    if (timer?.completed) finishPreconditionError(
      "timer_completed",
      "A completed activity timer is permanently locked.",
    );
    statements.push(timerRevisionInvariant(
      input.ownerId,
      input.activityId,
      "activity",
      input.expectedTimerRevision,
    ));

    if (input.command === "start") {
      statements.push(
        ...pauseRunningTimersStatements(
          input.ownerId,
          "activity",
          input.now,
          [input.activityId],
        ),
        ...pauseRunningTimersStatements(
          input.ownerId,
          "session",
          input.now,
          sessionId ? [sessionId] : [],
        ),
      );
      if (sessionId) {
        if (sessionTimer?.completed) {
          finishPreconditionError("session_completed", "The parent session is already completed.");
        }
        statements.push(...startTimerStatements(
          input.ownerId,
          sessionId,
          "session",
          sessionTimer,
          input.now,
        ));
      }
      statements.push(
        ...startTimerStatements(input.ownerId, input.activityId, "activity", timer, input.now),
        db.insert(practiceFocus).values({
          ownerId: input.ownerId,
          activityId: input.activityId,
          sessionId,
          focusedAt: input.now,
          updatedAt: input.now,
        }).onConflictDoUpdate({
          target: practiceFocus.ownerId,
          set: {
            activityId: input.activityId,
            sessionId,
            focusedAt: input.now,
            updatedAt: input.now,
          },
        }),
      );
    } else if (input.command === "pause") {
      if (!timer?.startedAt || !timer.runningSince) {
        finishPreconditionError("timer_not_running", "The activity timer must be running before pause.");
      }
      statements.push(...pauseTimerStatements(timer, input.now));
    } else {
      if (!timer?.startedAt) {
        finishPreconditionError("timer_not_finishable", "Start the activity before finishing it.");
      }
      if (input.expectedResultRevision == null
          || input.expectedResultRevision !== (result?.revision ?? 0)) revisionConflict();
      if (!result) {
        finishPreconditionError("result_required", "Choose a result before finishing the activity.");
      }
      const projection = await readLiveActivityProjection(input.ownerId, input.activityId, input.now);
      if (!projection?.activity.textEvidenceSatisfied) {
        finishPreconditionError(
          "candidate_evidence_required",
          "Confirm candidate text evidence before finishing this activity.",
        );
      }
      const voiceGuard = await prepareVoiceCapturesForFinish(
        input.ownerId,
        input.activityId,
        input.now,
        { discardPending: false },
      );
      const voiceConflict = voiceFinishGuardMessage(voiceGuard);
      if (voiceConflict) {
        throw new LiveV1Error("voice_delivery_blocked", voiceConflict, 409, false);
      }

      if (input.command === "finish-next") {
        const candidateActivities = new Set(loaded.activities.map(({ row }) => row.id));
        const completedActivityIds = new Set(allTimerRows.flatMap((candidate) => (
          candidate.kind === "activity" && candidate.completed ? [candidate.subjectId] : []
        )));
        if (input.nextActivityId) {
          if (input.nextActivityId === input.activityId
              || !candidateActivities.has(input.nextActivityId)
              || completedActivityIds.has(input.nextActivityId)) {
            finishPreconditionError(
              "next_activity_unavailable",
              "The explicitly requested next practice activity is unavailable.",
            );
          }
          selectedNextActivityId = input.nextActivityId;
        } else {
          const activityIds = session?.payload.activityIds ?? [];
          const currentIndex = activityIds.indexOf(input.activityId);
          selectedNextActivityId = currentIndex < 0 ? null : activityIds
            .slice(currentIndex + 1)
            .find((candidate) => (
              candidateActivities.has(candidate) && !completedActivityIds.has(candidate)
            )) ?? null;
          if (!selectedNextActivityId) {
            finishPreconditionError(
              "no_next_activity",
              "No unfinished practice activity remains after this activity in its session.",
            );
          }
        }
        if (input.expectedNextTimerRevision == null) {
          throw new LiveV1Error(
            "invalid_request",
            "finish-next requires the selected next activity's optimistic timer revision.",
            400,
            false,
          );
        }
        const nextTimer = loaded.timerByKey.get(`activity:${selectedNextActivityId}`);
        if (input.expectedNextTimerRevision !== (nextTimer?.revision ?? 0)
            || nextTimer?.completed) revisionConflict();
        const nextSessionId = loaded.canonicalSessionByActivity.get(selectedNextActivityId)
          ?? loaded.activities.find(({ row }) => row.id === selectedNextActivityId)?.payload.sessionId
          ?? null;
        const nextSessionTimer = nextSessionId
          ? loaded.timerByKey.get(`session:${nextSessionId}`)
          : undefined;
        statements.push(
          timerRevisionInvariant(
            input.ownerId,
            selectedNextActivityId,
            "activity",
            input.expectedNextTimerRevision,
          ),
          ...finishTimerStatements(timer, input.now),
          ...pauseRunningTimersStatements(
            input.ownerId,
            "activity",
            input.now,
            [input.activityId, selectedNextActivityId],
          ),
          ...pauseRunningTimersStatements(
            input.ownerId,
            "session",
            input.now,
            nextSessionId ? [nextSessionId] : [],
          ),
        );
        if (nextSessionId) {
          if (nextSessionTimer?.completed) {
            finishPreconditionError("session_completed", "The next parent session is completed.");
          }
          statements.push(...startTimerStatements(
            input.ownerId,
            nextSessionId,
            "session",
            nextSessionTimer,
            input.now,
          ));
        }
        statements.push(
          ...startTimerStatements(
            input.ownerId,
            selectedNextActivityId,
            "activity",
            nextTimer,
            input.now,
          ),
          db.insert(practiceFocus).values({
            ownerId: input.ownerId,
            activityId: selectedNextActivityId,
            sessionId: nextSessionId,
            focusedAt: input.now,
            updatedAt: input.now,
          }).onConflictDoUpdate({
            target: practiceFocus.ownerId,
            set: {
              activityId: selectedNextActivityId,
              sessionId: nextSessionId,
              focusedAt: input.now,
              updatedAt: input.now,
            },
          }),
        );
      } else {
        statements.push(...finishTimerStatements(timer, input.now));
        const sessionActivityIds = session?.payload.activityIds ?? [];
        if (sessionId && session) {
          statements.push(...finishSessionWhenChildrenCompleteStatements(
            input.ownerId,
            sessionId,
            sessionActivityIds,
            input.now,
          ));
        }
        const focusedSessionId = sessionId && session
          ? sql`CASE
              WHEN ${unfinishedSessionChildren(input.ownerId, sessionActivityIds)}
                THEN ${sessionId}
              ELSE NULL
            END`
          : null;
        statements.push(db.insert(practiceFocus).values({
          ownerId: input.ownerId,
          activityId: null,
          sessionId: focusedSessionId,
          focusedAt: input.now,
          updatedAt: input.now,
        }).onConflictDoUpdate({
          target: practiceFocus.ownerId,
          set: {
            activityId: null,
            sessionId: focusedSessionId,
            focusedAt: input.now,
            updatedAt: input.now,
          },
        }));
      }

      const reviewKey = `${item.payload.type}:${item.payload.questionId ?? input.activityId}`;
      const completionDate = dateInPracticeTimeZone(new Date(input.now));
      const [priorReviews, publicationRows] = await Promise.all([
        db.select().from(reviewSchedules).where(and(
          eq(reviewSchedules.ownerId, input.ownerId),
          eq(reviewSchedules.reviewKey, reviewKey),
        )),
        db.select().from(publicationStatuses).where(and(
          eq(publicationStatuses.ownerId, input.ownerId),
          eq(publicationStatuses.activityId, input.activityId),
        )),
      ]);
      statements.push(
        outcomeRevisionInvariant(input.ownerId, input.activityId, input.expectedResultRevision),
        candidateEvidenceInvariant(input.ownerId, input.activityId),
        voiceFinishInvariant(input.ownerId, input.activityId),
        ...discardPendingVoiceStatements(input.ownerId, input.activityId, input.now),
        publicationReadyStatement(
          input.ownerId,
          input.activityId,
          completionDate,
          publicationRows[0],
          input.now,
        ),
        ...scheduleReviewStatements({
          ownerId: input.ownerId,
          activityId: input.activityId,
          questionId: item.payload.questionId,
          reviewOfActivityId: item.payload.reviewOfActivityId,
          specialty: item.payload.type,
          result: result.outcome,
          completedDate: completionDate,
          prior: priorReviews[0],
          now: input.now,
        }),
        db.update(liveActivityLeases).set({
          holderId: null,
          holderSessionId: null,
          expiresAt: null,
          renewedAt: input.now,
          updatedAt: input.now,
        }).where(and(
          eq(liveActivityLeases.ownerId, input.ownerId),
          eq(liveActivityLeases.activityId, input.activityId),
        )),
      );
    }
  }

  const receipt: StoredLiveReceipt = {
    protocolVersion: 1,
    operationId: input.operationId,
    activityId: input.activityId,
    operation,
    committedAt: input.now,
    result: {
      command: input.command,
      ...(selectedNextActivityId ? { selectedNextActivityId } : {}),
      ...(confirmation ? { confirmation } : {}),
    },
  };
  statements.push(
    receiptInsert(
      input.ownerId,
      input.activityId,
      input.operationId,
      operation,
      input.requestDigest,
      receipt,
    ),
    ownerRevisionStatement(input.ownerId, input.now),
  );

  try {
    await db.batch(statements as [LiveDbStatement, ...LiveDbStatement[]]);
  } catch (error) {
    const committed = await receiptReplay(
      input.ownerId,
      input.activityId,
      input.operationId,
      operation,
      input.requestDigest,
    );
    if (committed) {
      return {
        duplicate: true,
        receipt: committed,
        ownerRevision: await ownerRevision(input.ownerId),
        selectedNextActivityId: typeof committed.result.selectedNextActivityId === "string"
          ? committed.result.selectedNextActivityId
          : null,
      };
    }
    const latestLease = await leaseRow(input.ownerId, input.activityId);
    if (!hasCurrentLease(latestLease, input.identity, Date.now())) leaseConflict();
    if (input.command === "confirm_candidate_evidence" && input.pairId) {
      const confirmedPairs = await db.select({ confirmedAt: liveTurnPairs.evidenceConfirmedAt })
        .from(liveTurnPairs)
        .where(and(
          eq(liveTurnPairs.ownerId, input.ownerId),
          eq(liveTurnPairs.activityId, input.activityId),
          eq(liveTurnPairs.pairId, input.pairId),
        ));
      if (confirmedPairs[0]?.confirmedAt != null) {
        throw new LiveV1Error(
          "idempotency_conflict",
          "That immutable evidence pair was confirmed by another operation.",
          409,
          false,
        );
      }
    }
    if (isD1TransactionalInvariantFailure(error)) revisionConflict();
    throw error;
  }

  return {
    duplicate: false,
    receipt,
    ownerRevision: await ownerRevision(input.ownerId),
    selectedNextActivityId,
  };
}
