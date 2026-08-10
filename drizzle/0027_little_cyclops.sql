CREATE TABLE `practice_interaction_mode_mutations` (
	`owner_id` text NOT NULL,
	`mutation_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`transition_id` text NOT NULL,
	`to_revision` integer NOT NULL,
	`interaction_mode_id` text NOT NULL,
	`registry_version` text NOT NULL,
	`receipt` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `mutation_id`)
);
--> statement-breakpoint
CREATE INDEX `practice_interaction_mode_mutation_activity_idx` ON `practice_interaction_mode_mutations` (`owner_id`,`activity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `practice_interaction_mode_states` (
	`owner_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`interaction_mode_id` text NOT NULL,
	`registry_version` text NOT NULL,
	`revision` integer NOT NULL,
	`source` text NOT NULL,
	`last_mutation_id` text NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `activity_id`)
);
--> statement-breakpoint
CREATE TABLE `practice_interaction_mode_transitions` (
	`owner_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`transition_id` text NOT NULL,
	`mutation_id` text NOT NULL,
	`from_interaction_mode_id` text,
	`to_interaction_mode_id` text NOT NULL,
	`from_revision` integer NOT NULL,
	`to_revision` integer NOT NULL,
	`registry_version` text NOT NULL,
	`trigger_turn_id` text,
	`source` text NOT NULL,
	`reason` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `transition_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `practice_interaction_mode_transition_revision_idx` ON `practice_interaction_mode_transitions` (`owner_id`,`activity_id`,`to_revision`);--> statement-breakpoint
CREATE INDEX `practice_interaction_mode_transition_activity_idx` ON `practice_interaction_mode_transitions` (`owner_id`,`activity_id`,`to_revision`);