CREATE TABLE `typed_practice_exchange_deletions` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`user_turn_id` text NOT NULL,
	`response_turn_id` text NOT NULL,
	`specialty` text NOT NULL,
	`expected_revision` integer NOT NULL,
	`request_fingerprint` text NOT NULL,
	`reason` text NOT NULL,
	`receipt` text NOT NULL,
	`deleted_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `operation_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `typed_exchange_deletions_user_turn_unique` ON `typed_practice_exchange_deletions` (`owner_id`,`activity_id`,`user_turn_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `typed_exchange_deletions_response_turn_unique` ON `typed_practice_exchange_deletions` (`owner_id`,`activity_id`,`response_turn_id`);