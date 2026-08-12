import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { BEHAVIORAL_PROJECT_FOCUS_VALUES } from "./behavioral-project-deep-dive-policy";

// Live practice state owned by the deployed website. Durable narrative content
// (daily journals, attempt write-ups, transcripts) stays in Git; these tables
// hold only the mutable timer/outcome/draft state that must survive a device
// switch. Every row is scoped to an owner so multi-device use stays isolated.

const ownerId = text("owner_id").notNull();
const updatedAt = integer("updated_at").notNull().default(0);

// Quote selectors keep user highlights stable even when a published artifact
// is revised. Prefix and suffix disambiguate repeated text during re-anchoring.
export const contentHighlights = sqliteTable(
  "content_highlights",
  {
    ownerId,
    id: text("id").notNull(),
    scopeType: text("scope_type", { enum: ["activity", "solution"] }).notNull(),
    scopeId: text("scope_id").notNull(),
    quote: text("quote").notNull(),
    prefix: text("prefix").notNull().default(""),
    suffix: text("suffix").notNull().default(""),
    color: text("color", { enum: ["yellow", "green", "pink"] }).notNull().default("yellow"),
    note: text("note").notNull().default(""),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.id] })],
);

// Highlights may accumulate several independent annotations over time. Notes
// are normalized so each one can be edited, timestamped, or removed without
// mutating the quote anchor itself.
export const contentHighlightNotes = sqliteTable(
  "content_highlight_notes",
  {
    ownerId,
    id: text("id").notNull(),
    highlightId: text("highlight_id").notNull(),
    body: text("body").notNull().default(""),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.id] }),
    index("content_highlight_notes_highlight_idx").on(table.ownerId, table.highlightId),
  ],
);

// One row per running clock. `kind` distinguishes a per-activity stopwatch from
// a six-hour session countdown. Elapsed time is derived, never ticked: the
// display is `accumulatedSeconds + (now - runningSince)` while running.
export const timers = sqliteTable(
  "timers",
  {
    ownerId,
    subjectId: text("subject_id").notNull(),
    kind: text("kind", { enum: ["activity", "session"] }).notNull(),
    accumulatedSeconds: integer("accumulated_seconds").notNull().default(0),
    startedAt: integer("started_at"),
    runningSince: integer("running_since"),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    completedAt: integer("completed_at"),
    // Monotonic audit counter. Specialist commands enforce the caller's
    // expected revision; all surfaces still preserve permanently locked finish.
    revision: integer("revision").notNull().default(0),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.subjectId, table.kind] })],
);

// One durable pointer answers “what am I working on?” even while its stopwatch
// is paused. The focused session is stored separately because a session may be
// active before the user chooses its first activity.
export const practiceFocus = sqliteTable("practice_focus", {
  ownerId: text("owner_id").primaryKey(),
  activityId: text("activity_id"),
  sessionId: text("session_id"),
  focusedAt: integer("focused_at"),
  updatedAt,
});

// A workbench is the durable boundary behind the user-facing "practice day".
// It is intentionally independent from Pacific calendar dates: a late-night
// session can continue across midnight until the user explicitly starts fresh.
export const practiceWorkbenches = sqliteTable(
  "practice_workbenches",
  {
    ownerId,
    id: text("id").notNull(),
    status: text("status", { enum: ["open", "archived"] }).notNull().default("open"),
    openedPacificDate: text("opened_pacific_date").notNull(),
    openedAt: integer("opened_at").notNull(),
    closedAt: integer("closed_at"),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.id] }),
    index("practice_workbenches_owner_status_idx").on(table.ownerId, table.status),
  ],
);

// Immutable clock segments preserve exact active intervals across Pacific
// midnight. They support day-sliced statistics without guessing from totals.
export const timerIntervals = sqliteTable(
  "timer_intervals",
  {
    ownerId,
    subjectId: text("subject_id").notNull(),
    kind: text("kind", { enum: ["activity", "session"] }).notNull(),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.subjectId, table.kind, table.startedAt] })],
);

// Canonical three-state result flag, kept separate from timer completion. The
// UI translates the same values to finished/finished-after-review/failed for
// system-design and behavioral activities.
export const outcomes = sqliteTable(
  "outcomes",
  {
    ownerId,
    activityId: text("activity_id").notNull(),
    outcome: text("outcome", {
      enum: ["solved", "solved_after_reviewing_approach", "failed"],
    }).notNull(),
    revision: integer("revision").notNull().default(0),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.activityId] })],
);

// Publication state persists specialist completion and legacy explicit readiness.
// The read model also derives `ready` from a finished activity timer. Outcome is
// separate metadata, so a flag alone cannot move planned work into the queue.
export const publicationStatuses = sqliteTable(
  "publication_statuses",
  {
    ownerId,
    activityId: text("activity_id").notNull(),
    date: text("date").notNull(),
    status: text("status", { enum: ["draft", "ready", "published"] }).notNull().default("draft"),
    artifactPath: text("artifact_path"),
    publishedAt: integer("published_at"),
    revision: integer("revision").notNull().default(0),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.activityId] })],
);

// Short personal notes can be edited from the website or companion for any
// activity. Specialists append immutable/pinned note records below.
export const activityNotes = sqliteTable(
  "activity_notes",
  {
    ownerId,
    activityId: text("activity_id").notNull(),
    date: text("date").notNull(),
    note: text("note").notNull().default(""),
    revision: integer("revision").notNull().default(0),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.activityId] })],
);

// Pinned, activity-scoped notes are first-class records for every practice
// category. The legacy single-note row above remains readable by older clients;
// new specialist/coordinator workflows append here without overwriting history.
export const practiceNotes = sqliteTable(
  "practice_notes",
  {
    ownerId,
    id: text("id").notNull(),
    activityId: text("activity_id").notNull(),
    date: text("date").notNull(),
    body: text("body").notNull(),
    kind: text("kind", { enum: ["remember", "insight", "mistake", "pattern", "question"] })
      .notNull()
      .default("remember"),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.id] })],
);

// Durable transcript events are appended in small idempotent batches. They are
// activity-scoped: website/admin conversation must never be copied into a
// practice transcript merely because it happened in the same Codex task.
export const practiceTranscriptTurns = sqliteTable(
  "practice_transcript_turns",
  {
    ownerId,
    activityId: text("activity_id").notNull(),
    turnId: text("turn_id").notNull(),
    specialty: text("specialty", { enum: ["leetcode", "system_design", "behavioral"] }).notNull(),
    speaker: text("speaker", { enum: ["user", "specialist"] }).notNull(),
    body: text("body").notNull(),
    source: text("source", { enum: ["codex", "dictation", "audio_transcript"] }).notNull().default("codex"),
    sequence: integer("sequence").notNull(),
    occurredAt: integer("occurred_at").notNull(),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.activityId, table.turnId] })],
);

// Destructive transcript remediation keeps an immutable owner-scoped
// tombstone. It proves which exact typed pair was removed, makes transport
// retries idempotent, and prevents deleted stable turn IDs from being reused.
export const typedPracticeExchangeDeletions = sqliteTable(
  "typed_practice_exchange_deletions",
  {
    ownerId,
    operationId: text("operation_id").notNull(),
    activityId: text("activity_id").notNull(),
    userTurnId: text("user_turn_id").notNull(),
    responseTurnId: text("response_turn_id").notNull(),
    specialty: text("specialty", { enum: ["leetcode", "system_design", "behavioral"] }).notNull(),
    expectedRevision: integer("expected_revision").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    reason: text("reason").notNull(),
    receipt: text("receipt", { mode: "json" }).notNull(),
    deletedAt: integer("deleted_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.operationId] }),
    uniqueIndex("typed_exchange_deletions_user_turn_unique").on(
      table.ownerId,
      table.activityId,
      table.userTurnId,
    ),
    uniqueIndex("typed_exchange_deletions_response_turn_unique").on(
      table.ownerId,
      table.activityId,
      table.responseTurnId,
    ),
  ],
);

// Voice protocol v2 registers only stable identity and checksum until the
// specialist decides whether the Codex turn belongs to the focused activity.
// Transcript text and audio remain local while this row is unresolved.
export const voiceCaptureIntents = sqliteTable(
  "voice_capture_intents",
  {
    ownerId,
    captureId: text("capture_id").notNull(),
    activityId: text("activity_id").notNull(),
    turnId: text("turn_id").notNull(),
    clipId: text("clip_id").notNull(),
    specialty: text("specialty", { enum: ["leetcode", "system_design", "behavioral"] }).notNull(),
    status: text("status", {
      enum: [
        "pending",
        "activity_related",
        "accepted",
        "unrelated",
        "uncertain",
        "deleting",
        "deleted",
        "discarded_unclassified",
        "expired_unclassified",
        "quarantined_conflict",
      ],
    }).notNull().default("pending"),
    checksum: text("checksum").notNull(),
    occurredAt: integer("occurred_at").notNull(),
    decidedAt: integer("decided_at"),
    decisionSource: text("decision_source"),
    decisionReason: text("decision_reason"),
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.captureId] }),
    index("voice_capture_intents_owner_status_updated_idx").on(
      table.ownerId,
      table.status,
      table.updatedAt,
      table.captureId,
    ),
  ],
);

// The specialist response to a protocol-v2 Voice turn is reserved together
// with the activity-related decision. It stays provisional until Voice
// delivers the acknowledged user transcript, then both turns materialize in
// sequence exactly once. Retrying the same immutable response is idempotent;
// conflicting reuse is rejected without mutating the first canonical evidence.
export const voiceSpecialistResponses = sqliteTable(
  "voice_specialist_responses",
  {
    ownerId,
    captureId: text("capture_id").notNull(),
    activityId: text("activity_id").notNull(),
    userTurnId: text("user_turn_id").notNull(),
    responseTurnId: text("response_turn_id").notNull(),
    specialty: text("specialty", { enum: ["leetcode", "system_design", "behavioral"] }).notNull(),
    responseBody: text("response_body").notNull(),
    responseOccurredAt: integer("response_occurred_at").notNull(),
    status: text("status", {
      enum: ["provisional", "materialized", "discarded", "quarantined_conflict"],
    }).notNull().default("provisional"),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.captureId] }),
    uniqueIndex("voice_specialist_responses_owner_response_unique").on(
      table.ownerId,
      table.responseTurnId,
    ),
    index("voice_specialist_responses_owner_status_idx").on(
      table.ownerId,
      table.status,
      table.updatedAt,
    ),
  ],
);

// Single- and multi-capture response flows share this owner-scoped identity
// fence. Inserting every capture and response-turn identity in the same D1
// batch makes competing cross-flow reservations mutually exclusive.
export const voiceExchangeReservations = sqliteTable(
  "voice_exchange_reservations",
  {
    ownerId,
    identityType: text("identity_type", { enum: ["capture", "response_turn"] }).notNull(),
    identity: text("identity").notNull(),
    exchangeKind: text("exchange_kind", { enum: ["single", "group"] }).notNull(),
    responseTurnId: text("response_turn_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.identityType, table.identity] }),
    index("voice_exchange_reservations_response_idx").on(table.ownerId, table.responseTurnId),
  ],
);

// Consecutive Voice-managed user turns can form one logical answer. The group
// reserves one immutable specialist response while each ordered member keeps
// its own capture, transcript, audio, and delivery-analysis identity.
export const voiceResponseGroups = sqliteTable(
  "voice_response_groups",
  {
    ownerId,
    responseTurnId: text("response_turn_id").notNull(),
    activityId: text("activity_id").notNull(),
    specialty: text("specialty", { enum: ["leetcode", "system_design", "behavioral"] }).notNull(),
    responseBody: text("response_body").notNull(),
    responseOccurredAt: integer("response_occurred_at").notNull(),
    memberCount: integer("member_count").notNull(),
    status: text("status", {
      enum: ["provisional", "materialized", "deleting", "quarantined_conflict"],
    }).notNull().default("provisional"),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.responseTurnId] })],
);

export const voiceResponseGroupMembers = sqliteTable(
  "voice_response_group_members",
  {
    ownerId,
    captureId: text("capture_id").notNull(),
    responseTurnId: text("response_turn_id").notNull(),
    activityId: text("activity_id").notNull(),
    userTurnId: text("user_turn_id").notNull(),
    memberOrder: integer("member_order").notNull(),
    transcript: text("transcript"),
    checksum: text("checksum"),
    occurredAt: integer("occurred_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.captureId] }),
    uniqueIndex("voice_response_group_members_order_unique").on(
      table.ownerId,
      table.responseTurnId,
      table.memberOrder,
    ),
    uniqueIndex("voice_response_group_members_turn_unique").on(
      table.ownerId,
      table.activityId,
      table.userTurnId,
    ),
    index("voice_response_group_members_response_idx").on(table.ownerId, table.responseTurnId),
  ],
);

// Every coordinator-authorized Voice response recovery is recorded without
// transcript or audio content. The event makes a state repair reviewable while
// keeping the immutable canonical exchange as the source of truth.
export const voiceResponseGroupRepairEvents = sqliteTable(
  "voice_response_group_repair_events",
  {
    ownerId,
    id: text("id").notNull(),
    responseTurnId: text("response_turn_id").notNull(),
    activityId: text("activity_id").notNull(),
    priorStatus: text("prior_status").notNull(),
    resultStatus: text("result_status").notNull(),
    reason: text("reason").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.id] }),
    index("voice_response_group_repair_events_group_idx").on(
      table.ownerId,
      table.responseTurnId,
      table.createdAt,
    ),
  ],
);

// A specialist can classify the protocol-v2 envelope immediately after Voice
// inserts it, before Voice's background metadata registration reaches the
// Worker. This short-lived owner-scoped row closes that race without storing
// transcript text or audio.
export const deferredVoiceCaptureDecisions = sqliteTable(
  "deferred_voice_capture_decisions",
  {
    ownerId,
    captureId: text("capture_id").notNull(),
    activityId: text("activity_id").notNull(),
    turnId: text("turn_id").notNull(),
    decision: text("decision", {
      enum: ["activity_related", "unrelated", "uncertain"],
    }).notNull(),
    decisionSource: text("decision_source").notNull(),
    decisionReason: text("decision_reason").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.captureId] }),
    index("deferred_voice_capture_decisions_owner_expiry_idx").on(
      table.ownerId,
      table.expiresAt,
    ),
  ],
);

// Exact user code is versioned independently from the generated reference
// solution. A specialist creates this only across an explicit attempt boundary.
export const leetcodeCodeAttempts = sqliteTable(
  "leetcode_code_attempts",
  {
    ownerId,
    id: text("id").notNull(),
    activityId: text("activity_id").notNull(),
    originatingTurnId: text("originating_turn_id").notNull(),
    sequence: integer("sequence").notNull(),
    language: text("language").notNull(),
    code: text("code").notNull(),
    lineCount: integer("line_count").notNull(),
    occurredAt: integer("occurred_at").notNull(),
    review: text("review", { mode: "json" }),
    reviewResponseTurnId: text("review_response_turn_id"),
    observedCorrectness: text("observed_correctness", {
      enum: ["not_verified", "appears_correct", "issues_found", "incomplete"],
    }).notNull().default("not_verified"),
    concreteFindings: text("concrete_findings", { mode: "json" }).notNull(),
    edgeCases: text("edge_cases", { mode: "json" }).notNull(),
    complexity: text("complexity", { mode: "json" }),
    finalDeclaration: text("final_declaration").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.id] }),
    uniqueIndex("code_attempts_owner_activity_sequence_idx").on(
      table.ownerId,
      table.activityId,
      table.sequence,
    ),
  ],
);

// Historical review repair is explicit and auditable. The source specialist
// turn remains in the activity transcript; this row records which visible
// evidence authorized the one-time structured backfill.
export const leetcodeCodeAttemptReviewBackfills = sqliteTable(
  "leetcode_code_attempt_review_backfills",
  {
    ownerId,
    attemptId: text("attempt_id").notNull(),
    activityId: text("activity_id").notNull(),
    reviewResponseTurnId: text("review_response_turn_id").notNull(),
    review: text("review", { mode: "json" }).notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    reason: text("reason").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.attemptId] }),
    index("code_attempt_review_backfills_activity_idx").on(table.ownerId, table.activityId),
  ],
);

// A specialist writes one ready bundle after flushing its draft. The
// coordinator consumes this JSON payload to render versioned Markdown; writing
// this row is finalization, not publication.
export const activityFinalizations = sqliteTable(
  "activity_finalizations",
  {
    ownerId,
    activityId: text("activity_id").notNull(),
    specialty: text("specialty", { enum: ["leetcode", "system_design", "behavioral"] }).notNull(),
    status: text("status", { enum: ["draft", "ready", "published"] }).notNull().default("draft"),
    payload: text("payload", { mode: "json" }).notNull(),
    finalizedAt: integer("finalized_at"),
    publishedAt: integer("published_at"),
    revision: integer("revision").notNull().default(0),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.activityId] })],
);

// Completed behavioral answers are append-only attempt evidence. A correction
// creates another revision and names the revision it replaces; it never edits
// or backfills the historical snapshot. The payload contains only sanitized,
// owner-private revision identities—never raw job descriptions or target
// analysis.
export const behavioralFinalAnswerSnapshots = sqliteTable(
  "behavioral_final_answer_snapshots",
  {
    ownerId,
    activityId: text("activity_id").notNull(),
    snapshotRevision: integer("snapshot_revision").notNull(),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    snapshot: text("snapshot", { mode: "json" }).notNull(),
    correctionOfRevision: integer("correction_of_revision"),
    correctionReason: text("correction_reason"),
    finalizedAt: integer("finalized_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.activityId, table.snapshotRevision] }),
    uniqueIndex("behavioral_final_answer_operation_idx").on(table.ownerId, table.operationId),
  ],
);

// Review scheduling is tied to the stable bank question when available and to
// the activity otherwise. A full walkthrough/failed attempt starts at four
// days; approach review starts at seven; successful recalls advance to 21/60.
export const reviewSchedules = sqliteTable(
  "review_schedules",
  {
    ownerId,
    reviewKey: text("review_key").notNull(),
    activityId: text("activity_id").notNull(),
    questionId: text("question_id"),
    specialty: text("specialty", { enum: ["leetcode", "system_design", "behavioral"] }).notNull(),
    status: text("status", { enum: ["scheduled", "due", "completed", "dismissed"] }).notNull().default("scheduled"),
    reason: text("reason", { enum: ["failed", "full_walkthrough", "approach_review", "manual", "successful_recall"] }).notNull(),
    dueDate: text("due_date").notNull(),
    intervalDays: integer("interval_days").notNull(),
    stage: integer("stage").notNull().default(0),
    reviewCount: integer("review_count").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.reviewKey] })],
);

// Stable task identifiers remove the need for the user to paste task IDs on
// every publish. Titles are discovery labels only; the registered IDs are the
// durable routing source of truth.
export const specialistTasks = sqliteTable(
  "specialist_tasks",
  {
    ownerId,
    specialty: text("specialty", { enum: ["leetcode", "system_design", "behavioral", "loop_recorder", "resume_cover_letter"] }).notNull(),
    threadId: text("thread_id").notNull(),
    hostId: text("host_id"),
    title: text("title").notNull(),
    connectedAt: integer("connected_at").notNull(),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.specialty] })],
);

// Audio stays outside Git. These rows describe private R2 objects and their
// relationship to an activity; the object key is never exposed as a public URL.
export const activityAudioClips = sqliteTable(
  "activity_audio_clips",
  {
    ownerId,
    id: text("id").notNull(),
    activityId: text("activity_id").notNull(),
    transcriptTurnId: text("transcript_turn_id"),
    objectKey: text("object_key").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    label: text("label").notNull().default("Practice answer"),
    durationSeconds: integer("duration_seconds"),
    status: text("status", { enum: ["local_only", "uploading", "available", "failed", "audio_lost"] }).notNull().default("local_only"),
    audioLostReason: text("audio_lost_reason"),
    audioLostDetectedAt: integer("audio_lost_detected_at"),
    audioLostAcknowledgedAt: integer("audio_lost_acknowledged_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.id] })],
);

// Delivery coaching is stored beside the private clip it evaluates. The JSON
// payload contains observable speech evidence only (pace, pauses, fillers,
// clarity, organization, and vocal variation); it must never infer a user's
// mental state or other sensitive traits.
export const activityDeliveryAnalyses = sqliteTable(
  "activity_delivery_analyses",
  {
    ownerId,
    id: text("id").notNull(),
    activityId: text("activity_id").notNull(),
    audioClipId: text("audio_clip_id").notNull(),
    transcriptTurnId: text("transcript_turn_id").notNull(),
    specialty: text("specialty", { enum: ["leetcode", "system_design", "behavioral"] }).notNull(),
    status: text("status", { enum: ["queued", "processing", "available", "failed"] }).notNull().default("queued"),
    payload: text("payload", { mode: "json" }),
    error: text("error"),
    publishWithoutReviewAcknowledgedAt: integer("publish_without_review_acknowledged_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.id] })],
);

// A star is an owner-specific preference on the stable bank question, never on
// one dated attempt. Every surface joins through specialty + question id.
export const problemPreferences = sqliteTable(
  "problem_preferences",
  {
    ownerId,
    specialty: text("specialty", { enum: ["leetcode", "system_design", "behavioral"] }).notNull(),
    questionId: text("question_id").notNull(),
    starred: integer("starred", { mode: "boolean" }).notNull().default(false),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.specialty, table.questionId] })],
);

// Solution Profiles are the reusable, current answer attached to a Problem.
// Attempt transcripts never live here; each dated activity retains its own
// transcript and feedback while linking to the solution revision it produced.
export const problemSolutionProfiles = sqliteTable(
  "problem_solution_profiles",
  {
    ownerId,
    specialty: text("specialty", { enum: ["leetcode", "system_design", "behavioral"] }).notNull(),
    questionId: text("question_id").notNull(),
    title: text("title").notNull(),
    currentRevision: integer("current_revision").notNull().default(1),
    tags: text("tags", { mode: "json" }).notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.specialty, table.questionId] })],
);

// Reference preflight may happen before an attempt is publishable. Keeping that
// prepared answer separately lets every later attempt reuse the research while
// reserving numbered Solution Profile revisions for finalized practice.
export const provisionalSolutionProfiles = sqliteTable(
  "provisional_solution_profiles",
  {
    ownerId,
    specialty: text("specialty", { enum: ["leetcode", "system_design", "behavioral"] }).notNull(),
    questionId: text("question_id").notNull(),
    title: text("title").notNull(),
    tags: text("tags", { mode: "json" }).notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    preparedByActivityId: text("prepared_by_activity_id"),
    decision: text("decision", { mode: "json" }),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.specialty, table.questionId] })],
);

export const problemSolutionRevisions = sqliteTable(
  "problem_solution_revisions",
  {
    ownerId,
    specialty: text("specialty", { enum: ["leetcode", "system_design", "behavioral"] }).notNull(),
    questionId: text("question_id").notNull(),
    revision: integer("revision").notNull(),
    activityId: text("activity_id").notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.specialty, table.questionId, table.revision] })],
);

export const activitySolutionLinks = sqliteTable(
  "activity_solution_links",
  {
    ownerId,
    activityId: text("activity_id").notNull(),
    specialty: text("specialty", { enum: ["leetcode", "system_design", "behavioral"] }).notNull(),
    questionId: text("question_id").notNull(),
    solutionRevision: integer("solution_revision").notNull(),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.activityId] })],
);

// Resume-foundation and user-authored questions stay owner-scoped in D1 so
// private resume details never have to be committed to a shared Git bank.
export const ownerBankQuestions = sqliteTable(
  "owner_bank_questions",
  {
    ownerId,
    specialty: text("specialty", { enum: ["leetcode", "system_design", "behavioral"] }).notNull(),
    questionId: text("question_id").notNull(),
    title: text("title").notNull(),
    prompt: text("prompt"),
    url: text("url"),
    source: text("source").notNull().default("personal"),
    tags: text("tags", { mode: "json" }).notNull(),
    problemNumber: integer("problem_number"),
    difficulty: text("difficulty", { enum: ["easy", "medium", "hard"] }),
    acceptanceRate: real("acceptance_rate"),
    topics: text("topics", { mode: "json" }).notNull().default(sql`'[]'`),
    companyTags: text("company_tags", { mode: "json" }).notNull().default(sql`'[]'`),
    companySignals: text("company_signals", { mode: "json" }).notNull().default(sql`'[]'`),
    metadataReferences: text("metadata_references", { mode: "json" }).notNull().default(sql`'[]'`),
    metadataCapturedAt: integer("metadata_captured_at"),
    priority: integer("priority").notNull().default(0),
    targetMinutes: integer("target_minutes").notNull().default(60),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.specialty, table.questionId] })],
);

// Project Deep Dive identity is explicit and owner-scoped. Question titles,
// prompts, employers, and free-form tags are discovery metadata only; they are
// never used as runtime binding authority. The current row is a pointer while
// immutable revisions preserve every correction.
export const behavioralProjectQuestionBindings = sqliteTable(
  "behavioral_project_question_bindings",
  {
    ownerId,
    questionId: text("question_id").notNull(),
    currentRevision: integer("current_revision").notNull(),
    projectId: text("project_id").notNull(),
    focus: text("focus", { enum: BEHAVIORAL_PROJECT_FOCUS_VALUES }).notNull(),
    sourceClaimId: text("source_claim_id"),
    state: text("state", { enum: ["active", "archived"] }).notNull().default("active"),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.questionId] }),
    index("behavioral_project_bindings_project_idx").on(table.ownerId, table.projectId, table.focus, table.state),
    uniqueIndex("behavioral_project_overview_unique")
      .on(table.ownerId, table.projectId)
      .where(sql`${table.state} = 'active' AND ${table.focus} = 'project_overview'`),
    uniqueIndex("behavioral_project_resume_claim_unique")
      .on(table.ownerId, table.projectId, table.sourceClaimId)
      .where(sql`${table.state} = 'active' AND ${table.focus} = 'resume_claim'`),
  ],
);

export const behavioralProjectQuestionBindingRevisions = sqliteTable(
  "behavioral_project_question_binding_revisions",
  {
    ownerId,
    questionId: text("question_id").notNull(),
    revision: integer("revision").notNull(),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    projectId: text("project_id").notNull(),
    focus: text("focus", { enum: BEHAVIORAL_PROJECT_FOCUS_VALUES }).notNull(),
    sourceClaimId: text("source_claim_id"),
    state: text("state", { enum: ["active", "archived"] }).notNull(),
    reason: text("reason").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.questionId, table.revision] }),
    uniqueIndex("behavioral_project_binding_revision_operation_idx").on(table.ownerId, table.operationId),
  ],
);

export const behavioralProjectActivityLinks = sqliteTable(
  "behavioral_project_activity_links",
  {
    ownerId,
    activityId: text("activity_id").notNull(),
    questionId: text("question_id").notNull(),
    bindingRevision: integer("binding_revision").notNull(),
    projectId: text("project_id").notNull(),
    focus: text("focus", { enum: BEHAVIORAL_PROJECT_FOCUS_VALUES }).notNull(),
    sourceClaimId: text("source_claim_id"),
    solutionRevision: integer("solution_revision"),
    source: text("source", { enum: ["finalization", "completed_attempt_backfill"] }).notNull(),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    linkedAt: integer("linked_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.activityId] }),
    uniqueIndex("behavioral_project_activity_link_operation_idx").on(table.ownerId, table.operationId),
    index("behavioral_project_activity_link_project_idx").on(table.ownerId, table.projectId, table.linkedAt),
  ],
);

export const behavioralProjectOperations = sqliteTable(
  "behavioral_project_operations",
  {
    ownerId,
    operationId: text("operation_id").notNull(),
    action: text("action", { enum: ["set_question_binding", "link_completed_attempt"] }).notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    receipt: text("receipt", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.operationId] })],
);

// Behavioral evidence is sanitized before it reaches D1. These rows contain
// no local source locator or raw source bytes; every relationship remains
// owner-scoped so accepted evidence cannot cross account boundaries.
export const behavioralEvidenceSources = sqliteTable(
  "behavioral_evidence_sources",
  {
    ownerId,
    sourceId: text("source_id").notNull(),
    currentRevision: integer("current_revision").notNull(),
    state: text("state", { enum: ["active", "archived"] }).notNull(),
    projectKey: text("project_key").notNull(),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    safeHint: text("safe_hint").notNull(),
    availability: text("availability", { enum: ["available", "missing", "not_checked", "blocked"] }).notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.sourceId] }),
    index("behavioral_evidence_sources_owner_state_idx").on(table.ownerId, table.state, table.updatedAt),
    index("behavioral_evidence_sources_owner_project_idx").on(table.ownerId, table.projectKey),
  ],
);

export const behavioralEvidenceSourceRevisions = sqliteTable(
  "behavioral_evidence_source_revisions",
  {
    ownerId,
    sourceId: text("source_id").notNull(),
    revision: integer("revision").notNull(),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    snapshot: text("snapshot", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.sourceId, table.revision] }),
    uniqueIndex("behavioral_evidence_source_revisions_operation_idx").on(table.ownerId, table.operationId),
  ],
);

export const behavioralEvidenceSourceOperations = sqliteTable(
  "behavioral_evidence_source_operations",
  {
    ownerId,
    operationId: text("operation_id").notNull(),
    sourceId: text("source_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    sourceRevision: integer("source_revision").notNull(),
    status: text("status", { enum: ["created", "revised", "unchanged"] }).notNull(),
    receipt: text("receipt", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.operationId] })],
);

export const behavioralEvidenceItems = sqliteTable(
  "behavioral_evidence_items",
  {
    ownerId,
    evidenceId: text("evidence_id").notNull(),
    projectKey: text("project_key").notNull(),
    origin: text("origin").notNull(),
    statement: text("statement").notNull(),
    sourceRevision: text("source_revision"),
    evidenceGrade: text("evidence_grade", { enum: ["E0", "E1", "E2", "E3"] }).notNull(),
    attributionGrade: text("attribution_grade", { enum: ["A0", "A1", "A2", "A3"] }).notNull(),
    claimStrength: text("claim_strength", {
      enum: ["project_fact", "personal_contribution_candidate", "user_confirmation_required", "unsupported", "contradicted"],
    }).notNull(),
    candidateState: text("candidate_state", { enum: ["pending", "accepted", "rejected", "superseded"] }).notNull(),
    visibility: text("visibility", { enum: ["owner_private"] }).notNull().default("owner_private"),
    safeProvenance: text("safe_provenance", { mode: "json" }).notNull(),
    supports: text("supports", { mode: "json" }).notNull(),
    limitations: text("limitations", { mode: "json" }).notNull(),
    tags: text("tags", { mode: "json" }).notNull(),
    ownerAttestation: text("owner_attestation", { mode: "json" }),
    reviewRevision: integer("review_revision").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.evidenceId] }),
    index("behavioral_evidence_owner_project_idx").on(table.ownerId, table.projectKey),
    index("behavioral_evidence_owner_state_idx").on(table.ownerId, table.candidateState),
  ],
);

export const behavioralEvidenceQuestionLinks = sqliteTable(
  "behavioral_evidence_question_links",
  {
    ownerId,
    questionId: text("question_id").notNull(),
    evidenceId: text("evidence_id").notNull(),
    relevance: text("relevance", { enum: ["supporting", "contrary"] }).notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.questionId, table.evidenceId] }),
    index("behavioral_evidence_question_idx").on(table.ownerId, table.questionId, table.relevance),
  ],
);

export const behavioralEvidenceReviewOperations = sqliteTable(
  "behavioral_evidence_review_operations",
  {
    ownerId,
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    receipt: text("receipt", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.operationId] })],
);

export const behavioralEvidenceReviewEvents = sqliteTable(
  "behavioral_evidence_review_events",
  {
    ownerId,
    evidenceId: text("evidence_id").notNull(),
    revision: integer("revision").notNull(),
    operationId: text("operation_id").notNull(),
    fromState: text("from_state", { enum: ["pending", "accepted", "rejected", "superseded"] }).notNull(),
    toState: text("to_state", { enum: ["accepted", "rejected", "superseded"] }).notNull(),
    reason: text("reason").notNull(),
    replacementEvidenceId: text("replacement_evidence_id"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.evidenceId, table.revision] }),
    index("behavioral_evidence_review_events_operation_idx").on(table.ownerId, table.operationId),
  ],
);

export const behavioralClaims = sqliteTable(
  "behavioral_claims",
  {
    ownerId,
    claimId: text("claim_id").notNull(),
    questionId: text("question_id").notNull(),
    text: text("text").notNull(),
    scope: text("scope", {
      enum: ["project", "personal_contribution", "ownership", "decision", "production", "scale", "metric", "result", "leadership"],
    }).notNull(),
    status: text("status", { enum: ["unverified", "partial", "verified", "contradicted"] }).notNull(),
    claimStrength: text("claim_strength", {
      enum: ["project_fact", "personal_contribution_candidate", "user_confirmation_required", "unsupported", "contradicted"],
    }).notNull(),
    evidenceIds: text("evidence_ids", { mode: "json" }).notNull(),
    contraryEvidenceIds: text("contrary_evidence_ids", { mode: "json" }).notNull(),
    gaps: text("gaps", { mode: "json" }).notNull(),
    saferWording: text("safer_wording"),
    tags: text("tags", { mode: "json" }).notNull(),
    visibility: text("visibility", { enum: ["owner_private"] }).notNull().default("owner_private"),
    revision: integer("revision").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.claimId] }),
    index("behavioral_claims_question_idx").on(table.ownerId, table.questionId, table.status),
  ],
);

export const behavioralClaimStatusEvents = sqliteTable(
  "behavioral_claim_status_events",
  {
    ownerId,
    claimId: text("claim_id").notNull(),
    revision: integer("revision").notNull(),
    operationId: text("operation_id").notNull(),
    status: text("status", { enum: ["unverified", "partial", "verified", "contradicted"] }).notNull(),
    snapshot: text("snapshot", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.claimId, table.revision] }),
    uniqueIndex("behavioral_claim_events_operation_idx").on(table.ownerId, table.operationId),
  ],
);

// Behavioral stories are owner-private, evidence-backed STARL records. The
// stable row is only a current pointer; immutable revisions preserve the exact
// reusable story that existed when a later answer selected it.
export const behavioralStories = sqliteTable(
  "behavioral_stories",
  {
    ownerId,
    storyId: text("story_id").notNull(),
    currentRevision: integer("current_revision").notNull(),
    state: text("state", { enum: ["active", "archived"] }).notNull(),
    title: text("title").notNull(),
    projectKey: text("project_key").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.storyId] }),
    index("behavioral_stories_owner_state_idx").on(table.ownerId, table.state, table.updatedAt),
  ],
);

export const behavioralStoryRevisions = sqliteTable(
  "behavioral_story_revisions",
  {
    ownerId,
    storyId: text("story_id").notNull(),
    revision: integer("revision").notNull(),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    snapshot: text("snapshot", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.storyId, table.revision] }),
    uniqueIndex("behavioral_story_revisions_operation_idx").on(table.ownerId, table.operationId),
  ],
);

export const behavioralStoryOperations = sqliteTable(
  "behavioral_story_operations",
  {
    ownerId,
    operationId: text("operation_id").notNull(),
    storyId: text("story_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    storyRevision: integer("story_revision").notNull(),
    status: text("status", { enum: ["created", "revised", "unchanged"] }).notNull(),
    receipt: text("receipt", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.operationId] })],
);

export const behavioralStoryQuestionLinks = sqliteTable(
  "behavioral_story_question_links",
  {
    ownerId,
    storyId: text("story_id").notNull(),
    questionId: text("question_id").notNull(),
    storyRevision: integer("story_revision").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.storyId, table.questionId] }),
    index("behavioral_story_question_idx").on(table.ownerId, table.questionId, table.storyRevision),
  ],
);

// Target Profiles are owner-private hiring-context inputs, never candidate
// evidence. The stable row is only a current pointer; every revision remains
// append-only so completed attempts can retain the exact target they used.
export const behavioralTargetProfiles = sqliteTable(
  "behavioral_target_profiles",
  {
    ownerId,
    targetId: text("target_id").notNull(),
    currentRevision: integer("current_revision").notNull(),
    state: text("state", { enum: ["active", "archived"] }).notNull(),
    label: text("label").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.targetId] }),
    index("behavioral_target_profiles_owner_state_idx").on(table.ownerId, table.state, table.updatedAt),
  ],
);

export const behavioralTargetProfileRevisions = sqliteTable(
  "behavioral_target_profile_revisions",
  {
    ownerId,
    targetId: text("target_id").notNull(),
    revision: integer("revision").notNull(),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    sourceFingerprint: text("source_fingerprint").notNull(),
    displaySnapshot: text("display_snapshot", { mode: "json" }).notNull(),
    privateSnapshot: text("private_snapshot", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.targetId, table.revision] }),
    uniqueIndex("behavioral_target_revisions_operation_idx").on(table.ownerId, table.operationId),
  ],
);

export const behavioralTargetProfileOperations = sqliteTable(
  "behavioral_target_profile_operations",
  {
    ownerId,
    operationId: text("operation_id").notNull(),
    targetId: text("target_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    targetRevision: integer("target_revision").notNull(),
    status: text("status", { enum: ["created", "revised", "unchanged"] }).notNull(),
    receipt: text("receipt", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.operationId] })],
);

export const behavioralTargetBindings = sqliteTable(
  "behavioral_target_bindings",
  {
    ownerId,
    scopeType: text("scope_type", { enum: ["session", "activity"] }).notNull(),
    scopeId: text("scope_id").notNull(),
    targetId: text("target_id"),
    targetRevision: integer("target_revision"),
    revision: integer("revision").notNull(),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.scopeType, table.scopeId] })],
);

export const behavioralTargetBindingMutations = sqliteTable(
  "behavioral_target_binding_mutations",
  {
    ownerId,
    mutationId: text("mutation_id").notNull(),
    scopeType: text("scope_type", { enum: ["session", "activity"] }).notNull(),
    scopeId: text("scope_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    receipt: text("receipt", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.mutationId] })],
);

// A Loop is one owner-private company-and-role hiring process. Its stable row
// contains current pointers only; append-only snapshots preserve every stage,
// debrief, and Role Brief revision without silently rewriting history.
export const interviewLoops = sqliteTable(
  "interview_loops",
  {
    ownerId,
    loopId: text("loop_id").notNull(),
    currentRevision: integer("current_revision").notNull(),
    currentRoleBriefRevision: integer("current_role_brief_revision").notNull(),
    state: text("state", { enum: ["active", "archived"] }).notNull(),
    company: text("company").notNull(),
    roleTitle: text("role_title").notNull(),
    status: text("status", { enum: ["active", "paused", "completed", "withdrawn"] }).notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.loopId] }),
    index("interview_loops_owner_state_idx").on(table.ownerId, table.state, table.updatedAt),
  ],
);

export const interviewLoopRevisions = sqliteTable(
  "interview_loop_revisions",
  {
    ownerId,
    loopId: text("loop_id").notNull(),
    revision: integer("revision").notNull(),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    snapshot: text("snapshot", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.loopId, table.revision] }),
    uniqueIndex("interview_loop_revisions_operation_idx").on(table.ownerId, table.operationId),
  ],
);

export const loopRoleBriefRevisions = sqliteTable(
  "loop_role_brief_revisions",
  {
    ownerId,
    loopId: text("loop_id").notNull(),
    revision: integer("revision").notNull(),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    sourceFingerprint: text("source_fingerprint").notNull(),
    displaySnapshot: text("display_snapshot", { mode: "json" }).notNull(),
    privateSnapshot: text("private_snapshot", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.loopId, table.revision] }),
    uniqueIndex("loop_role_brief_revisions_operation_idx").on(table.ownerId, table.operationId),
  ],
);

// Confirmed-interview preparation is a Loop-owned administrative artifact,
// separate from Career Materials, the raw JD, and the immutable Role Brief.
// The stable row keeps one current pointer per Loop/Round scope while every
// content change appends an immutable revision.
export const loopInterviewMaterials = sqliteTable(
  "loop_interview_materials",
  {
    ownerId,
    materialId: text("material_id").notNull(),
    loopId: text("loop_id").notNull(),
    stageId: text("stage_id"),
    bindingKey: text("binding_key").notNull(),
    kind: text("kind", { enum: ["interview_prep"] }).notNull(),
    currentRevision: integer("current_revision").notNull(),
    state: text("state", { enum: ["active", "archived"] }).notNull(),
    label: text("label").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.materialId] }),
    uniqueIndex("loop_interview_materials_scope_unique").on(
      table.ownerId,
      table.loopId,
      table.bindingKey,
      table.kind,
    ),
    index("loop_interview_materials_loop_idx").on(table.ownerId, table.loopId, table.stageId, table.state),
  ],
);

export const loopInterviewMaterialRevisions = sqliteTable(
  "loop_interview_material_revisions",
  {
    ownerId,
    materialId: text("material_id").notNull(),
    revision: integer("revision").notNull(),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    snapshot: text("snapshot", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.materialId, table.revision] }),
    uniqueIndex("loop_interview_material_revisions_operation_idx").on(table.ownerId, table.operationId),
  ],
);

export const loopInterviewMaterialOperations = sqliteTable(
  "loop_interview_material_operations",
  {
    ownerId,
    operationId: text("operation_id").notNull(),
    materialId: text("material_id").notNull(),
    action: text("action", { enum: ["create", "revise"] }).notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    materialRevision: integer("material_revision").notNull(),
    receipt: text("receipt", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.operationId] })],
);

// Planned practice can carry at most one Loop and optional Round. The server
// snapshots the exact display-safe Role Brief revision; clients never supply
// or persist raw job-description text in activity context.
export const loopActivityBindings = sqliteTable(
  "loop_activity_bindings",
  {
    ownerId,
    activityId: text("activity_id").notNull(),
    loopId: text("loop_id").notNull(),
    stageId: text("stage_id"),
    loopRevision: integer("loop_revision").notNull(),
    roleBriefRevision: integer("role_brief_revision").notNull(),
    specialty: text("specialty", { enum: ["leetcode", "system_design", "behavioral"] }).notNull(),
    questionId: text("question_id").notNull(),
    roleBriefDisplaySnapshot: text("role_brief_display_snapshot", { mode: "json" }).notNull(),
    bindingRevision: integer("binding_revision").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.activityId] }),
    index("loop_activity_bindings_loop_idx").on(table.ownerId, table.loopId, table.stageId),
  ],
);

// Direct re-binding of an untouched planned activity is identity-idempotent.
// The immutable operation receipt prevents changed retries from silently
// moving an activity to a different hiring process.
export const loopActivityBindingOperations = sqliteTable(
  "loop_activity_binding_operations",
  {
    ownerId,
    operationId: text("operation_id").notNull(),
    activityId: text("activity_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    receipt: text("receipt", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.operationId] })],
);

// Timer completion projects one immutable, transcript-free receipt into Loop
// history. A database trigger owns this projection so website, MCP, Voice, and
// session finishes cannot diverge.
export const loopActivityHistory = sqliteTable(
  "loop_activity_history",
  {
    ownerId,
    activityId: text("activity_id").notNull(),
    loopId: text("loop_id").notNull(),
    stageId: text("stage_id"),
    roleBriefRevision: integer("role_brief_revision").notNull(),
    specialty: text("specialty", { enum: ["leetcode", "system_design", "behavioral"] }).notNull(),
    questionId: text("question_id").notNull(),
    result: text("result", { enum: ["solved", "solved_after_reviewing_approach", "failed"] }).notNull(),
    completedAt: integer("completed_at").notNull(),
    receipt: text("receipt", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.activityId] }),
    index("loop_activity_history_loop_idx").on(table.ownerId, table.loopId, table.completedAt),
  ],
);

export const interviewLoopOperations = sqliteTable(
  "interview_loop_operations",
  {
    ownerId,
    operationId: text("operation_id").notNull(),
    loopId: text("loop_id").notNull(),
    action: text("action", { enum: ["create", "revise", "revise_role_brief"] }).notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    loopRevision: integer("loop_revision").notNull(),
    roleBriefRevision: integer("role_brief_revision").notNull(),
    receipt: text("receipt", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.operationId] })],
);

// Existing standalone Target Profiles remain untouched. One explicit decision
// removes a profile revision from the migration inbox by creating a Loop,
// attaching it to a Loop, or archiving it; no inference or deletion is allowed.
export const loopTargetProfileMigrations = sqliteTable(
  "loop_target_profile_migrations",
  {
    ownerId,
    targetId: text("target_id").notNull(),
    targetRevision: integer("target_revision").notNull(),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    action: text("action", { enum: ["create_loop", "attach_existing_loop", "archive"] }).notNull(),
    loopId: text("loop_id"),
    roleBriefRevision: integer("role_brief_revision"),
    receipt: text("receipt", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.targetId] }),
    uniqueIndex("loop_target_profile_migrations_operation_idx").on(table.ownerId, table.operationId),
  ],
);

// Recent interview capture packets are owner-private staging records. Import
// adds a separate backfilled timestamp; it never changes what was captured.
export const loopCapturePackets = sqliteTable(
  "loop_capture_packets",
  {
    ownerId,
    packetId: text("packet_id").notNull(),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    privateSnapshot: text("private_snapshot", { mode: "json" }).notNull(),
    status: text("status", { enum: ["captured", "imported"] }).notNull(),
    capturedAt: integer("captured_at").notNull(),
    backfilledAt: integer("backfilled_at"),
    loopId: text("loop_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.packetId] }),
    uniqueIndex("loop_capture_packets_operation_idx").on(table.ownerId, table.operationId),
    index("loop_capture_packets_owner_status_idx").on(table.ownerId, table.status, table.capturedAt),
  ],
);

export const loopCapturePacketOperations = sqliteTable(
  "loop_capture_packet_operations",
  {
    ownerId,
    operationId: text("operation_id").notNull(),
    packetId: text("packet_id").notNull(),
    action: text("action", { enum: ["capture", "import"] }).notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    receipt: text("receipt", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.operationId] })],
);

// Resume source bytes stay owner-private in R2. D1 records only immutable
// revision identity, integrity metadata, and the current pointer; object keys,
// provider locators, local paths, and document content are deliberately absent.
export const resumeSources = sqliteTable(
  "resume_sources",
  {
    ownerId,
    resumeId: text("resume_id").notNull(),
    sourceLabel: text("source_label").notNull(),
    currentRevisionId: text("current_revision_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.resumeId] })],
);

export const resumeRevisions = sqliteTable(
  "resume_revisions",
  {
    ownerId,
    resumeId: text("resume_id").notNull(),
    revisionId: text("revision_id").notNull(),
    parentRevisionId: text("parent_revision_id"),
    sourceFingerprint: text("source_fingerprint").notNull(),
    sourceProvider: text("source_provider", { enum: ["google_drive", "local_file"] }),
    sourceRevisionFingerprint: text("source_revision_fingerprint"),
    manifestFingerprint: text("manifest_fingerprint"),
    extractionVersion: text("extraction_version"),
    importOperationId: text("import_operation_id").notNull(),
    storageGeneration: text("storage_generation").notNull(),
    visibility: text("visibility", { enum: ["owner_private"] }).notNull().default("owner_private"),
    importedAt: integer("imported_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.resumeId, table.revisionId] }),
    uniqueIndex("resume_revisions_source_fingerprint_idx").on(
      table.ownerId,
      table.resumeId,
      table.sourceFingerprint,
    ),
  ],
);

// Extracted resume wording is bounded owner-private D1 data. It is useful for
// exact revision comparison and semantic provenance, but it is never treated
// as evidence by itself. Full DOCX/PDF bytes remain private R2 objects.
export const resumeBulletOccurrences = sqliteTable(
  "resume_bullet_occurrences",
  {
    ownerId,
    resumeId: text("resume_id").notNull(),
    revisionId: text("revision_id").notNull(),
    occurrenceId: text("occurrence_id").notNull(),
    sectionLabel: text("section_label").notNull(),
    ordinal: integer("ordinal").notNull(),
    text: text("text").notNull(),
    contentFingerprint: text("content_fingerprint").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.resumeId, table.revisionId, table.occurrenceId] }),
    uniqueIndex("resume_bullet_occurrences_order_idx").on(
      table.ownerId,
      table.resumeId,
      table.revisionId,
      table.ordinal,
    ),
    index("resume_bullet_occurrences_content_idx").on(table.ownerId, table.contentFingerprint),
  ],
);

export const resumeBulletClaimLinks = sqliteTable(
  "resume_bullet_claim_links",
  {
    ownerId,
    resumeId: text("resume_id").notNull(),
    revisionId: text("revision_id").notNull(),
    occurrenceId: text("occurrence_id").notNull(),
    referenceType: text("reference_type", { enum: ["claim", "evidence"] }).notNull(),
    referenceId: text("reference_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.ownerId,
        table.resumeId,
        table.revisionId,
        table.occurrenceId,
        table.referenceType,
        table.referenceId,
      ],
    }),
    index("resume_bullet_claim_links_reference_idx").on(
      table.ownerId,
      table.referenceType,
      table.referenceId,
    ),
  ],
);

// A resume revision can flag an exact current Behavioral Solution Profile for
// review when a claim it used changed. The profile itself remains immutable;
// acknowledgement is a separate future owner action.
export const resumeRevisionReviewImpacts = sqliteTable(
  "resume_revision_review_impacts",
  {
    ownerId,
    resumeId: text("resume_id").notNull(),
    revisionId: text("revision_id").notNull(),
    questionId: text("question_id").notNull(),
    solutionProfileRevision: integer("solution_profile_revision").notNull(),
    changedClaimIds: text("changed_claim_ids", { mode: "json" }).notNull(),
    status: text("status", { enum: ["needs_review", "acknowledged"] }).notNull().default("needs_review"),
    createdAt: integer("created_at").notNull(),
    acknowledgedAt: integer("acknowledged_at"),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.resumeId, table.revisionId, table.questionId] }),
    index("resume_revision_review_impacts_question_idx").on(table.ownerId, table.questionId, table.status),
  ],
);

export const resumeRevisionFiles = sqliteTable(
  "resume_revision_files",
  {
    ownerId,
    resumeId: text("resume_id").notNull(),
    revisionId: text("revision_id").notNull(),
    format: text("format", { enum: ["docx", "pdf"] }).notNull(),
    sha256: text("sha256").notNull(),
    byteSize: integer("byte_size").notNull(),
    mimeType: text("mime_type").notNull(),
    visibility: text("visibility", { enum: ["owner_private"] }).notNull().default("owner_private"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.resumeId, table.revisionId, table.format] }),
  ],
);

// Removing private resume bytes never rewrites the immutable revision. One
// exact-retry tombstone owns the R2 pair lifecycle while integrity metadata,
// extracted wording, semantic links, and downstream provenance remain intact.
export const resumeRevisionFileDeletions = sqliteTable(
  "resume_revision_file_deletions",
  {
    ownerId,
    operationId: text("operation_id").notNull(),
    resumeId: text("resume_id").notNull(),
    revisionId: text("revision_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    status: text("status", { enum: ["deleting", "retryable_failure", "deleted"] }).notNull(),
    errorCode: text("error_code"),
    reason: text("reason").notNull(),
    receipt: text("receipt", { mode: "json" }),
    createdAt: integer("created_at").notNull(),
    updatedAt,
    completedAt: integer("completed_at"),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.operationId] }),
    uniqueIndex("resume_revision_file_deletions_target_unique").on(
      table.ownerId,
      table.resumeId,
      table.revisionId,
    ),
    index("resume_revision_file_deletions_status_idx").on(table.ownerId, table.status, table.updatedAt),
  ],
);

// Immutable, owner-private provenance for the exact resume revision that was
// current when one behavioral final-answer snapshot was completed. Raw resume
// content, object keys, and provider locators never enter this table.
export const activityResumeContexts = sqliteTable(
  "activity_resume_contexts",
  {
    ownerId,
    activityId: text("activity_id").notNull(),
    snapshotRevision: integer("snapshot_revision").notNull(),
    resumeId: text("resume_id").notNull(),
    resumeRevisionId: text("resume_revision_id").notNull(),
    sourceLabel: text("source_label").notNull(),
    resumeImportedAt: integer("resume_imported_at").notNull(),
    state: text("state", { enum: ["contemporaneous", "backfilled"] }).notNull(),
    claimIds: text("claim_ids", { mode: "json" }).notNull(),
    evidenceIds: text("evidence_ids", { mode: "json" }).notNull(),
    capturedAt: integer("captured_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.activityId, table.snapshotRevision] })],
);

// Coordinator-only audit evidence for an owner-confirmed historical resume
// relationship. The immutable activity snapshot and resume revision stay in
// their owning tables; this row proves the exact loaded file identities and
// makes retries conflict-safe without storing file bytes or private locators.
export const activityResumeContextBackfills = sqliteTable(
  "activity_resume_context_backfills",
  {
    ownerId,
    operationId: text("operation_id").notNull(),
    activityId: text("activity_id").notNull(),
    snapshotRevision: integer("snapshot_revision").notNull(),
    resumeId: text("resume_id").notNull(),
    resumeRevisionId: text("resume_revision_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    sourceFingerprint: text("source_fingerprint").notNull(),
    docxSha256: text("docx_sha256").notNull(),
    pdfSha256: text("pdf_sha256").notNull(),
    resumeImportedAt: integer("resume_imported_at").notNull(),
    snapshotLoadedAt: integer("snapshot_loaded_at").notNull(),
    ownerConfirmedAt: integer("owner_confirmed_at").notNull(),
    reason: text("reason").notNull(),
    receipt: text("receipt", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.operationId] }),
    uniqueIndex("activity_resume_context_backfills_target_unique").on(
      table.ownerId,
      table.activityId,
      table.snapshotRevision,
    ),
  ],
);

// One stable operation id owns a single immutable request hash. The stored
// receipt makes an exact retry safe after an ambiguous HTTP response.
export const resumeImportOperations = sqliteTable(
  "resume_import_operations",
  {
    ownerId,
    operationId: text("operation_id").notNull(),
    resumeId: text("resume_id").notNull(),
    requestedRevisionId: text("requested_revision_id").notNull(),
    requestHash: text("request_hash").notNull(),
    baseCurrentRevisionId: text("base_current_revision_id"),
    status: text("status", {
      enum: ["staging", "retryable_failure", "failed", "saved"],
    }).notNull().default("staging"),
    errorCode: text("error_code"),
    receipt: text("receipt", { mode: "json" }),
    createdAt: integer("created_at").notNull(),
    updatedAt,
    completedAt: integer("completed_at"),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.operationId] }),
    index("resume_import_operations_owner_status_idx").on(table.ownerId, table.status, table.updatedAt),
  ],
);

export const resumeCurrentRevisionOperations = sqliteTable(
  "resume_current_revision_operations",
  {
    ownerId,
    operationId: text("operation_id").notNull(),
    resumeId: text("resume_id").notNull(),
    revisionId: text("revision_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    priorRevisionId: text("prior_revision_id"),
    receipt: text("receipt", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.operationId] })],
);

// A short owner/resume lease serializes current-pointer changes while allowing
// another request to recover a Worker invocation that disappeared mid-upload.
export const resumeImportLocks = sqliteTable(
  "resume_import_locks",
  {
    ownerId,
    resumeId: text("resume_id").notNull(),
    operationId: text("operation_id").notNull(),
    leaseToken: text("lease_token").notNull(),
    leaseExpiresAt: integer("lease_expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.resumeId] })],
);

// Specialist writes first reserve a stable, owner-scoped operation receipt.
// The MCP request only performs this small enqueue; a scheduled executor owns
// the potentially expensive durable write and can reclaim an expired lease if
// a Worker invocation is terminated by a platform CPU limit.
export const specialistWriteJobs = sqliteTable(
  "specialist_write_jobs",
  {
    ownerId,
    jobId: text("job_id").notNull(),
    operation: text("operation", {
      enum: [
        "leetcode_code_attempt",
        "personal_bank_question",
        "behavioral_evidence_item",
        "behavioral_claim_status",
        "specialist_finalization",
      ],
    }).notNull(),
    payloadHash: text("payload_hash").notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    status: text("status", {
      enum: ["queued", "processing", "retry_wait", "saved", "failed"],
    }).notNull().default("queued"),
    attemptCount: integer("attempt_count").notNull().default(0),
    totalAttemptCount: integer("total_attempt_count").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at").notNull().default(0),
    leaseExpiresAt: integer("lease_expires_at"),
    result: text("result", { mode: "json" }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    errorRetryable: integer("error_retryable", { mode: "boolean" }),
    createdAt: integer("created_at").notNull(),
    updatedAt,
    completedAt: integer("completed_at"),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.jobId] }),
    index("specialist_write_jobs_due_idx").on(
      table.status,
      table.nextAttemptAt,
      table.leaseExpiresAt,
    ),
  ],
);

// Personal integration tokens map a bearer credential to the same opaque
// owner id used by the dashboard. Only the SHA-256 digest is persisted.
export const integrationTokens = sqliteTable("integration_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  ownerId,
  label: text("label").notNull().default("Personal integration"),
  createdAt: integer("created_at").notNull(),
  lastUsedAt: integer("last_used_at"),
  revokedAt: integer("revoked_at"),
});

// Interview Arc Live v1 is a separate, versioned write surface over the same
// owner-scoped practice authority. These rows hold only Live protocol state;
// canonical timers, results, focus, and transcript text remain in the shared
// tables above.
export const liveOwnerRevisions = sqliteTable("live_owner_revisions", {
  ownerId: text("owner_id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  updatedAt,
});

export const liveActivityLeases = sqliteTable(
  "live_activity_leases",
  {
    ownerId,
    activityId: text("activity_id").notNull(),
    holderId: text("holder_id"),
    holderSessionId: text("holder_session_id"),
    fencingToken: integer("fencing_token").notNull().default(0),
    expiresAt: integer("expires_at"),
    acquiredAt: integer("acquired_at"),
    renewedAt: integer("renewed_at"),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.activityId] }),
    index("live_activity_leases_owner_expiry_idx").on(table.ownerId, table.expiresAt),
  ],
);

export const liveTurnPairs = sqliteTable(
  "live_turn_pairs",
  {
    ownerId,
    activityId: text("activity_id").notNull(),
    pairId: text("pair_id").notNull(),
    candidateTurnId: text("candidate_turn_id").notNull(),
    interviewerTurnId: text("interviewer_turn_id").notNull(),
    candidateText: text("candidate_text").notNull(),
    candidateEvidenceStatus: text("candidate_evidence_status", {
      enum: ["verified", "best_available", "possible_contamination"],
    }).notNull(),
    interviewerDisplayMarkdown: text("interviewer_display_markdown").notNull(),
    interviewerSpokenText: text("interviewer_spoken_text").notNull(),
    candidateOccurredAt: integer("candidate_occurred_at").notNull(),
    interviewerOccurredAt: integer("interviewer_occurred_at").notNull(),
    candidateSequence: integer("candidate_sequence").notNull(),
    interviewerSequence: integer("interviewer_sequence").notNull(),
    clipId: text("clip_id"),
    requestDigest: text("request_digest").notNull(),
    evidenceConfirmedAt: integer("evidence_confirmed_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.activityId, table.pairId] }),
    check(
      "live_turn_pairs_evidence_status_check",
      sql`${table.candidateEvidenceStatus} IN ('verified','best_available','possible_contamination')`,
    ),
    check(
      "live_turn_pairs_adjacent_sequence_check",
      sql`${table.interviewerSequence} = ${table.candidateSequence} + 1`,
    ),
    uniqueIndex("live_turn_pairs_candidate_turn_unique").on(
      table.ownerId,
      table.activityId,
      table.candidateTurnId,
    ),
    uniqueIndex("live_turn_pairs_interviewer_turn_unique").on(
      table.ownerId,
      table.activityId,
      table.interviewerTurnId,
    ),
    uniqueIndex("live_turn_pairs_candidate_sequence_unique").on(
      table.ownerId,
      table.activityId,
      table.candidateSequence,
    ),
    uniqueIndex("live_turn_pairs_interviewer_sequence_unique").on(
      table.ownerId,
      table.activityId,
      table.interviewerSequence,
    ),
  ],
);

// One cross-role reservation table prevents a Live candidate identity or
// sequence from being reused later as an interviewer identity (or vice versa)
// without imposing a new invariant on unfenced legacy writers.
export const liveTurnReservations = sqliteTable(
  "live_turn_reservations",
  {
    ownerId,
    activityId: text("activity_id").notNull(),
    turnId: text("turn_id").notNull(),
    pairId: text("pair_id").notNull(),
    side: text("side", { enum: ["candidate", "interviewer"] }).notNull(),
    sequence: integer("sequence").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.activityId, table.turnId] }),
    check("live_turn_reservations_side_check", sql`${table.side} IN ('candidate','interviewer')`),
    uniqueIndex("live_turn_reservations_sequence_unique").on(
      table.ownerId,
      table.activityId,
      table.sequence,
    ),
    uniqueIndex("live_turn_reservations_pair_side_unique").on(
      table.ownerId,
      table.activityId,
      table.pairId,
      table.side,
    ),
  ],
);

export const liveCandidateEvidenceConfirmations = sqliteTable(
  "live_candidate_evidence_confirmations",
  {
    ownerId,
    activityId: text("activity_id").notNull(),
    pairId: text("pair_id").notNull(),
    operationId: text("operation_id").notNull(),
    confirmedAt: integer("confirmed_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.activityId, table.pairId] }),
    uniqueIndex("live_candidate_evidence_confirmations_operation_unique").on(
      table.ownerId,
      table.activityId,
      table.operationId,
    ),
  ],
);

export const liveActivityClips = sqliteTable(
  "live_activity_clips",
  {
    ownerId,
    activityId: text("activity_id").notNull(),
    clipId: text("clip_id").notNull(),
    candidateTurnId: text("candidate_turn_id").notNull(),
    pairId: text("pair_id"),
    expectedMimeType: text("expected_mime_type").notNull(),
    expectedByteSize: integer("expected_byte_size").notNull(),
    expectedSha256: text("expected_sha256").notNull(),
    objectKey: text("object_key").notNull(),
    status: text("status", {
      enum: ["staged", "uploading", "available", "failed", "abandoned"],
    }).notNull().default("staged"),
    uploadOperationId: text("upload_operation_id"),
    uploadRequestDigest: text("upload_request_digest"),
    uploadHolderId: text("upload_holder_id"),
    uploadHolderSessionId: text("upload_holder_session_id"),
    uploadFencingToken: integer("upload_fencing_token"),
    failureCode: text("failure_code"),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.activityId, table.clipId] }),
    check(
      "live_activity_clips_mime_type_check",
      sql`${table.expectedMimeType} IN ('audio/mp4','audio/mpeg','audio/wav','audio/webm','audio/x-m4a')`,
    ),
    check(
      "live_activity_clips_byte_size_check",
      sql`${table.expectedByteSize} > 0 AND ${table.expectedByteSize} <= 104857600`,
    ),
    check(
      "live_activity_clips_sha256_check",
      sql`length(${table.expectedSha256}) = 64 AND ${table.expectedSha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "live_activity_clips_status_check",
      sql`${table.status} IN ('staged','uploading','available','failed','abandoned')`,
    ),
    uniqueIndex("live_activity_clips_candidate_turn_unique").on(
      table.ownerId,
      table.activityId,
      table.candidateTurnId,
    ),
    index("live_activity_clips_owner_status_idx").on(table.ownerId, table.status, table.updatedAt),
  ],
);

export const liveMutationReceipts = sqliteTable(
  "live_mutation_receipts",
  {
    ownerId,
    activityId: text("activity_id").notNull(),
    operationId: text("operation_id").notNull(),
    operation: text("operation").notNull(),
    requestDigest: text("request_digest").notNull(),
    receipt: text("receipt", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.activityId, table.operationId] }),
    index("live_mutation_receipts_owner_created_idx").on(table.ownerId, table.createdAt),
  ],
);

// Native Today planning mutations are identity-idempotent. The request hash
// rejects a changed retry while the stored response lets an exact retry return
// the original authoritative result without creating duplicate work.
export const todayPlanningMutations = sqliteTable(
  "today_planning_mutations",
  {
    ownerId,
    mutationId: text("mutation_id").notNull(),
    workbenchId: text("workbench_id").notNull(),
    requestHash: text("request_hash").notNull(),
    response: text("response", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.mutationId] }),
    index("today_planning_mutations_owner_workbench_idx").on(
      table.ownerId,
      table.workbenchId,
    ),
  ],
);

// Interaction-mode IDs are validated against the Git-backed registry rather
// than a database enum, so a future approved mode does not require a schema
// migration. Current state, immutable transitions, and exact-retry receipts
// are written in one D1 batch by the interaction-mode store.
export const practiceInteractionModeStates = sqliteTable(
  "practice_interaction_mode_states",
  {
    ownerId,
    activityId: text("activity_id").notNull(),
    interactionModeId: text("interaction_mode_id").notNull(),
    registryVersion: text("registry_version").notNull(),
    revision: integer("revision").notNull(),
    source: text("source", {
      enum: ["explicit_user_instruction", "workflow_transition"],
    }).notNull(),
    lastMutationId: text("last_mutation_id").notNull(),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.activityId] })],
);

export const practiceInteractionModeTransitions = sqliteTable(
  "practice_interaction_mode_transitions",
  {
    ownerId,
    activityId: text("activity_id").notNull(),
    transitionId: text("transition_id").notNull(),
    mutationId: text("mutation_id").notNull(),
    fromInteractionModeId: text("from_interaction_mode_id"),
    toInteractionModeId: text("to_interaction_mode_id").notNull(),
    fromRevision: integer("from_revision").notNull(),
    toRevision: integer("to_revision").notNull(),
    registryVersion: text("registry_version").notNull(),
    triggerTurnId: text("trigger_turn_id"),
    source: text("source", {
      enum: ["explicit_user_instruction", "workflow_transition"],
    }).notNull(),
    reason: text("reason").notNull(),
    occurredAt: integer("occurred_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.transitionId] }),
    uniqueIndex("practice_interaction_mode_transition_revision_idx").on(
      table.ownerId,
      table.activityId,
      table.toRevision,
    ),
  ],
);

export const practiceInteractionModeMutations = sqliteTable(
  "practice_interaction_mode_mutations",
  {
    ownerId,
    mutationId: text("mutation_id").notNull(),
    activityId: text("activity_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    transitionId: text("transition_id").notNull(),
    toRevision: integer("to_revision").notNull(),
    interactionModeId: text("interaction_mode_id").notNull(),
    registryVersion: text("registry_version").notNull(),
    receipt: text("receipt", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.mutationId] }),
    index("practice_interaction_mode_mutation_activity_idx").on(
      table.ownerId,
      table.activityId,
      table.createdAt,
    ),
  ],
);

export const practiceInteractionModeTurnOverrides = sqliteTable(
  "practice_interaction_mode_turn_overrides",
  {
    ownerId,
    activityId: text("activity_id").notNull(),
    responseTurnId: text("response_turn_id").notNull(),
    mutationId: text("mutation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    baseInteractionModeId: text("base_interaction_mode_id").notNull(),
    overrideInteractionModeId: text("override_interaction_mode_id").notNull(),
    stateRevision: integer("state_revision").notNull(),
    registryVersion: text("registry_version").notNull(),
    triggerTurnId: text("trigger_turn_id"),
    reason: text("reason").notNull(),
    occurredAt: integer("occurred_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.activityId, table.responseTurnId] }),
    uniqueIndex("practice_mode_turn_override_mutation_idx").on(table.ownerId, table.mutationId),
  ],
);

// Completed-attempt mode classifications are immutable snapshots. Corrections
// append a revision that names the snapshot it replaces; historical attempts
// and their transcript evidence are never rewritten.
export const practiceInteractionModeClassifications = sqliteTable(
  "practice_interaction_mode_classifications",
  {
    ownerId,
    activityId: text("activity_id").notNull(),
    snapshotRevision: integer("snapshot_revision").notNull(),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    classification: text("classification", { mode: "json" }).notNull(),
    correctionOfRevision: integer("correction_of_revision"),
    correctionReason: text("correction_reason"),
    finalizedAt: integer("finalized_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.activityId, table.snapshotRevision] }),
    uniqueIndex("practice_mode_classification_operation_idx").on(table.ownerId, table.operationId),
  ],
);

// Website-created activities (extras and full-session problems). Stored as a
// JSON payload matching the client draft shape so the schema stays stable while
// the UI model evolves; the columns that need indexing are lifted out.
export const extraActivities = sqliteTable(
  "extra_activities",
  {
    ownerId,
    id: text("id").notNull(),
    date: text("date").notNull(),
    workbenchId: text("workbench_id"),
    payload: text("payload", { mode: "json" }).notNull(),
    revision: integer("revision").notNull().default(0),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.id] })],
);

// Career work is time evidence, not interview-practice evidence. Keeping focus
// blocks in their own table prevents them from entering outcomes, reviews,
// specialist publication, Past, or the Problem Bank.
export const focusBlocks = sqliteTable(
  "focus_blocks",
  {
    ownerId,
    id: text("id").notNull(),
    workbenchId: text("workbench_id").notNull(),
    date: text("date").notNull(),
    category: text("category", { enum: ["job_applications"] }).notNull(),
    title: text("title").notNull(),
    plannedSeconds: integer("planned_seconds").notNull(),
    note: text("note"),
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.id] }),
    index("focus_blocks_owner_workbench_idx").on(table.ownerId, table.workbenchId),
  ],
);

// Locally created practice sessions (the six-hour countdown groupings).
export const liveSessions = sqliteTable(
  "live_sessions",
  {
    ownerId,
    id: text("id").notNull(),
    date: text("date").notNull(),
    workbenchId: text("workbench_id"),
    payload: text("payload", { mode: "json" }).notNull(),
    revision: integer("revision").notNull().default(0),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.id] })],
);

// ── Published content, mirrored from Git into D1 by scripts/import-content.mjs
// so the site renders the latest journals/artifacts/bank without a redeploy.
// This is a single shared library (not owner-scoped). Each row stores the exact
// JSON shape the client already consumes; columns that need sorting/filtering
// are lifted out. `ord` preserves the source ordering where display depends on
// it (bank question order, story file order).

export const contentJournals = sqliteTable("content_journals", {
  date: text("date").primaryKey(),
  payload: text("payload", { mode: "json" }).notNull(),
  updatedAt,
});

export const contentArtifacts = sqliteTable("content_artifacts", {
  path: text("path").primaryKey(),
  type: text("type").notNull(),
  date: text("date").notNull(),
  title: text("title").notNull(),
  payload: text("payload", { mode: "json" }).notNull(),
  updatedAt,
});

export const contentStories = sqliteTable("content_stories", {
  projectId: text("project_id").primaryKey(),
  ord: integer("ord").notNull().default(0),
  payload: text("payload", { mode: "json" }).notNull(),
  updatedAt,
});

export const contentBank = sqliteTable(
  "content_bank",
  {
    category: text("category", { enum: ["leetcode", "systemDesign", "behavioral"] }).notNull(),
    id: text("id").notNull(),
    ord: integer("ord").notNull().default(0),
    payload: text("payload", { mode: "json" }).notNull(),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.category, table.id] })],
);

export type TimerRow = typeof timers.$inferSelect;
export type PracticeFocusRow = typeof practiceFocus.$inferSelect;
export type PracticeWorkbenchRow = typeof practiceWorkbenches.$inferSelect;
export type TimerIntervalRow = typeof timerIntervals.$inferSelect;
export type OutcomeRow = typeof outcomes.$inferSelect;
export type PublicationStatusRow = typeof publicationStatuses.$inferSelect;
export type ActivityNoteRow = typeof activityNotes.$inferSelect;
export type PracticeNoteRow = typeof practiceNotes.$inferSelect;
export type PracticeTranscriptTurnRow = typeof practiceTranscriptTurns.$inferSelect;
export type VoiceCaptureIntentRow = typeof voiceCaptureIntents.$inferSelect;
export type VoiceSpecialistResponseRow = typeof voiceSpecialistResponses.$inferSelect;
export type VoiceResponseGroupRepairEventRow = typeof voiceResponseGroupRepairEvents.$inferSelect;
export type LeetCodeCodeAttemptRow = typeof leetcodeCodeAttempts.$inferSelect;
export type LeetCodeCodeAttemptReviewBackfillRow = typeof leetcodeCodeAttemptReviewBackfills.$inferSelect;
export type ActivityFinalizationRow = typeof activityFinalizations.$inferSelect;
export type BehavioralFinalAnswerSnapshotRow = typeof behavioralFinalAnswerSnapshots.$inferSelect;
export type ReviewScheduleRow = typeof reviewSchedules.$inferSelect;
export type SpecialistTaskRow = typeof specialistTasks.$inferSelect;
export type LoopActivityBindingRow = typeof loopActivityBindings.$inferSelect;
export type LoopActivityHistoryRow = typeof loopActivityHistory.$inferSelect;
export type ActivityAudioClipRow = typeof activityAudioClips.$inferSelect;
export type ActivityDeliveryAnalysisRow = typeof activityDeliveryAnalyses.$inferSelect;
export type ProblemPreferenceRow = typeof problemPreferences.$inferSelect;
export type ProblemSolutionProfileRow = typeof problemSolutionProfiles.$inferSelect;
export type ProvisionalSolutionProfileRow = typeof provisionalSolutionProfiles.$inferSelect;
export type ProblemSolutionRevisionRow = typeof problemSolutionRevisions.$inferSelect;
export type ActivitySolutionLinkRow = typeof activitySolutionLinks.$inferSelect;
export type OwnerBankQuestionRow = typeof ownerBankQuestions.$inferSelect;
export type BehavioralProjectQuestionBindingRow = typeof behavioralProjectQuestionBindings.$inferSelect;
export type BehavioralProjectQuestionBindingRevisionRow = typeof behavioralProjectQuestionBindingRevisions.$inferSelect;
export type BehavioralProjectActivityLinkRow = typeof behavioralProjectActivityLinks.$inferSelect;
export type BehavioralProjectOperationRow = typeof behavioralProjectOperations.$inferSelect;
export type BehavioralEvidenceSourceRow = typeof behavioralEvidenceSources.$inferSelect;
export type BehavioralEvidenceSourceRevisionRow = typeof behavioralEvidenceSourceRevisions.$inferSelect;
export type BehavioralEvidenceSourceOperationRow = typeof behavioralEvidenceSourceOperations.$inferSelect;
export type BehavioralEvidenceItemRow = typeof behavioralEvidenceItems.$inferSelect;
export type BehavioralEvidenceQuestionLinkRow = typeof behavioralEvidenceQuestionLinks.$inferSelect;
export type BehavioralEvidenceReviewOperationRow = typeof behavioralEvidenceReviewOperations.$inferSelect;
export type BehavioralEvidenceReviewEventRow = typeof behavioralEvidenceReviewEvents.$inferSelect;
export type BehavioralClaimRow = typeof behavioralClaims.$inferSelect;
export type BehavioralClaimStatusEventRow = typeof behavioralClaimStatusEvents.$inferSelect;
export type BehavioralStoryRow = typeof behavioralStories.$inferSelect;
export type BehavioralStoryRevisionRow = typeof behavioralStoryRevisions.$inferSelect;
export type BehavioralStoryOperationRow = typeof behavioralStoryOperations.$inferSelect;
export type BehavioralStoryQuestionLinkRow = typeof behavioralStoryQuestionLinks.$inferSelect;
export type ResumeSourceRow = typeof resumeSources.$inferSelect;
export type ResumeRevisionRow = typeof resumeRevisions.$inferSelect;
export type ResumeRevisionFileRow = typeof resumeRevisionFiles.$inferSelect;
export type ResumeRevisionFileDeletionRow = typeof resumeRevisionFileDeletions.$inferSelect;
export type ActivityResumeContextRow = typeof activityResumeContexts.$inferSelect;
export type ActivityResumeContextBackfillRow = typeof activityResumeContextBackfills.$inferSelect;
export type ResumeImportOperationRow = typeof resumeImportOperations.$inferSelect;
export type ResumeImportLockRow = typeof resumeImportLocks.$inferSelect;
export type SpecialistWriteJobRow = typeof specialistWriteJobs.$inferSelect;
export type IntegrationTokenRow = typeof integrationTokens.$inferSelect;
export type LiveOwnerRevisionRow = typeof liveOwnerRevisions.$inferSelect;
export type LiveActivityLeaseRow = typeof liveActivityLeases.$inferSelect;
export type LiveTurnPairRow = typeof liveTurnPairs.$inferSelect;
export type LiveTurnReservationRow = typeof liveTurnReservations.$inferSelect;
export type LiveCandidateEvidenceConfirmationRow = typeof liveCandidateEvidenceConfirmations.$inferSelect;
export type LiveActivityClipRow = typeof liveActivityClips.$inferSelect;
export type LiveMutationReceiptRow = typeof liveMutationReceipts.$inferSelect;
export type ExtraActivityRow = typeof extraActivities.$inferSelect;
export type FocusBlockRow = typeof focusBlocks.$inferSelect;
export type LiveSessionRow = typeof liveSessions.$inferSelect;
export type ContentJournalRow = typeof contentJournals.$inferSelect;
export type ContentArtifactRow = typeof contentArtifacts.$inferSelect;
export type ContentStoryRow = typeof contentStories.$inferSelect;
export type ContentBankRow = typeof contentBank.$inferSelect;

export const CURRENT_TIMESTAMP = sql`CURRENT_TIMESTAMP`;
