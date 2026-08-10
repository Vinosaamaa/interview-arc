CREATE TABLE `practice_interaction_mode_classifications` (
	`owner_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`snapshot_revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`classification` text NOT NULL,
	`correction_of_revision` integer,
	`correction_reason` text,
	`finalized_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `activity_id`, `snapshot_revision`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `practice_mode_classification_operation_idx` ON `practice_interaction_mode_classifications` (`owner_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `practice_interaction_mode_turn_overrides` (
	`owner_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`response_turn_id` text NOT NULL,
	`mutation_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`base_interaction_mode_id` text NOT NULL,
	`override_interaction_mode_id` text NOT NULL,
	`state_revision` integer NOT NULL,
	`registry_version` text NOT NULL,
	`trigger_turn_id` text,
	`reason` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `activity_id`, `response_turn_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `practice_mode_turn_override_mutation_idx` ON `practice_interaction_mode_turn_overrides` (`owner_id`,`mutation_id`);