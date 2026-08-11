CREATE TABLE `learning_session_intervals` (
	`owner_id` text NOT NULL,
	`session_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	PRIMARY KEY(`owner_id`, `session_id`, `started_at`)
);
--> statement-breakpoint
CREATE TABLE `learning_sessions` (
	`owner_id` text NOT NULL,
	`session_id` text NOT NULL,
	`scope_type` text NOT NULL,
	`course_id` text,
	`enrollment_id` text,
	`lesson_id` text NOT NULL,
	`blueprint_revision` integer,
	`lesson_revision` integer NOT NULL,
	`state` text NOT NULL,
	`accumulated_seconds` integer DEFAULT 0 NOT NULL,
	`started_at` integer,
	`running_since` integer,
	`completed_at` integer,
	`revision` integer DEFAULT 0 NOT NULL,
	`transcript_revision` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `session_id`)
);
--> statement-breakpoint
CREATE INDEX `learning_sessions_lesson_idx` ON `learning_sessions` (`owner_id`,`lesson_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `learning_sessions_state_idx` ON `learning_sessions` (`owner_id`,`state`,`updated_at`);--> statement-breakpoint
CREATE TABLE `learning_transcript_turns` (
	`owner_id` text NOT NULL,
	`session_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`speaker` text NOT NULL,
	`source` text NOT NULL,
	`body` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `session_id`, `turn_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_transcript_sequence_idx` ON `learning_transcript_turns` (`owner_id`,`session_id`,`sequence`);