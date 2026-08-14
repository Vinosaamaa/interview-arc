CREATE TABLE `practice_record_revisions` (
	`owner_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`record_fingerprint` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `activity_id`, `revision`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `practice_record_revisions_operation_idx` ON `practice_record_revisions` (`owner_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `practice_records` (
	`owner_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`current_revision` integer NOT NULL,
	`specialty` text NOT NULL,
	`question_id` text NOT NULL,
	`title` text NOT NULL,
	`completed_at` integer NOT NULL,
	`practice_date` text NOT NULL,
	`outcome` text,
	`solution_revision` integer NOT NULL,
	`record_fingerprint` text NOT NULL,
	`finalization_operation_id` text NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `activity_id`)
);
--> statement-breakpoint
CREATE INDEX `practice_records_owner_date_idx` ON `practice_records` (`owner_id`,`practice_date`,`completed_at`,`activity_id`);--> statement-breakpoint
ALTER TABLE `activity_finalizations` ADD `finalization_operation_id` text;--> statement-breakpoint
ALTER TABLE `activity_finalizations` ADD `finalization_request_fingerprint` text;--> statement-breakpoint
ALTER TABLE `activity_finalizations` ADD `practice_record_revision` integer;--> statement-breakpoint
ALTER TABLE `activity_finalizations` ADD `practice_record_fingerprint` text;