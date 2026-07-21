CREATE TABLE `practice_focus` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`activity_id` text,
	`session_id` text,
	`focused_at` integer,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `timer_intervals` (
	`owner_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`kind` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	PRIMARY KEY(`owner_id`, `subject_id`, `kind`, `started_at`)
);
--> statement-breakpoint
ALTER TABLE `timers` ADD `started_at` integer;