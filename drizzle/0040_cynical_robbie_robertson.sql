CREATE TABLE `activity_resume_context_backfills` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`snapshot_revision` integer NOT NULL,
	`resume_id` text NOT NULL,
	`resume_revision_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`docx_sha256` text NOT NULL,
	`pdf_sha256` text NOT NULL,
	`resume_imported_at` integer NOT NULL,
	`snapshot_loaded_at` integer NOT NULL,
	`owner_confirmed_at` integer NOT NULL,
	`reason` text NOT NULL,
	`receipt` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `operation_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_resume_context_backfills_target_unique` ON `activity_resume_context_backfills` (`owner_id`,`activity_id`,`snapshot_revision`);