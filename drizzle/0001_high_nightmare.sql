CREATE TABLE `content_artifacts` (
	`path` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`date` text NOT NULL,
	`title` text NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `content_bank` (
	`category` text NOT NULL,
	`id` text NOT NULL,
	`ord` integer DEFAULT 0 NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`category`, `id`)
);
--> statement-breakpoint
CREATE TABLE `content_journals` (
	`date` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `content_stories` (
	`project_id` text PRIMARY KEY NOT NULL,
	`ord` integer DEFAULT 0 NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
