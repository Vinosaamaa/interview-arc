CREATE TABLE `interview_loop_operations` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`loop_id` text NOT NULL,
	`action` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`loop_revision` integer NOT NULL,
	`role_brief_revision` integer NOT NULL,
	`receipt` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `operation_id`)
);
--> statement-breakpoint
CREATE TABLE `interview_loop_revisions` (
	`owner_id` text NOT NULL,
	`loop_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `loop_id`, `revision`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `interview_loop_revisions_operation_idx` ON `interview_loop_revisions` (`owner_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `interview_loops` (
	`owner_id` text NOT NULL,
	`loop_id` text NOT NULL,
	`current_revision` integer NOT NULL,
	`current_role_brief_revision` integer NOT NULL,
	`state` text NOT NULL,
	`company` text NOT NULL,
	`role_title` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `loop_id`)
);
--> statement-breakpoint
CREATE INDEX `interview_loops_owner_state_idx` ON `interview_loops` (`owner_id`,`state`,`updated_at`);--> statement-breakpoint
CREATE TABLE `loop_capture_packets` (
	`owner_id` text NOT NULL,
	`packet_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`private_snapshot` text NOT NULL,
	`status` text NOT NULL,
	`captured_at` integer NOT NULL,
	`backfilled_at` integer,
	`loop_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `packet_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `loop_capture_packets_operation_idx` ON `loop_capture_packets` (`owner_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `loop_capture_packets_owner_status_idx` ON `loop_capture_packets` (`owner_id`,`status`,`captured_at`);--> statement-breakpoint
CREATE TABLE `loop_role_brief_revisions` (
	`owner_id` text NOT NULL,
	`loop_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`display_snapshot` text NOT NULL,
	`private_snapshot` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `loop_id`, `revision`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `loop_role_brief_revisions_operation_idx` ON `loop_role_brief_revisions` (`owner_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `loop_target_profile_migrations` (
	`owner_id` text NOT NULL,
	`target_id` text NOT NULL,
	`target_revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`action` text NOT NULL,
	`loop_id` text,
	`role_brief_revision` integer,
	`receipt` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `target_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `loop_target_profile_migrations_operation_idx` ON `loop_target_profile_migrations` (`owner_id`,`operation_id`);