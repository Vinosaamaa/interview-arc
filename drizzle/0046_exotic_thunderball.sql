CREATE TABLE `practice_asset_revisions` (
	`owner_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`revision` integer NOT NULL,
	`activity_id` text NOT NULL,
	`question_id` text NOT NULL,
	`practice_record_revision` integer NOT NULL,
	`role` text NOT NULL,
	`mime_type` text NOT NULL,
	`sha256` text NOT NULL,
	`byte_size` integer NOT NULL,
	`private_locator` text NOT NULL,
	`alt_text` text NOT NULL,
	`authorship` text DEFAULT 'owner' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `asset_id`, `revision`)
);
--> statement-breakpoint
CREATE TABLE `practice_asset_set_operations` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`question_id` text NOT NULL,
	`checkpoint_revision` integer NOT NULL,
	`request_fingerprint` text NOT NULL,
	`manifest_sha256` text NOT NULL,
	`status` text NOT NULL,
	`practice_record_revision` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `operation_id`)
);
--> statement-breakpoint
CREATE INDEX `practice_asset_set_activity_idx` ON `practice_asset_set_operations` (`owner_id`,`activity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `practice_asset_staging_rows` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`revision` integer NOT NULL,
	`role` text NOT NULL,
	`mime_type` text NOT NULL,
	`sha256` text NOT NULL,
	`byte_size` integer NOT NULL,
	`private_locator` text NOT NULL,
	`alt_text` text NOT NULL,
	`authorship` text DEFAULT 'owner' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `operation_id`, `asset_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `practice_asset_staging_role_idx` ON `practice_asset_staging_rows` (`owner_id`,`operation_id`,`role`);--> statement-breakpoint
CREATE TABLE `practice_assets` (
	`owner_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`current_revision` integer NOT NULL,
	`role` text NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `asset_id`)
);
--> statement-breakpoint
CREATE INDEX `practice_assets_activity_idx` ON `practice_assets` (`owner_id`,`activity_id`,`role`);--> statement-breakpoint
CREATE TABLE `practice_design_checkpoint_revisions` (
	`owner_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`sha256` text NOT NULL,
	`byte_size` integer NOT NULL,
	`private_locator` text NOT NULL,
	`alt_text` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `activity_id`, `revision`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `practice_design_checkpoint_operation_idx` ON `practice_design_checkpoint_revisions` (`owner_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `practice_design_checkpoints` (
	`owner_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`current_revision` integer NOT NULL,
	`sha256` text NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `activity_id`)
);
