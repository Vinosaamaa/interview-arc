CREATE TABLE `resume_import_locks` (
	`owner_id` text NOT NULL,
	`resume_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`lease_expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `resume_id`)
);
--> statement-breakpoint
CREATE TABLE `resume_import_operations` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`resume_id` text NOT NULL,
	`requested_revision_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`base_current_revision_id` text,
	`status` text DEFAULT 'staging' NOT NULL,
	`error_code` text,
	`receipt` text,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	`completed_at` integer,
	PRIMARY KEY(`owner_id`, `operation_id`)
);
--> statement-breakpoint
CREATE INDEX `resume_import_operations_owner_status_idx` ON `resume_import_operations` (`owner_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `resume_revision_files` (
	`owner_id` text NOT NULL,
	`resume_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`format` text NOT NULL,
	`sha256` text NOT NULL,
	`byte_size` integer NOT NULL,
	`mime_type` text NOT NULL,
	`visibility` text DEFAULT 'owner_private' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `resume_id`, `revision_id`, `format`)
);
--> statement-breakpoint
CREATE TABLE `resume_revisions` (
	`owner_id` text NOT NULL,
	`resume_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`parent_revision_id` text,
	`source_fingerprint` text NOT NULL,
	`import_operation_id` text NOT NULL,
	`visibility` text DEFAULT 'owner_private' NOT NULL,
	`imported_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `resume_id`, `revision_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resume_revisions_source_fingerprint_idx` ON `resume_revisions` (`owner_id`,`resume_id`,`source_fingerprint`);--> statement-breakpoint
CREATE TABLE `resume_sources` (
	`owner_id` text NOT NULL,
	`resume_id` text NOT NULL,
	`source_label` text NOT NULL,
	`current_revision_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `resume_id`)
);
