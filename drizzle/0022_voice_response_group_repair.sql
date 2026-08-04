CREATE TABLE `voice_response_group_repair_events` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`response_turn_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`prior_status` text NOT NULL,
	`result_status` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `voice_response_group_repair_events_group_idx`
ON `voice_response_group_repair_events` (`owner_id`,`response_turn_id`,`created_at`);
