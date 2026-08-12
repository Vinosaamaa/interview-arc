CREATE TABLE `cover_letter_artifact_files` (
	`owner_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`format` text NOT NULL,
	`sha256` text NOT NULL,
	`byte_size` integer NOT NULL,
	`mime_type` text NOT NULL,
	`filename` text NOT NULL,
	`visibility` text DEFAULT 'owner_private' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `artifact_id`, `format`)
);
--> statement-breakpoint
CREATE TABLE `cover_letter_artifacts` (
	`owner_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`lineage_id` text NOT NULL,
	`parent_revision_id` text,
	`operation_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`company` text NOT NULL,
	`role` text NOT NULL,
	`source_url` text,
	`job_description_sha256` text NOT NULL,
	`resume_id` text NOT NULL,
	`resume_revision_id` text NOT NULL,
	`evidence_fingerprint` text NOT NULL,
	`storage_generation` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`visibility` text DEFAULT 'owner_private' NOT NULL,
	`created_at` integer NOT NULL,
	`ready_at` integer,
	`superseded_at` integer,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `artifact_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cover_letter_artifacts_operation_idx` ON `cover_letter_artifacts` (`owner_id`,`operation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cover_letter_artifacts_parent_idx` ON `cover_letter_artifacts` (`owner_id`,`parent_revision_id`);--> statement-breakpoint
CREATE INDEX `cover_letter_artifacts_lineage_idx` ON `cover_letter_artifacts` (`owner_id`,`lineage_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `cover_letter_artifacts_state_idx` ON `cover_letter_artifacts` (`owner_id`,`state`,`created_at`);