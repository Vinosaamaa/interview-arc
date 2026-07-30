CREATE TABLE `today_planning_mutations` (
	`owner_id` text NOT NULL,
	`mutation_id` text NOT NULL,
	`workbench_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`response` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `mutation_id`)
);
--> statement-breakpoint
CREATE INDEX `today_planning_mutations_owner_workbench_idx`
ON `today_planning_mutations` (`owner_id`,`workbench_id`);
