CREATE TABLE `specialist_write_jobs` (
	`owner_id` text NOT NULL,
	`job_id` text NOT NULL,
	`operation` text NOT NULL,
	`payload_hash` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`total_attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	`lease_expires_at` integer,
	`result` text,
	`error_code` text,
	`error_message` text,
	`error_retryable` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	`completed_at` integer,
	PRIMARY KEY(`owner_id`, `job_id`)
);
--> statement-breakpoint
CREATE INDEX `specialist_write_jobs_due_idx` ON `specialist_write_jobs` (`status`,`next_attempt_at`,`lease_expires_at`);
