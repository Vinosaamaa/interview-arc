CREATE TABLE `resume_revision_file_deletions` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`resume_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`status` text NOT NULL,
	`error_code` text,
	`reason` text NOT NULL,
	`receipt` text,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	`completed_at` integer,
	PRIMARY KEY(`owner_id`, `operation_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resume_revision_file_deletions_target_unique` ON `resume_revision_file_deletions` (`owner_id`,`resume_id`,`revision_id`);--> statement-breakpoint
CREATE INDEX `resume_revision_file_deletions_status_idx` ON `resume_revision_file_deletions` (`owner_id`,`status`,`updated_at`);