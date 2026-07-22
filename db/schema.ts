import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
    createdAt: integer("created_at").notNull(),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.id] })],
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
    // Monotonic audit counter. Conflict rejection is not implemented yet;
    // mutations are serialized by arrival order and finished timers are locked.
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
    specialty: text("specialty", { enum: ["leetcode", "system_design", "behavioral"] }).notNull(),
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
    status: text("status", { enum: ["local_only", "uploading", "available", "failed"] }).notNull().default("local_only"),
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
    priority: integer("priority").notNull().default(0),
    targetMinutes: integer("target_minutes").notNull().default(60),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.specialty, table.questionId] })],
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

// Website-created activities (extras and full-session problems). Stored as a
// JSON payload matching the client draft shape so the schema stays stable while
// the UI model evolves; the columns that need indexing are lifted out.
export const extraActivities = sqliteTable(
  "extra_activities",
  {
    ownerId,
    id: text("id").notNull(),
    date: text("date").notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    revision: integer("revision").notNull().default(0),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.id] })],
);

// Locally created practice sessions (the six-hour countdown groupings).
export const liveSessions = sqliteTable(
  "live_sessions",
  {
    ownerId,
    id: text("id").notNull(),
    date: text("date").notNull(),
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
export type TimerIntervalRow = typeof timerIntervals.$inferSelect;
export type OutcomeRow = typeof outcomes.$inferSelect;
export type PublicationStatusRow = typeof publicationStatuses.$inferSelect;
export type ActivityNoteRow = typeof activityNotes.$inferSelect;
export type PracticeNoteRow = typeof practiceNotes.$inferSelect;
export type PracticeTranscriptTurnRow = typeof practiceTranscriptTurns.$inferSelect;
export type ActivityFinalizationRow = typeof activityFinalizations.$inferSelect;
export type ReviewScheduleRow = typeof reviewSchedules.$inferSelect;
export type SpecialistTaskRow = typeof specialistTasks.$inferSelect;
export type ActivityAudioClipRow = typeof activityAudioClips.$inferSelect;
export type ActivityDeliveryAnalysisRow = typeof activityDeliveryAnalyses.$inferSelect;
export type ProblemPreferenceRow = typeof problemPreferences.$inferSelect;
export type ProblemSolutionProfileRow = typeof problemSolutionProfiles.$inferSelect;
export type ProblemSolutionRevisionRow = typeof problemSolutionRevisions.$inferSelect;
export type ActivitySolutionLinkRow = typeof activitySolutionLinks.$inferSelect;
export type OwnerBankQuestionRow = typeof ownerBankQuestions.$inferSelect;
export type IntegrationTokenRow = typeof integrationTokens.$inferSelect;
export type ExtraActivityRow = typeof extraActivities.$inferSelect;
export type LiveSessionRow = typeof liveSessions.$inferSelect;
export type ContentJournalRow = typeof contentJournals.$inferSelect;
export type ContentArtifactRow = typeof contentArtifacts.$inferSelect;
export type ContentStoryRow = typeof contentStories.$inferSelect;
export type ContentBankRow = typeof contentBank.$inferSelect;

export const CURRENT_TIMESTAMP = sql`CURRENT_TIMESTAMP`;
