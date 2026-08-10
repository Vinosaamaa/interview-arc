CREATE TABLE `behavioral_final_answer_snapshots` (
	`owner_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`snapshot_revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`snapshot` text NOT NULL,
	`correction_of_revision` integer,
	`correction_reason` text,
	`finalized_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `activity_id`, `snapshot_revision`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `behavioral_final_answer_operation_idx` ON `behavioral_final_answer_snapshots` (`owner_id`,`operation_id`);