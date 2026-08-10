CREATE TABLE `behavioral_stories` (
	`owner_id` text NOT NULL,
	`story_id` text NOT NULL,
	`current_revision` integer NOT NULL,
	`state` text NOT NULL,
	`title` text NOT NULL,
	`project_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `story_id`)
);
--> statement-breakpoint
CREATE INDEX `behavioral_stories_owner_state_idx` ON `behavioral_stories` (`owner_id`,`state`,`updated_at`);--> statement-breakpoint
CREATE TABLE `behavioral_story_operations` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`story_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`story_revision` integer NOT NULL,
	`status` text NOT NULL,
	`receipt` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `operation_id`)
);
--> statement-breakpoint
CREATE TABLE `behavioral_story_question_links` (
	`owner_id` text NOT NULL,
	`story_id` text NOT NULL,
	`question_id` text NOT NULL,
	`story_revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `story_id`, `question_id`)
);
--> statement-breakpoint
CREATE INDEX `behavioral_story_question_idx` ON `behavioral_story_question_links` (`owner_id`,`question_id`,`story_revision`);--> statement-breakpoint
CREATE TABLE `behavioral_story_revisions` (
	`owner_id` text NOT NULL,
	`story_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `story_id`, `revision`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `behavioral_story_revisions_operation_idx` ON `behavioral_story_revisions` (`owner_id`,`operation_id`);