import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Live practice state owned by the deployed website. Durable narrative content
// (daily journals, attempt write-ups, transcripts) stays in Git; these tables
// hold only the mutable timer/outcome/draft state that must survive a device
// switch. Every row is scoped to an owner so multi-device use stays isolated.

const ownerId = text("owner_id").notNull();
const updatedAt = integer("updated_at").notNull().default(0);

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

// LeetCode canonical outcome, kept separate from timer completion.
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

// Publication readiness is deliberately independent from the attempt result.
// A failed attempt can still be marked ready and receive a useful postmortem.
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

// Short personal notes can be edited from the website or LeetCode companion.
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
export type OutcomeRow = typeof outcomes.$inferSelect;
export type PublicationStatusRow = typeof publicationStatuses.$inferSelect;
export type ActivityNoteRow = typeof activityNotes.$inferSelect;
export type IntegrationTokenRow = typeof integrationTokens.$inferSelect;
export type ExtraActivityRow = typeof extraActivities.$inferSelect;
export type LiveSessionRow = typeof liveSessions.$inferSelect;
export type ContentJournalRow = typeof contentJournals.$inferSelect;
export type ContentArtifactRow = typeof contentArtifacts.$inferSelect;
export type ContentStoryRow = typeof contentStories.$inferSelect;
export type ContentBankRow = typeof contentBank.$inferSelect;

export const CURRENT_TIMESTAMP = sql`CURRENT_TIMESTAMP`;
