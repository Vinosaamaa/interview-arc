import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { groupTranscriptTurns } from "../app/transcript-groups.ts";
import test from "node:test";

import { dateInTimeZone, emptyJournal } from "../app/current-day.ts";
import { SESSION_SECONDS, sessionAllocationSeconds } from "../app/live-types.ts";
import { formatPracticeTimerTimestamp, formatPracticeTimestamp, practiceDateAt, practicePeriodAt } from "../app/practice-time.ts";
import { resolveOwnerId, TRUSTED_EMAIL_HEADER } from "../db/owner.ts";
import { dedupeSnapshotRows } from "../db/snapshot-rows.ts";
import { derivePublicationStatus } from "../db/publication-state.ts";
import { foldElapsed, nextTimerState } from "../db/timer-state.ts";
import { reviewIntervalDays } from "../db/review-cadence.ts";
import {
  deriveQuestionMetadataTags,
  mergePersonalLeetCodeQuestionMetadata,
  validateLeetCodeQuestionMetadata,
} from "../db/question-metadata.ts";
import {
  remediateRelatedVoiceCapture,
  voiceCaptureRemediationAnnotations,
  voiceCaptureRemediationInputSchema,
} from "../mcp-worker/voice-capture-remediation.ts";
import { mutationFailureDisposition } from "../app/mutation-queue.ts";
import { applyTimerSync, timerSyncChanged } from "../app/timer-reconciliation.ts";
import { isJournalPath, journalBranch, parsePorcelain } from "../scripts/journal-branch.mjs";
import {
  finishDispositionForVoiceStatus,
  sameCanonicalExchange,
  sameVoiceCommitTurn,
  voiceCaptureAllowsCommit,
  voiceCaptureDeleteTurnIds,
  voiceCaptureRemediationDisposition,
  voiceCommitStatusAllowsReplay,
  voiceDecisionReceipt,
  voiceFinishGuardMessage,
} from "../db/practice-exchange-policy.ts";

test("today follows the practice timezone instead of the Worker UTC date", () => {
  assert.equal(dateInTimeZone(new Date("2026-07-20T05:30:00Z")), "2026-07-19");
  assert.equal(dateInTimeZone(new Date("2026-07-20T08:00:00Z")), "2026-07-20");
  assert.deepEqual(emptyJournal("2026-07-20").activities, []);
});

test("a published live activity appears only once in the practice snapshot", () => {
  const rows = dedupeSnapshotRows([
    { id: "activity-1", status: "planned", source: "live" },
    { id: "activity-1", status: "completed", source: "journal" },
    { id: "activity-2", status: "planned", source: "live" },
  ]);
  assert.deepEqual(rows, [
    { id: "activity-1", status: "completed", source: "journal" },
    { id: "activity-2", status: "planned", source: "live" },
  ]);
});

test("activity completion dates and rhythm periods follow Pacific time across midnight", () => {
  assert.equal(practiceDateAt(Date.parse("2026-07-21T06:59:59Z")), "2026-07-20");
  assert.equal(practiceDateAt(Date.parse("2026-07-21T07:00:00Z")), "2026-07-21");
  assert.equal(practicePeriodAt(Date.parse("2026-07-21T06:30:00Z")), "Evening");
  assert.equal(practicePeriodAt(Date.parse("2026-07-21T07:30:00Z")), "Late night");
});

test("compact activity timestamps omit the redundant Pacific abbreviation", () => {
  assert.equal(formatPracticeTimestamp("2026-07-21T18:29:00Z", true, false), "Jul 21, 11:29 AM");
  assert.match(formatPracticeTimestamp("2026-07-21T18:29:00Z", true), /PDT$/);
  assert.equal(formatPracticeTimerTimestamp("2026-07-22T06:29:00Z"), "Jul 21, 23:29");
});

test("timer transitions fold elapsed time and permanently lock finish", () => {
  assert.equal(foldElapsed(12, 1_000, 4_900), 15);
  const started = nextTimerState(undefined, "start", 1_000);
  const paused = nextTimerState(started, "pause", 4_900);
  assert.deepEqual(paused, { accumulatedSeconds: 3, runningSince: null, completed: false, revision: 2 });
  const finished = nextTimerState(paused, "finish", 8_000);
  assert.deepEqual(finished, { accumulatedSeconds: 3, runningSince: null, completed: true, revision: 3 });
  assert.equal(nextTimerState(finished, "start", 10_000), finished);
});

test("activity finish discards untouched Voice envelopes but protects confirmed evidence", () => {
  assert.equal(finishDispositionForVoiceStatus("pending"), "discard_unclassified");
  assert.equal(finishDispositionForVoiceStatus("activity_related"), "block_for_delivery");
  assert.equal(finishDispositionForVoiceStatus("uncertain"), "needs_user_decision");
  assert.equal(finishDispositionForVoiceStatus("accepted"), "nonblocking");
  assert.equal(finishDispositionForVoiceStatus("discarded_unclassified"), "nonblocking");
  assert.equal(finishDispositionForVoiceStatus("expired_unclassified"), "nonblocking");
});

test("voice finish recovery tells the user the exact action required", () => {
  const empty = {
    discardedUnclassified: [],
    awaitingDelivery: [],
    missingDurableExchange: [],
    awaitingAudio: [],
    audioLostNeedsAcknowledgement: [],
    needsDecision: [],
    deleting: [],
    conflicts: [],
  };
  assert.equal(voiceFinishGuardMessage(empty), null);
  assert.match(voiceFinishGuardMessage({ ...empty, awaitingDelivery: ["c1"] }), /Retry delivery or Discard/);
  assert.match(voiceFinishGuardMessage({ ...empty, missingDurableExchange: ["c1"] }), /canonical D1 transcript/);
  assert.match(voiceFinishGuardMessage({ ...empty, awaitingAudio: ["c1"] }), /Retry upload/);
  assert.match(voiceFinishGuardMessage({ ...empty, audioLostNeedsAcknowledgement: ["c1"] }), /Acknowledge/);
  assert.match(voiceFinishGuardMessage({ ...empty, needsDecision: ["c1"] }), /Attach or Discard/);
  assert.match(voiceFinishGuardMessage({ ...empty, deleting: ["c1"] }), /Retry or wait/);
  assert.match(voiceFinishGuardMessage({ ...empty, conflicts: ["c1"] }), /conflicting durable content/);
});

test("canonical exchange retries are identity-idempotent and conflicting rewrites are rejected", () => {
  const canonical = {
    activityId: "activity-1",
    userTurnId: "voice-user-1",
    responseTurnId: "specialist-1",
    specialty: "leetcode",
    responseBody: "Use dynamic programming.",
    responseOccurredAt: 1_234,
  };
  assert.equal(sameCanonicalExchange(canonical, { ...canonical }), true);
  assert.equal(sameCanonicalExchange(canonical, {
    ...canonical,
    responseBody: "Use recursion instead.",
  }), false);
});

test("an accepted Voice capture can replay the exact durable transcript commit", () => {
  assert.equal(voiceCommitStatusAllowsReplay("activity_related"), true);
  assert.equal(voiceCommitStatusAllowsReplay("accepted"), true);
  assert.equal(voiceCommitStatusAllowsReplay("unrelated"), false);
  assert.equal(voiceCommitStatusAllowsReplay("quarantined_conflict"), false);

  const incoming = {
    activityId: "activity-1",
    specialty: "leetcode",
    turnId: "voice-user-1",
    checksum: "sha256:fixture",
  };
  assert.equal(voiceCaptureAllowsCommit({ status: "accepted", ...incoming }, incoming), true);
  assert.equal(voiceCaptureAllowsCommit({
    status: "accepted",
    ...incoming,
    checksum: "sha256:changed",
  }, incoming), false);

  const existingDurableTurn = {
    specialty: "leetcode",
    speaker: "user",
    body: "Use dynamic programming.",
    source: "audio_transcript",
    sequence: 4,
    occurredAt: 1_234,
  };
  assert.equal(sameVoiceCommitTurn(existingDurableTurn, { ...existingDurableTurn }), true);
  assert.equal(sameVoiceCommitTurn(existingDurableTurn, {
    ...existingDurableTurn,
    body: "Changed durable content.",
  }), false);
});

test("deleting a related Voice capture removes both canonical transcript turns", () => {
  assert.deepEqual(
    voiceCaptureDeleteTurnIds(
      "voice-user-1",
      { userTurnId: "voice-user-1", responseTurnId: "specialist-1" },
    ),
    ["voice-user-1", "specialist-1"],
  );
  assert.deepEqual(voiceCaptureDeleteTurnIds("voice-user-1", null), ["voice-user-1"]);
});

test("post-acceptance Voice remediation requires exact identity and an eligible status", () => {
  const accepted = {
    captureId: "capture-1",
    activityId: "activity-1",
    turnId: "voice-user-1",
    status: "accepted",
  };
  const expected = {
    captureId: "capture-1",
    activityId: "activity-1",
    turnId: "voice-user-1",
  };

  assert.deepEqual(
    voiceCaptureRemediationDisposition(accepted, expected),
    { action: "delete", idempotent: false },
  );
  assert.deepEqual(
    voiceCaptureRemediationDisposition({ ...accepted, status: "activity_related" }, expected),
    { action: "delete", idempotent: false },
  );
  assert.deepEqual(
    voiceCaptureRemediationDisposition({ ...accepted, status: "quarantined_conflict" }, expected),
    { action: "delete", idempotent: false },
  );
  assert.deepEqual(
    voiceCaptureRemediationDisposition({ ...accepted, status: "deleting" }, expected),
    { action: "delete", idempotent: true },
  );
  assert.deepEqual(
    voiceCaptureRemediationDisposition({ ...accepted, status: "deleted" }, expected),
    { action: "already_deleted", idempotent: true },
  );
  assert.equal(
    voiceCaptureRemediationDisposition({ ...accepted, activityId: "other" }, expected).code,
    "voice_capture_identity_mismatch",
  );
  assert.equal(
    voiceCaptureRemediationDisposition({ ...accepted, status: "pending" }, expected).code,
    "voice_capture_not_remediable",
  );
  assert.equal(
    voiceCaptureRemediationDisposition(null, expected).code,
    "voice_capture_not_found",
  );
});

test("the MCP remediation workflow is destructive, identity-bound, and idempotent", async () => {
  const input = {
    captureId: "capture-1",
    activityId: "activity-1",
    turnId: "voice-user-1",
    authorization: "explicit_user_instruction",
    reason: "The user identified this accepted administrative turn as unrelated.",
  };
  assert.equal(voiceCaptureRemediationInputSchema.safeParse(input).success, true);
  assert.equal(voiceCaptureRemediationInputSchema.safeParse({ ...input, authorization: undefined }).success, false);
  assert.deepEqual(voiceCaptureRemediationAnnotations, {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  });

  const deleted = [];
  const result = await remediateRelatedVoiceCapture(input, {
    readIntent: async () => ({ ...input, status: "accepted" }),
    deleteCapture: async (captureId, reason) => deleted.push({ captureId, reason }),
  });
  assert.deepEqual(deleted, [{ captureId: input.captureId, reason: input.reason }]);
  assert.equal(result.status, "deleted");
  assert.equal(result.idempotent, false);

  const replay = await remediateRelatedVoiceCapture(input, {
    readIntent: async () => ({ ...input, status: "deleted" }),
    deleteCapture: async () => assert.fail("a deleted tombstone must not replay graph deletion"),
  });
  assert.equal(replay.idempotent, true);
});

test("Voice commit and delete serialize on intent state and enforce response-turn ownership", async () => {
  const durableStore = await readFile(new URL("../db/durable-practice.ts", import.meta.url), "utf8");
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0019_voice_response_identity.sql", import.meta.url), "utf8");
  const commitBody = durableStore.slice(
    durableStore.indexOf("export async function commitRelatedVoiceCapture"),
    durableStore.indexOf("export async function beginDeleteVoiceCapture"),
  );
  const deleteBody = durableStore.slice(
    durableStore.indexOf("export async function completeDeleteVoiceCapture"),
    durableStore.indexOf("export async function failDeleteVoiceCapture"),
  );
  const beginDeleteBody = durableStore.slice(
    durableStore.indexOf("export async function beginDeleteVoiceCapture"),
    durableStore.indexOf("export async function completeDeleteVoiceCapture"),
  );

  assert.match(commitBody, /const commitIntentPredicate/);
  assert.match(commitBody, /\.insert\(practiceTranscriptTurns\)\.select\(/);
  assert.match(commitBody, /const committedIntent = await readVoiceCaptureIntent/);
  assert.match(commitBody, /committedIntent\?\.status !== "accepted"/);
  assert.match(beginDeleteBody, /WHEN \$\{voiceCaptureIntents\.status\} = 'deleting' THEN \$\{voiceCaptureIntents\.decisionSource\}/);
  assert.match(beginDeleteBody, /WHEN \$\{voiceCaptureIntents\.status\} = 'deleting' THEN \$\{voiceCaptureIntents\.decisionReason\}/);
  assert.match(beginDeleteBody, /WHEN \$\{voiceCaptureIntents\.status\} = 'deleting' THEN \$\{voiceCaptureIntents\.decidedAt\}/);
  assert.match(deleteBody, /readVoiceCaptureDeleteScope/);
  assert.match(deleteBody, /scope\.userTurnIds/);
  assert.match(deleteBody, /scope\.responseTurnIds/);
  assert.doesNotMatch(deleteBody, /readVoiceSpecialistResponse/);
  assert.match(schema, /uniqueIndex\("voice_specialist_responses_owner_response_unique"\)/);
  assert.match(migration, /CREATE UNIQUE INDEX `voice_specialist_responses_owner_response_unique`/);
});

test("Voice decision receipts distinguish syncing, excluded, uncertain, failed, and duplicate states", () => {
  assert.equal(
    voiceDecisionReceipt("activity_related", "Course Schedule"),
    "✓ Attached to Course Schedule · Voice evidence syncing",
  );
  assert.equal(
    voiceDecisionReceipt("unrelated", "Course Schedule"),
    "Not attached to this practice activity · Transcript not saved · Recording not uploaded",
  );
  assert.match(voiceDecisionReceipt("uncertain", "Course Schedule"), /Attach or Discard/);
  assert.match(voiceDecisionReceipt("failed", "Course Schedule"), /Retry or Discard/);
  assert.match(voiceDecisionReceipt("duplicate", "Course Schedule"), /Existing specialist response reused/);
});

test("session allocations follow the configurable 40/60/60-minute recipe", () => {
  assert.equal(sessionAllocationSeconds(6, 1, 1), 21_600);
  assert.equal(SESSION_SECONDS, 21_600);
  assert.equal(sessionAllocationSeconds(3, 2, 0), 14_400);
  assert.equal(sessionAllocationSeconds(0, 1, 2), 10_800);
  assert.equal(sessionAllocationSeconds(-2, 0, 0), 0);
});

test("review cadence starts at four days and advances successful recall", () => {
  assert.equal(reviewIntervalDays("failed"), 4);
  assert.equal(reviewIntervalDays("full_walkthrough"), 4);
  assert.equal(reviewIntervalDays("approach_review"), 7);
  assert.equal(reviewIntervalDays("successful_recall"), 21);
  assert.equal(reviewIntervalDays("successful_recall", 21), 60);
});

test("personal LeetCode metadata enrichment preserves prior values and merges provenance", () => {
  const existing = {
    problemNumber: 207,
    difficulty: "medium",
    acceptanceRate: 49.8,
    topics: ["Graph"],
    companyTags: ["TikTok"],
    companySignals: [{
      company: "TikTok",
      window: "30 days",
      frequencyScore: 2,
      frequencyScale: 5,
      capturedAt: "2026-07-01T12:00:00.000Z",
    }],
    metadataReferences: [{
      title: "Saved company list",
      url: "https://example.test/company-list",
      accessedAt: "2026-07-01T12:00:00.000Z",
    }],
    metadataCapturedAt: Date.parse("2026-07-01T12:00:00.000Z"),
  };
  const merged = mergePersonalLeetCodeQuestionMetadata(existing, {
    acceptanceRate: 50.2,
    topics: ["Topological Sort", "graph"],
    capturedAt: "2026-07-25T12:00:00.000Z",
    sources: [{
      title: "Course Schedule",
      url: "https://leetcode.com/problems/course-schedule/",
      accessedAt: "2026-07-25T12:00:00.000Z",
    }],
  });

  assert.equal(merged.problemNumber, 207);
  assert.equal(merged.difficulty, "medium");
  assert.equal(merged.acceptanceRate, 50.2);
  assert.deepEqual(merged.topics, ["Graph", "Topological Sort"]);
  assert.deepEqual(merged.companyTags, ["TikTok"]);
  assert.equal(merged.companySignals.length, 1);
  assert.equal(merged.metadataReferences.length, 2);
  assert.equal(merged.metadataCapturedAt, Date.parse("2026-07-25T12:00:00.000Z"));
  assert.throws(() => validateLeetCodeQuestionMetadata({
    acceptanceRate: 101,
    capturedAt: "2026-07-25T12:00:00.000Z",
    sources: [{
      title: "Course Schedule",
      url: "https://leetcode.com/problems/course-schedule/",
      accessedAt: "2026-07-25T12:00:00.000Z",
    }],
  }), /Invalid LeetCode question metadata/);

  const stale = mergePersonalLeetCodeQuestionMetadata(merged, {
    problemNumber: 999,
    difficulty: "hard",
    acceptanceRate: 1,
    topics: ["Breadth-First Search"],
    capturedAt: "2026-07-20T12:00:00.000Z",
    sources: [{
      title: "Delayed metadata",
      url: "https://example.test/delayed",
      accessedAt: "2026-07-20T12:00:00.000Z",
    }],
  });
  assert.equal(stale.problemNumber, 207);
  assert.equal(stale.difficulty, "medium");
  assert.equal(stale.acceptanceRate, 50.2);
  assert.ok(stale.topics.includes("Breadth-First Search"));
  assert.equal(stale.metadataCapturedAt, Date.parse("2026-07-25T12:00:00.000Z"));

  const newerReference = mergePersonalLeetCodeQuestionMetadata(merged, {
    capturedAt: "2026-07-26T12:00:00.000Z",
    sources: [{
      title: "Fresh source",
      url: "https://leetcode.com/problems/course-schedule/",
      accessedAt: "2026-07-26T12:00:00.000Z",
    }],
  });
  assert.equal(newerReference.metadataReferences.find((source) => source.url.endsWith("course-schedule/"))?.title, "Fresh source");

  const projected = deriveQuestionMetadataTags({
    difficulty: "hard",
    topics: ["Heap (Priority Queue)", "Matrix"],
    companyTags: ["Google"],
    companySignals: [{
      company: "Amazon",
      window: "30 days",
      frequencyScore: 4,
      frequencyScale: 5,
      capturedAt: "2026-07-25T12:00:00.000Z",
    }],
    capturedAt: "2026-07-25T12:00:00.000Z",
    sources: [{
      title: "LeetCode",
      url: "https://leetcode.com/problems/course-schedule/",
      accessedAt: "2026-07-25T12:00:00.000Z",
    }],
  });
  assert.deepEqual(projected, [
    "difficulty:hard",
    "topic:heap-priority-queue",
    "topic:matrix",
    "company:google",
    "company:amazon",
  ]);
});

test("finished activities enter the journal queue without a second toggle", () => {
  assert.equal(derivePublicationStatus({ hasArtifact: false, completed: false }), "draft");
  assert.equal(derivePublicationStatus({ hasArtifact: false, completed: true }), "ready");
  assert.equal(derivePublicationStatus({ hasArtifact: false, completed: false, storedPublication: "ready" }), "ready");
  assert.equal(derivePublicationStatus({ hasArtifact: true, completed: true }), "published");
  assert.equal(derivePublicationStatus({ hasArtifact: false, completed: true, storedPublication: "published" }), "ready");
  assert.equal(derivePublicationStatus({ hasArtifact: true, completed: true, storedPublication: "published" }), "published");
});

test("result flags stay separate from timer completion and publication readiness", async () => {
  const liveState = await readFile(new URL("../db/live-state.ts", import.meta.url), "utf8");
  const snapshot = await readFile(new URL("../db/practice-snapshot.ts", import.meta.url), "utf8");
  const mutationRoute = await readFile(new URL("../app/api/mutations/route.ts", import.meta.url), "utf8");
  const setOutcomeBody = liveState.slice(liveState.indexOf("export async function setOutcome"), liveState.indexOf("export async function setPublicationStatus"));
  assert.doesNotMatch(setOutcomeBody, /applyTimerAction|setPracticeFocus/);
  assert.match(snapshot, /publicationStatus === "ready" && Boolean\(activity\.outcome\)/);
  assert.match(snapshot, /publicationStatus !== "ready" \|\| !outcome/);
  assert.match(mutationRoute, /Start the .* before finishing it/);
});

test("the clean-start release cannot replay stale mock browser queues", async () => {
  const liveSync = await readFile(new URL("../app/live-sync.ts", import.meta.url), "utf8");
  assert.match(liveSync, /interview-arc-draft-v3-/);
  assert.match(liveSync, /interview-arc-queue-v2-/);
  assert.match(liveSync, /startsWith\("interview-arc-queue-"\)/);
});

test("non-retryable timer conflicts cannot poison the durable mutation queue", async () => {
  assert.equal(mutationFailureDisposition(409), "discard");
  assert.equal(mutationFailureDisposition(400), "discard");
  assert.equal(mutationFailureDisposition(422), "discard");
  assert.equal(mutationFailureDisposition(401), "retry");
  assert.equal(mutationFailureDisposition(429), "retry");
  assert.equal(mutationFailureDisposition(500), "retry");

  const liveSync = await readFile(new URL("../app/live-sync.ts", import.meta.url), "utf8");
  assert.match(liveSync, /mutationFailureDisposition\(response\.status\)/);
  assert.match(liveSync, /queueRef\.current = queueRef\.current\.slice\(1\)/);
  assert.ok(liveSync.includes("fetch(`/api/state?date="));
});

test("external timer reconciliation is revision-aware and preserves unrelated practice state", async () => {
  const current = {
    timers: {
      activity: {
        elapsedSeconds: 12,
        runningSince: null,
        completed: false,
        revision: 2,
      },
    },
    sessionTimers: {},
    focusedActivityId: "activity",
    focusedSessionId: "session",
    focusedAt: 100,
    notes: { activity: "keep me" },
  };
  const unchanged = {
    serverNow: 1_000,
    timers: {
      activity: {
        accumulatedSeconds: 12,
        startedAt: 50,
        runningSince: null,
        completed: false,
        completedAt: null,
        revision: 2,
      },
    },
    sessionTimers: {},
    focusedActivityId: "activity",
    focusedSessionId: "session",
    focusedAt: 100,
  };
  assert.equal(timerSyncChanged(current, unchanged), false);
  assert.equal(applyTimerSync(current, unchanged, 0), current);

  const externalPause = {
    ...unchanged,
    serverNow: 2_000,
    timers: {
      activity: {
        ...unchanged.timers.activity,
        accumulatedSeconds: 18,
        revision: 3,
      },
    },
    focusedAt: 200,
  };
  const reconciled = applyTimerSync(current, externalPause, 0);
  assert.notEqual(reconciled, current);
  assert.equal(reconciled.timers.activity.elapsedSeconds, 18);
  assert.equal(reconciled.timers.activity.revision, 3);
  assert.deepEqual(reconciled.notes, current.notes);

  const liveSync = await readFile(new URL("../app/live-sync.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/timer-state/route.ts", import.meta.url), "utf8");
  const client = await readFile(new URL("../app/home-client.tsx", import.meta.url), "utf8");
  assert.match(liveSync, /queueRef\.current\.length > 0/);
  assert.match(liveSync, /lastTimerSyncServerNowRef/);
  assert.match(liveSync, /subscribeToLiveUpdates/);
  assert.doesNotMatch(liveSync, /setInterval\(\(\) => void reconcileTimers\(\), 1000\)/);
  assert.match(route, /readTimerSyncState/);
  assert.match(route, /private, no-store/);
  assert.match(client, /pipWindow\.setInterval/);
});

test("a finished parent session locks every child activity timer", async () => {
  const client = await readFile(new URL("../app/home-client.tsx", import.meta.url), "utf8");
  const liveState = await readFile(new URL("../db/live-state.ts", import.meta.url), "utf8");
  const mutationRoute = await readFile(new URL("../app/api/mutations/route.ts", import.meta.url), "utf8");

  assert.match(client, /locked=\{sessionLocked\}/);
  assert.match(client, /if \(parentSession && draft\.sessionTimers\[parentSession\.id\]\?\.completed\) return/);
  assert.match(client, /activity-timer .*locked/);
  assert.match(liveState, /TimerStateConflictError/);
  assert.match(mutationRoute, /error instanceof TimerStateConflictError/);
  assert.match(mutationRoute, /retryable: false/);
});

test("workbench lifecycle requires explicit results and preserves archived attempts", async () => {
  const client = await readFile(new URL("../app/home-client.tsx", import.meta.url), "utf8");
  const liveState = await readFile(new URL("../db/live-state.ts", import.meta.url), "utf8");
  const liveSync = await readFile(new URL("../app/live-sync.ts", import.meta.url), "utf8");
  const snapshot = await readFile(new URL("../db/practice-snapshot.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/interview-arc-v2.css", import.meta.url), "utf8");

  assert.match(liveState, /Choose Solved, Solved with help, or Failed before finishing this activity/);
  assert.match(liveState, /Choose a result for .*before starting a fresh day/);
  assert.match(liveState, /Published results are read-only/);
  assert.match(liveState, /Only an untouched activity can be removed/);
  assert.match(liveState, /const historyActivities = extraRows/);
  assert.match(liveState, /export async function rolloverPublishedWorkbench/);
  assert.match(liveSync, /historyActivities: state\.historyActivities/);
  assert.match(snapshot, /live\.historyActivities as JournalActivity\[\]/);
  assert.match(snapshot, /live\.historySessions as PracticeSession\[\]/);
  assert.match(client, /requiredResultIds/);
  assert.doesNotMatch(client, /required-result-choices/);
  assert.match(css, /\.result-flag-wrap\.result-required \.result-flag/);
  assert.match(client, /draft\.historyActivities/);
  assert.match(client, /This session contains started or completed work and cannot be removed/);
  assert.match(client, /kind: "finish-session"/);
  assert.match(client, /className="confirmation-dialog lifecycle-dialog"/);
  assert.doesNotMatch(client, /window\.confirm/);
});

test("daily checkpoint guard recognizes only journal-owned changes", () => {
  assert.equal(journalBranch("2026-07-20"), "journal/2026-07-20");
  assert.throws(() => journalBranch("July-20"), /ISO date/);
  assert.equal(isJournalPath("data/daily/2026-07-20.json", "2026-07-20"), true);
  assert.equal(isJournalPath("practice/leetcode/attempts/2026-07-20-two-sum.md", "2026-07-20"), true);
  assert.equal(isJournalPath("practice/system-design/sessions/2026-07-20-feed.md", "2026-07-20"), true);
  assert.equal(isJournalPath("app/home-client.tsx", "2026-07-20"), false);
  assert.deepEqual(parsePorcelain("?? data/daily/2026-07-20.json\n M app/home-client.tsx\n"), [
    "data/daily/2026-07-20.json",
    "app/home-client.tsx",
  ]);
});

test("authenticated emails map to stable, non-PII owner ids", async () => {
  const first = await resolveOwnerId(new Request("https://example.test", { headers: { [TRUSTED_EMAIL_HEADER]: "Person@Example.com" } }));
  const second = await resolveOwnerId(new Request("https://example.test", { headers: { [TRUSTED_EMAIL_HEADER]: " person@example.com " } }));
  const another = await resolveOwnerId(new Request("https://example.test", { headers: { [TRUSTED_EMAIL_HEADER]: "friend@example.com" } }));
  assert.match(first, /^u_[a-f0-9]{32}$/);
  assert.equal(first, second);
  assert.notEqual(first, another);
  assert.equal(await resolveOwnerId(new Request("https://example.test")), "owner");
});

test("D1 migrations cover owner-scoped live state and shared published content", async () => {
  const live = await readFile(new URL("../drizzle/0000_nosy_legion.sql", import.meta.url), "utf8");
  const content = await readFile(new URL("../drizzle/0001_high_nightmare.sql", import.meta.url), "utf8");
  const connected = await readFile(new URL("../drizzle/0002_chubby_the_hand.sql", import.meta.url), "utf8");
  const orchestrator = await readFile(new URL("../drizzle/0003_clear_miek.sql", import.meta.url), "utf8");
  const durable = await readFile(new URL("../drizzle/0004_lyrical_sinister_six.sql", import.meta.url), "utf8");
  const knowledge = await readFile(new URL("../drizzle/0005_colorful_nuke.sql", import.meta.url), "utf8");
  const answerAudio = await readFile(new URL("../drizzle/0006_shiny_legion.sql", import.meta.url), "utf8");
  const deliveryCoach = await readFile(new URL("../drizzle/0007_flat_may_parker.sql", import.meta.url), "utf8");
  const workbenches = await readFile(new URL("../drizzle/0011_workbenches_and_provisional_profiles.sql", import.meta.url), "utf8");
  const personalMetadata = await readFile(new URL("../drizzle/0012_personal_leetcode_metadata.sql", import.meta.url), "utf8");
  const voiceEvidence = await readFile(new URL("../drizzle/0018_voice_evidence_guards.sql", import.meta.url), "utf8");
  const behavioralEvidence = await readFile(new URL("../drizzle/0024_dazzling_blink.sql", import.meta.url), "utf8");
  for (const table of ["timers", "outcomes", "extra_activities", "live_sessions"]) {
    assert.match(live, new RegExp("CREATE TABLE `" + table + "`"));
  }
  assert.match(live, /`owner_id` text NOT NULL/);
  for (const table of ["content_journals", "content_artifacts", "content_bank", "content_stories"]) {
    assert.match(content, new RegExp("CREATE TABLE `" + table + "`"));
  }
  for (const table of ["publication_statuses", "activity_notes", "integration_tokens"]) {
    assert.match(connected, new RegExp("CREATE TABLE `" + table + "`"));
  }
  assert.match(connected, /`token_hash` text PRIMARY KEY NOT NULL/);
  for (const table of ["practice_focus", "timer_intervals"]) {
    assert.match(orchestrator, new RegExp("CREATE TABLE `" + table + "`"));
  }
  assert.match(orchestrator, /ALTER TABLE `timers` ADD `started_at` integer/);
  for (const table of ["practice_notes", "practice_transcript_turns", "activity_finalizations", "review_schedules", "specialist_tasks", "activity_audio_clips"]) {
    assert.match(durable, new RegExp("CREATE TABLE `" + table + "`"));
  }
  for (const table of ["problem_preferences", "problem_solution_profiles", "problem_solution_revisions", "activity_solution_links", "owner_bank_questions"]) {
    assert.match(knowledge, new RegExp("CREATE TABLE `" + table + "`"));
  }
  assert.match(answerAudio, /ALTER TABLE `activity_audio_clips` ADD `transcript_turn_id` text/);
  assert.match(deliveryCoach, /CREATE TABLE `activity_delivery_analyses`/);
  assert.match(workbenches, /CREATE TABLE `practice_workbenches`/);
  assert.match(workbenches, /CREATE TABLE `provisional_solution_profiles`/);
  assert.match(workbenches, /ALTER TABLE `extra_activities` ADD `workbench_id` text/);
  assert.match(workbenches, /ALTER TABLE `live_sessions` ADD `workbench_id` text/);
  assert.match(personalMetadata, /ALTER TABLE `owner_bank_questions` ADD `problem_number` integer/);
  assert.match(personalMetadata, /ADD `acceptance_rate` real/);
  assert.match(personalMetadata, /ADD `metadata_references` text DEFAULT '\[\]' NOT NULL/);
  assert.match(voiceEvidence, /ADD `audio_lost_reason` text/);
  assert.match(voiceEvidence, /ADD `audio_lost_acknowledged_at` integer/);
  assert.match(voiceEvidence, /ADD `publish_without_review_acknowledged_at` integer/);
  assert.doesNotMatch(voiceEvidence, /CREATE TABLE `today_planning_mutations`/);
  for (const table of [
    "behavioral_evidence_items",
    "behavioral_evidence_question_links",
    "behavioral_claims",
    "behavioral_claim_status_events",
  ]) {
    assert.match(behavioralEvidence, new RegExp("CREATE TABLE `" + table + "`"));
  }
  assert.match(behavioralEvidence, /PRIMARY KEY\(`owner_id`, ?`evidence_id`\)/);
  assert.match(behavioralEvidence, /UNIQUE INDEX `behavioral_claim_events_operation_idx`/);
});

test("content highlights persist editable notes", async () => {
  const migration = await readFile(new URL("../drizzle/0010_highlight_notes.sql", import.meta.url), "utf8");
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/highlight-notes/route.ts", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE `content_highlight_notes`/);
  assert.match(migration, /legacy-note/);
  assert.match(schema, /export const contentHighlightNotes/);
  assert.match(route, /export async function POST/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /updateContentHighlightNote/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /MAX_NOTE_LENGTH/);
});

test("contracts preserve flexible session duration, membership, and exact timestamps", async () => {
  const activity = JSON.parse(await readFile(new URL("../docs/contracts/activity.schema.json", import.meta.url), "utf8"));
  const journal = JSON.parse(await readFile(new URL("../docs/contracts/daily-journal.schema.json", import.meta.url), "utf8"));
  const leetcode = JSON.parse(await readFile(new URL("../docs/contracts/leetcode-log.schema.json", import.meta.url), "utf8"));
  assert.equal(activity.properties.sessionId.type, "string");
  assert.equal(activity.properties.startedAt.format, "date-time");
  assert.equal(activity.properties.endedAt.format, "date-time");
  assert.equal(activity.properties.questionId.type, "string");
  assert.ok(activity.properties.reviewReason.enum.includes("full_walkthrough"));
  assert.equal(journal.properties.sessions.items.properties.allocatedSeconds.minimum, 60);
  assert.equal(leetcode.properties.practiceTimezone.const, "America/Los_Angeles");
  assert.equal(leetcode.properties.timing.properties.startedAt.format, "date-time");
});

test("durable publishing keeps transcripts, review, notes, and four-day walkthrough recall", async () => {
  const contract = await readFile(new URL("../docs/contracts/durable-practice-publishing.md", import.meta.url), "utf8");
  const bridge = await readFile(new URL("../mcp-worker/index.ts", import.meta.url), "utf8");
  const codexConfig = await readFile(new URL("../.codex/config.toml", import.meta.url), "utf8");
  assert.match(contract, /complete two-sided activity transcript/i);
  assert.match(contract, /complete standalone `modelAnswer`/i);
  assert.match(contract, /failed attempt or full walkthrough: first review in \*\*4 days\*\*/i);
  assert.match(contract, /Pinned Notes[\s\S]*What Went Well[\s\S]*What To Improve[\s\S]*References/);
  for (const tool of ["append_practice_transcript", "add_practice_note", "save_provisional_solution_profile", "save_specialist_finalization", "get_activity_practice_record", "get_problem_solution_profile", "schedule_practice_review", "register_specialist_task", "register_activity_audio_clip", "save_delivery_analysis", "get_voice_delivery_blockers", "retry_voice_delivery", "acknowledge_voice_audio_loss"]) {
    assert.match(bridge, new RegExp(`"${tool}"`));
    assert.match(codexConfig, new RegExp(`"${tool}"`));
  }
  for (const tool of ["upsert_personal_bank_question", "get_specialist_tasks", "get_today_practice", "get_publication_queue", "mark_activities_published"]) {
    assert.match(codexConfig, new RegExp(`"${tool}"`));
  }
  assert.match(bridge, /modelAnswer: z\.string\(\)\.min\(1\)/);
  assert.match(bridge, /solutionProfile: z\.object/);
  assert.match(bridge, /solutionProfileAction: z\.enum\(\["create_or_revise", "reuse_current"\]\)/);
  assert.match(bridge, /questionMetadata: leetCodeQuestionMetadataSchema\.optional\(\)/);
  assert.match(bridge, /input\.specialty !== "leetcode" && input\.finalization\.questionMetadata/);
  assert.match(bridge, /behavioralAnswer: z\.object/);
  assert.match(bridge, /"upsert_personal_bank_question"/);
  assert.match(contract, /`retry_voice_delivery`/);
  assert.match(contract, /`acknowledge_voice_audio_loss`/);
  assert.match(bridge, /voice_delivery_retry:\$\{activityId\}/);
  const durableStore = await readFile(new URL("../db/durable-practice.ts", import.meta.url), "utf8");
  const profilePolicy = await readFile(new URL("../app/solution-profile-policy.ts", import.meta.url), "utf8");
  assert.match(profilePolicy, /transcript\|conversation\|raw exchange\|verbatim/);
  assert.match(profilePolicy, /preferred personal answer/);
  assert.match(durableStore, /contentBank/);
  assert.match(durableStore, /canonicalQuestion\?\.solutionProfile/);
  assert.match(durableStore, /mergePersonalLeetCodeQuestionMetadata/);
  assert.match(durableStore, /changed during finalization; retry the finalization/);
  assert.ok(
    durableStore.indexOf("await enrichPersonalLeetCodeQuestion") < durableStore.indexOf(".insert(activityFinalizations)"),
    "personal-question enrichment must finish before the finalization becomes ready",
  );
  assert.match(durableStore, /SELECT value FROM json_each\(\$\{ownerBankQuestions\.tags\}\)/);
  assert.match(durableStore, /deriveQuestionMetadataTags/);
  assert.match(durableStore, /question\.metadata && specialty !== "leetcode"/);
  assert.match(durableStore, /question\.metadata\) \{/);
  const metadataSchema = await readFile(new URL("../db/question-metadata.ts", import.meta.url), "utf8");
  assert.match(metadataSchema, /acceptanceRate: z\.number\(\)\.min\(0\)\.max\(100\)/);
  assert.match(metadataSchema, /incomingCapturedAt >= existing\.metadataCapturedAt/);
  assert.match(metadataSchema, /topic:\$\{normalizedProjectionToken/);
  assert.match(contract, /owner-private LeetCode question created from a public problem URL/i);
  assert.match(contract, /Canonical Git-backed bank questions are never mutated/i);
  const client = await readFile(new URL("../app/home-client.tsx", import.meta.url), "utf8");
  assert.match(client, /const mergedCanonical = canonical\[type\]\.map/);
  assert.match(client, /ownerQuestion\.acceptanceRate \?\? question\.acceptanceRate/);
});

test("workbenches separate Today from the undated publication queue", async () => {
  const liveState = await readFile(new URL("../db/live-state.ts", import.meta.url), "utf8");
  const liveSync = await readFile(new URL("../app/live-sync.ts", import.meta.url), "utf8");
  const mutationRoute = await readFile(new URL("../app/api/mutations/route.ts", import.meta.url), "utf8");
  const client = await readFile(new URL("../app/home-client.tsx", import.meta.url), "utf8");
  const contract = await readFile(new URL("../docs/contracts/durable-practice-publishing.md", import.meta.url), "utf8");

  assert.match(liveState, /export async function ensureOpenWorkbench/);
  assert.match(liveState, /export async function startFreshWorkbench/);
  const sessionUpsert = liveState.slice(
    liveState.indexOf("export async function upsertLiveSession"),
    liveState.indexOf("export async function startFreshWorkbench"),
  );
  assert.match(sessionUpsert, /revision: sql`\$\{liveSessions\.revision\} \+ 1`/);
  assert.match(liveState, /extraRows[\s\S]*row\.workbenchId === workbench\.id/);
  assert.match(liveState, /includeAll/);
  assert.match(liveSync, /"workbench-start-fresh"/);
  assert.match(mutationRoute, /case "workbench-start-fresh"/);
  assert.match(client, /Start fresh day/);
  assert.match(client, /interview-arc-workspace-ui-v1/);
  assert.match(client, /interview-arc-selected-past/);
  assert.match(client, /interview-arc-selected-bank/);
  assert.match(contract, /Workbench Boundary/);
  assert.match(contract, /undated publication\s+queue/i);
});

test("solution preflight is provisional and identical batch profiles reuse the current revision", async () => {
  const durableStore = await readFile(new URL("../db/durable-practice.ts", import.meta.url), "utf8");
  const bridge = await readFile(new URL("../mcp-worker/index.ts", import.meta.url), "utf8");
  const contract = await readFile(new URL("../docs/contracts/durable-practice-publishing.md", import.meta.url), "utf8");

  assert.match(durableStore, /export async function saveProvisionalSolutionProfile/);
  assert.match(durableStore, /profileFingerprint/);
  assert.match(durableStore, /profileFingerprint\(priorProfile\.payload[\s\S]*=== profileFingerprint\(profile\)/);
  assert.match(durableStore, /solutionProfileDecision/);
  assert.match(durableStore, /provisionalProfile/);
  assert.match(bridge, /"save_provisional_solution_profile"/);
  assert.match(bridge, /researchPerformed/);
  assert.match(contract, /Solution Profile Preflight/);
  assert.match(contract, /chronological completion order/i);
});

test("private R2 audio stays owner-authorized and seekable", async () => {
  const config = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const upload = await readFile(new URL("../app/api/audio/route.ts", import.meta.url), "utf8");
  const stream = await readFile(new URL("../app/api/audio/[id]/route.ts", import.meta.url), "utf8");
  const durableStore = await readFile(new URL("../db/durable-practice.ts", import.meta.url), "utf8");
  const client = await readFile(new URL("../app/home-client.tsx", import.meta.url), "utf8");
  assert.match(config, /"binding": "AUDIO"/);
  assert.match(upload, /resolveOwnerId/);
  assert.match(upload, /env\.AUDIO\.put/);
  assert.match(upload, /transcriptTurnId/);
  assert.match(durableStore, /Answer audio must reference an existing user transcript turn in the same activity/);
  assert.match(stream, /accept-ranges/);
  assert.match(stream, /content-range/);
  assert.match(stream, /cache-control": "private, no-store/);
  assert.ok(client.indexOf("answer-playback") < client.indexOf('"Your answer"'));
  assert.doesNotMatch(client, /type="file"/);
  assert.doesNotMatch(client, /Add an answer recording/);
  assert.doesNotMatch(client, /UNLINKED RECORDINGS · PRIVATE R2/);
});

test("Interview Arc Voice persists exact turns, idempotent clips, and per-answer delivery evidence", async () => {
  const bridge = await readFile(new URL("../mcp-worker/index.ts", import.meta.url), "utf8");
  const durableStore = await readFile(new URL("../db/durable-practice.ts", import.meta.url), "utf8");
  const snapshot = await readFile(new URL("../db/practice-snapshot.ts", import.meta.url), "utf8");
  const client = await readFile(new URL("../app/home-client.tsx", import.meta.url), "utf8");
  for (const route of ["/voice/context", "/voice/timers", "/voice/captures", "/voice/delivery"]) {
    assert.match(bridge, new RegExp(route.replace("/", "\\/")));
  }
  assert.match(bridge, /audio-loss/);
  assert.match(bridge, /acknowledgeVoiceAudioLoss/);
  assert.match(bridge, /publish-without-review/);
  assert.match(bridge, /startedAt: activity\.timer\.startedAt/);
  assert.match(bridge, /runningSince: activity\.timer\.runningSince/);
  assert.match(bridge, /requestedClipId \|\| crypto\.randomUUID\(\)/);
  assert.match(durableStore, /appendVoiceTranscriptTurn/);
  assert.match(durableStore, /Delivery analysis must reference a private clip linked to the same user transcript turn/);
  assert.match(durableStore, /hasCanonicalMaterializedVoiceExchange/);
  assert.match(durableStore, /clip\?\.status !== "available"/);
  assert.match(snapshot, /recordingUnavailableClipIds/);
  assert.ok(client.indexOf("<DeliveryReview") < client.indexOf('"Your answer"'));
  assert.match(client, /GroupedAnswerPlayback/);
  assert.match(client, /onEnded=\{continueToNextSegment\}/);
});

test("Voice context reads the active stopwatch directly instead of rebuilding all practice history", async () => {
  const bridge = await readFile(new URL("../mcp-worker/index.ts", import.meta.url), "utf8");
  const liveState = await readFile(new URL("../db/live-state.ts", import.meta.url), "utf8");
  const voiceContextBody = bridge.slice(
    bridge.indexOf("async function voiceContext"),
    bridge.indexOf("async function saveVoiceCapture"),
  );

  assert.match(liveState, /export async function readActiveVoiceActivity/);
  assert.match(liveState, /export async function readVoiceTimerTarget/);
  assert.match(voiceContextBody, /const date = dateInPracticeTimeZone\(\)/);
  assert.match(voiceContextBody, /readActiveVoiceActivity\(ownerId\)/);
  assert.match(voiceContextBody, /workbenchId: typeof activity\.workbenchId === "string"/);
  assert.doesNotMatch(voiceContextBody, /buildPracticeSnapshot/);
  assert.doesNotMatch(voiceContextBody, /includeAll/);
});

test("Voice timer instrument preserves paused focus and finishes only through an explicit result drawer", async () => {
  const bridge = await readFile(new URL("../mcp-worker/index.ts", import.meta.url), "utf8");
  const liveState = await readFile(new URL("../db/live-state.ts", import.meta.url), "utf8");

  assert.match(liveState, /export async function readVoiceTimerInstrument/);
  assert.match(liveState, /runningActivity \?\? focusedActivity/);
  assert.match(liveState, /activityClass: "focus_block"/);
  assert.match(liveState, /requiresOutcome: false/);
  assert.match(liveState, /requiresOutcome: !focusBlockIds\.has\(activityId\)/);
  assert.match(bridge, /mutation\.type === "finish-activity"/);
  assert.match(bridge, /Choose a result in the Finish drawer/);
  assert.match(bridge, /activity\.activityClass === "focus_block"/);
  assert.match(bridge, /applyFocusTimerAction/);
  assert.match(bridge, /await setOutcome\(ownerId, activity\.id, mutation\.outcome, now\)/);
  assert.match(bridge, /await setProblemStar\(ownerId, activity\.type, activity\.questionId, mutation\.starred, now\)/);
  assert.match(bridge, /await applyTimerAction\(ownerId, activity\.id, "activity", "finish"/);
});

test("consecutive Voice captures form one logical answer without merging their durable turns", () => {
  const base = { activityId: "activity-1", specialty: "system_design", updatedAt: 4 };
  const groups = groupTranscriptTurns([
    { ...base, turnId: "specialist-1", speaker: "specialist", body: "What would you clarify?", source: "codex", sequence: 1, occurredAt: 1 },
    { ...base, turnId: "voice-1", speaker: "user", body: "First part.", source: "audio_transcript", sequence: 2, occurredAt: 2 },
    { ...base, turnId: "voice-2", speaker: "user", body: "Second part.", source: "audio_transcript", sequence: 3, occurredAt: 3 },
    { ...base, turnId: "specialist-2", speaker: "specialist", body: "Follow-up.", source: "codex", sequence: 4, occurredAt: 4 },
  ]);

  assert.equal(groups.length, 3);
  assert.equal(groups[1].kind, "voice_answer");
  assert.deepEqual(groups[1].turns.map((turn) => turn.turnId), ["voice-1", "voice-2"]);
});

test("Voice protocol v2 gates content behind an explicit per-capture decision", async () => {
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  const durable = await readFile(new URL("../db/durable-practice.ts", import.meta.url), "utf8");
  const exchangePolicy = await readFile(new URL("../db/practice-exchange-policy.ts", import.meta.url), "utf8");
  const worker = await readFile(new URL("../mcp-worker/index.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0013_bizarre_the_hand.sql", import.meta.url), "utf8");
  const specialistGuide = await readFile(new URL("../practice/AGENTS.md", import.meta.url), "utf8");
  const leetcodeGuide = await readFile(new URL("../practice/leetcode/AGENTS.md", import.meta.url), "utf8");

  assert.match(schema, /voice_capture_intents/);
  assert.match(schema, /leetcode_code_attempts/);
  assert.match(migration, /CREATE TABLE `voice_capture_intents`/);
  assert.match(migration, /CREATE TABLE `leetcode_code_attempts`/);
  assert.doesNotMatch(migration, /CREATE TABLE `practice_workbenches`/);
  assert.match(durable, /Only an acknowledged activity-related capture can be committed/);
  assert.match(durable, /A captureId cannot be rebound/);
  assert.match(durable, /discarded_unclassified/);
  assert.match(durable, /hasCanonicalMaterializedVoiceExchange/);
  assert.match(durable, /audioLostAcknowledgedAt/);
  assert.match(worker, /\/voice\/intents/);
  assert.match(worker, /audio_already_available/);
  assert.ok(
    worker.indexOf("await env.AUDIO.put")
      < worker.indexOf('updateActivityAudioClipStatus(ownerId, clipId, "available"'),
    "D1 available must be written only after the private R2 put completes",
  );
  assert.match(worker, /resolve_voice_capture/);
  assert.match(worker, /resolve_voice_capture_and_save_response/);
  assert.match(worker, /save_practice_exchange/);
  assert.match(worker, /save_leetcode_code_attempt/);
  assert.match(worker, /semantic paraphrases are rejected/i);
  assert.match(worker, /persistence child must copy those supplied fields verbatim/i);
  const typedExchangeSchema = worker.slice(
    worker.indexOf('"save_practice_exchange"'),
    worker.indexOf('"resolve_voice_capture"'),
  );
  assert.doesNotMatch(typedExchangeSchema, /expectedRevision/);
  const resultControlSchema = worker.slice(
    worker.indexOf('"set_practice_result"'),
    worker.indexOf('"get_today_practice"'),
  );
  assert.match(resultControlSchema, /expectedRevision: z\.number\(\)\.int\(\)\.nonnegative\(\)/);
  assert.match(exchangePolicy, /Transcript not saved · Recording not uploaded/);
  assert.match(specialistGuide, /ambiguous.*uncertain/is);
  assert.match(specialistGuide, /must end with exactly one truthful\s+persistence-status line as its final non-empty line/i);
  assert.match(specialistGuide, /Attachment pending · Practice persistence delegated in background/);
  assert.match(specialistGuide, /Not attached to this practice activity · Not saved to the practice transcript or publication/);
  assert.match(specialistGuide, /put `\*Warm activity context reused\.\*` immediately\s+above the mandatory status line/i);
  assert.match(leetcodeGuide, /Scratch Notes/);
});

test("the reader versions exact user code separately from the reference solution", async () => {
  const client = await readFile(new URL("../app/home-client.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/practice-record/route.ts", import.meta.url), "utf8");
  assert.match(route, /codeAttempts/);
  assert.match(client, /User Code Attempts/);
  assert.match(client, /Code Attempt \{attempt\.sequence\}/);
  assert.match(client, /transcriptBodyWithoutCodeAttempts/);
  assert.match(client, /attemptBodies\.has/);
});

test("the Chrome companion follows live Interview Arc focus and public LeetCode pages", async () => {
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  const serviceWorker = await readFile(new URL("../extension/service-worker.js", import.meta.url), "utf8");
  const sidePanel = await readFile(new URL("../extension/sidepanel.js", import.meta.url), "utf8");
  const sidePanelHtml = await readFile(new URL("../extension/sidepanel.html", import.meta.url), "utf8");
  const mcpWorker = await readFile(new URL("../mcp-worker/index.ts", import.meta.url), "utf8");
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes("sidePanel"));
  assert.deepEqual(manifest.host_permissions, [
    "https://leetcode.com/problems/*",
    "https://www.leetcode.com/problems/*",
    "https://limitless.vinosama.workers.dev/*",
    "https://limitless-mcp.vinosama.workers.dev/*",
  ]);
  assert.equal(manifest.content_scripts, undefined);
  assert.match(serviceWorker, /url\.origin === INTERVIEW_ARC_ORIGIN/);
  assert.match(serviceWorker, /LEETCODE_WWW_ORIGIN/);
  assert.match(serviceWorker, /chrome\.action\.setIcon/);
  assert.match(serviceWorker, /chrome\.runtime\.onStartup/);
  assert.match(serviceWorker, /chrome\.tabs\.query\(\{\}\)/);
  assert.match(sidePanel, /new WebSocket/);
  assert.match(sidePanel, /scheduleFallbackRefresh/);
  assert.doesNotMatch(sidePanel, /refreshInterval/);
  assert.match(sidePanel, /if \(context\.problemUrl\) query\.set\("url", context\.problemUrl\)/);
  assert.match(sidePanel, /chrome\.tabs\.create\(\{ url \}\)/);
  assert.match(sidePanel, /if \(refreshPromise\) \{\s*refreshQueued = true;\s*return refreshPromise;/);
  assert.match(sidePanel, /async function validateConnection\(candidate\)/);
  assert.match(sidePanel, /await chrome\.storage\.local\.set\(\{ interviewArcToken: token \}\)/);
  assert.match(sidePanel, /showOffline\(error\)/);
  assert.match(sidePanel, /if \(error instanceof CompanionAPIError && error\.unauthorized\)/);
  assert.doesNotMatch(
    sidePanel.slice(
      sidePanel.indexOf("async function api("),
      sidePanel.indexOf("function showConnect("),
    ),
    /chrome\.storage\.local\.remove/,
  );
  assert.match(sidePanel, /const nextState = await api\("\/companion\/mutations"/);
  assert.match(sidePanel, /applyCompanionState\(nextState, context\)/);
  const mutationImplementation = sidePanel.slice(
    sidePanel.indexOf("function mutate("),
    sidePanel.indexOf('elements["connect-button"]'),
  );
  assert.doesNotMatch(mutationImplementation, /await refresh\(\)/);
  assert.match(sidePanel, /optimisticTimer\(action\)/);
  assert.match(sidePanelHtml, /id="favorite-button"/);
  assert.match(sidePanelHtml, /id="offline-view"/);
  assert.match(sidePanelHtml, /id="retry-connection"/);
  assert.match(sidePanel, /type: "problem-star", specialty, questionId, starred/);
  assert.match(sidePanel, /currentActivityStarred\(\)/);
  assert.match(mcpWorker, /mutation\.type === "problem-star"/);
  assert.match(mcpWorker, /setProblemStar\(ownerId, mutation\.specialty, mutation\.questionId, mutation\.starred, now\)/);
  assert.match(mcpWorker, /responseUrl\.searchParams\.set\("url", problemUrl\)/);
  assert.match(mcpWorker, /activeCodingActivity \?\? focusedCodingActivity/);
});
