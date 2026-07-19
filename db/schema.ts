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
    // Monotonic per-row counter so a stale client cannot clobber newer state.
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

export type TimerRow = typeof timers.$inferSelect;
export type OutcomeRow = typeof outcomes.$inferSelect;
export type ExtraActivityRow = typeof extraActivities.$inferSelect;
export type LiveSessionRow = typeof liveSessions.$inferSelect;

export const CURRENT_TIMESTAMP = sql`CURRENT_TIMESTAMP`;
