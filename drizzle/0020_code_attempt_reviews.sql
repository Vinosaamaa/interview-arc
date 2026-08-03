ALTER TABLE `leetcode_code_attempts` ADD `review_response_turn_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `code_attempts_owner_activity_sequence_idx`
ON `leetcode_code_attempts` (`owner_id`,`activity_id`,`sequence`);
--> statement-breakpoint
CREATE TABLE `leetcode_code_attempt_review_backfills` (
	`owner_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`review_response_turn_id` text NOT NULL,
	`review` text NOT NULL,
	`evidence_hash` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `attempt_id`)
);
--> statement-breakpoint
CREATE INDEX `code_attempt_review_backfills_activity_idx`
ON `leetcode_code_attempt_review_backfills` (`owner_id`,`activity_id`);
