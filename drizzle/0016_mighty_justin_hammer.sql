CREATE TABLE `focus_blocks` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`workbench_id` text NOT NULL,
	`date` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`planned_seconds` integer NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `focus_blocks_owner_workbench_idx` ON `focus_blocks` (`owner_id`,`workbench_id`);