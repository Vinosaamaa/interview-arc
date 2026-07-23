CREATE TABLE `practice_workbenches` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`opened_pacific_date` text NOT NULL,
	`opened_at` integer NOT NULL,
	`closed_at` integer,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `practice_workbenches_owner_status_idx` ON `practice_workbenches` (`owner_id`, `status`);
--> statement-breakpoint
ALTER TABLE `extra_activities` ADD `workbench_id` text;
--> statement-breakpoint
ALTER TABLE `live_sessions` ADD `workbench_id` text;
--> statement-breakpoint
CREATE TABLE `provisional_solution_profiles` (
	`owner_id` text NOT NULL,
	`specialty` text NOT NULL,
	`question_id` text NOT NULL,
	`title` text NOT NULL,
	`tags` text NOT NULL,
	`payload` text NOT NULL,
	`prepared_by_activity_id` text,
	`decision` text,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `specialty`, `question_id`)
);
