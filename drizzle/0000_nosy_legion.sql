CREATE TABLE `extra_activities` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`date` text NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `live_sessions` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`date` text NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `outcomes` (
	`owner_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`outcome` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `activity_id`)
);
--> statement-breakpoint
CREATE TABLE `timers` (
	`owner_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`kind` text NOT NULL,
	`accumulated_seconds` integer DEFAULT 0 NOT NULL,
	`running_since` integer,
	`completed` integer DEFAULT false NOT NULL,
	`completed_at` integer,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `subject_id`, `kind`)
);
