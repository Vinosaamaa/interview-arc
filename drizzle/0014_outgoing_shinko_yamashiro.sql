CREATE TABLE `deferred_voice_capture_decisions` (
	`owner_id` text NOT NULL,
	`capture_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`decision` text NOT NULL,
	`decision_source` text NOT NULL,
	`decision_reason` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `capture_id`)
);
--> statement-breakpoint
CREATE INDEX `deferred_voice_capture_decisions_owner_expiry_idx` ON `deferred_voice_capture_decisions` (`owner_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `voice_capture_intents_owner_status_updated_idx` ON `voice_capture_intents` (`owner_id`,`status`,`updated_at`,`capture_id`);