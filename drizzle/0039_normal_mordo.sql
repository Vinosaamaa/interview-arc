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
ALTER TABLE `learning_sessions` ADD `finalization_revision` integer DEFAULT 0 NOT NULL;