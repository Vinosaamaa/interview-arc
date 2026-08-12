CREATE TABLE `learning_artifacts` (
	`owner_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`session_id` text,
	`homework_id` text,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`media_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`content_hash` text NOT NULL,
	`private_locator` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `artifact_id`)
);
--> statement-breakpoint
CREATE INDEX `learning_artifacts_lesson_idx` ON `learning_artifacts` (`owner_id`,`lesson_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `learning_checkpoint_result_events` (
	`owner_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`checkpoint_id` text NOT NULL,
	`revision` integer NOT NULL,
	`session_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`status` text NOT NULL,
	`rationale` text NOT NULL,
	`evidence` text NOT NULL,
	`supersedes_revision` integer,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `lesson_id`, `checkpoint_id`, `revision`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_checkpoint_operation_idx` ON `learning_checkpoint_result_events` (`owner_id`,`operation_id`,`checkpoint_id`);--> statement-breakpoint
CREATE TABLE `learning_checkpoint_states` (
	`owner_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`checkpoint_id` text NOT NULL,
	`current_revision` integer NOT NULL,
	`status` text NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `lesson_id`, `checkpoint_id`)
);
--> statement-breakpoint
CREATE TABLE `learning_course_blueprint_revisions` (
	`owner_id` text NOT NULL,
	`course_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `course_id`, `revision`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_blueprint_revisions_operation_idx` ON `learning_course_blueprint_revisions` (`owner_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `learning_courses` (
	`owner_id` text NOT NULL,
	`course_id` text NOT NULL,
	`current_blueprint_revision` integer NOT NULL,
	`state` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `course_id`)
);
--> statement-breakpoint
CREATE INDEX `learning_courses_owner_state_idx` ON `learning_courses` (`owner_id`,`state`,`updated_at`);--> statement-breakpoint
CREATE TABLE `learning_enrollments` (
	`owner_id` text NOT NULL,
	`enrollment_id` text NOT NULL,
	`course_id` text NOT NULL,
	`blueprint_revision` integer NOT NULL,
	`state` text NOT NULL,
	`current_module_id` text,
	`current_lesson_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`enrolled_at` integer NOT NULL,
	`completed_at` integer,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `enrollment_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_enrollments_owner_course_idx` ON `learning_enrollments` (`owner_id`,`course_id`);--> statement-breakpoint
CREATE INDEX `learning_enrollments_owner_state_idx` ON `learning_enrollments` (`owner_id`,`state`,`updated_at`);--> statement-breakpoint
CREATE TABLE `learning_homework` (
	`owner_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`homework_id` text NOT NULL,
	`lesson_revision` integer NOT NULL,
	`prompt` text NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`completed_at` integer,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `lesson_id`, `homework_id`)
);
--> statement-breakpoint
CREATE INDEX `learning_homework_state_idx` ON `learning_homework` (`owner_id`,`state`,`updated_at`);--> statement-breakpoint
CREATE TABLE `learning_homework_state_events` (
	`owner_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`homework_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`state` text NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `lesson_id`, `homework_id`, `revision`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_homework_event_operation_idx` ON `learning_homework_state_events` (`owner_id`,`operation_id`,`homework_id`);--> statement-breakpoint
CREATE TABLE `learning_lesson_revisions` (
	`owner_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`blueprint_revision` integer,
	`snapshot` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `lesson_id`, `revision`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_lesson_revisions_operation_idx` ON `learning_lesson_revisions` (`owner_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `learning_lessons` (
	`owner_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`scope_type` text NOT NULL,
	`course_id` text,
	`enrollment_id` text,
	`module_id` text,
	`current_revision` integer NOT NULL,
	`state` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `lesson_id`)
);
--> statement-breakpoint
CREATE INDEX `learning_lessons_course_idx` ON `learning_lessons` (`owner_id`,`course_id`,`module_id`);--> statement-breakpoint
CREATE INDEX `learning_lessons_scope_idx` ON `learning_lessons` (`owner_id`,`scope_type`,`state`,`updated_at`);--> statement-breakpoint
CREATE TABLE `learning_operations` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`aggregate_type` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`action` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`receipt` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `operation_id`)
);
--> statement-breakpoint
CREATE TABLE `learning_session_finalization_revisions` (
	`owner_id` text NOT NULL,
	`session_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `session_id`, `revision`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_session_finalization_operation_idx` ON `learning_session_finalization_revisions` (`owner_id`,`operation_id`);--> statement-breakpoint
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
	`finalization_revision` integer DEFAULT 0 NOT NULL,
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