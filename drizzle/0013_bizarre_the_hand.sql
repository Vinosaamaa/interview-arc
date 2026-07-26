CREATE TABLE `leetcode_code_attempts` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`activity_id` text NOT NULL,
	`originating_turn_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`language` text NOT NULL,
	`code` text NOT NULL,
	`line_count` integer NOT NULL,
	`occurred_at` integer NOT NULL,
	`review` text,
	`observed_correctness` text DEFAULT 'not_verified' NOT NULL,
	`concrete_findings` text NOT NULL,
	`edge_cases` text NOT NULL,
	`complexity` text,
	`final_declaration` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `voice_capture_intents` (
	`owner_id` text NOT NULL,
	`capture_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`clip_id` text NOT NULL,
	`specialty` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`checksum` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`decided_at` integer,
	`decision_source` text,
	`decision_reason` text,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `capture_id`)
);
