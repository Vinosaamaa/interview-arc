CREATE TABLE `activity_solution_links` (
	`owner_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`specialty` text NOT NULL,
	`question_id` text NOT NULL,
	`solution_revision` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `activity_id`)
);
--> statement-breakpoint
CREATE TABLE `owner_bank_questions` (
	`owner_id` text NOT NULL,
	`specialty` text NOT NULL,
	`question_id` text NOT NULL,
	`title` text NOT NULL,
	`prompt` text,
	`url` text,
	`source` text DEFAULT 'personal' NOT NULL,
	`tags` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`target_minutes` integer DEFAULT 60 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `specialty`, `question_id`)
);
--> statement-breakpoint
CREATE TABLE `problem_preferences` (
	`owner_id` text NOT NULL,
	`specialty` text NOT NULL,
	`question_id` text NOT NULL,
	`starred` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `specialty`, `question_id`)
);
--> statement-breakpoint
CREATE TABLE `problem_solution_profiles` (
	`owner_id` text NOT NULL,
	`specialty` text NOT NULL,
	`question_id` text NOT NULL,
	`title` text NOT NULL,
	`current_revision` integer DEFAULT 1 NOT NULL,
	`tags` text NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `specialty`, `question_id`)
);
--> statement-breakpoint
CREATE TABLE `problem_solution_revisions` (
	`owner_id` text NOT NULL,
	`specialty` text NOT NULL,
	`question_id` text NOT NULL,
	`revision` integer NOT NULL,
	`activity_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `specialty`, `question_id`, `revision`)
);
