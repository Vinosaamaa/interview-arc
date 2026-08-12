CREATE TABLE `behavioral_evidence_review_events` (
	`owner_id` text NOT NULL,
	`evidence_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`from_state` text NOT NULL,
	`to_state` text NOT NULL,
	`reason` text NOT NULL,
	`replacement_evidence_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `evidence_id`, `revision`)
);
--> statement-breakpoint
CREATE INDEX `behavioral_evidence_review_events_operation_idx` ON `behavioral_evidence_review_events` (`owner_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `behavioral_evidence_review_operations` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`receipt` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `operation_id`)
);
--> statement-breakpoint
CREATE TABLE `behavioral_evidence_source_operations` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`source_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`source_revision` integer NOT NULL,
	`status` text NOT NULL,
	`receipt` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `operation_id`)
);
--> statement-breakpoint
CREATE TABLE `behavioral_evidence_source_revisions` (
	`owner_id` text NOT NULL,
	`source_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `source_id`, `revision`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `behavioral_evidence_source_revisions_operation_idx` ON `behavioral_evidence_source_revisions` (`owner_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `behavioral_evidence_sources` (
	`owner_id` text NOT NULL,
	`source_id` text NOT NULL,
	`current_revision` integer NOT NULL,
	`state` text NOT NULL,
	`project_key` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`safe_hint` text NOT NULL,
	`availability` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `source_id`)
);
--> statement-breakpoint
CREATE INDEX `behavioral_evidence_sources_owner_state_idx` ON `behavioral_evidence_sources` (`owner_id`,`state`,`updated_at`);--> statement-breakpoint
CREATE INDEX `behavioral_evidence_sources_owner_project_idx` ON `behavioral_evidence_sources` (`owner_id`,`project_key`);--> statement-breakpoint
ALTER TABLE `behavioral_evidence_items` ADD `review_revision` integer DEFAULT 1 NOT NULL;