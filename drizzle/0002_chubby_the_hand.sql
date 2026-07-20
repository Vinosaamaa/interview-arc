CREATE TABLE `activity_notes` (
	`owner_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`date` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `activity_id`)
);
--> statement-breakpoint
CREATE TABLE `integration_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`label` text DEFAULT 'Personal integration' NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE TABLE `publication_statuses` (
	`owner_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`date` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`artifact_path` text,
	`published_at` integer,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `activity_id`)
);
