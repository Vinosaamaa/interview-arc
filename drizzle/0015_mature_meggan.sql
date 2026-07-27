CREATE TABLE `voice_specialist_responses` (
	`owner_id` text NOT NULL,
	`capture_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`user_turn_id` text NOT NULL,
	`response_turn_id` text NOT NULL,
	`specialty` text NOT NULL,
	`response_body` text NOT NULL,
	`response_occurred_at` integer NOT NULL,
	`status` text DEFAULT 'provisional' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `capture_id`)
);
--> statement-breakpoint
CREATE INDEX `voice_specialist_responses_owner_response_idx` ON `voice_specialist_responses` (`owner_id`,`response_turn_id`);--> statement-breakpoint
CREATE INDEX `voice_specialist_responses_owner_status_idx` ON `voice_specialist_responses` (`owner_id`,`status`,`updated_at`);