CREATE TABLE `resume_bullet_claim_links` (
	`owner_id` text NOT NULL,
	`resume_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`occurrence_id` text NOT NULL,
	`reference_type` text NOT NULL,
	`reference_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `resume_id`, `revision_id`, `occurrence_id`, `reference_type`, `reference_id`)
);
--> statement-breakpoint
CREATE INDEX `resume_bullet_claim_links_reference_idx` ON `resume_bullet_claim_links` (`owner_id`,`reference_type`,`reference_id`);--> statement-breakpoint
CREATE TABLE `resume_bullet_occurrences` (
	`owner_id` text NOT NULL,
	`resume_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`occurrence_id` text NOT NULL,
	`section_label` text NOT NULL,
	`ordinal` integer NOT NULL,
	`text` text NOT NULL,
	`content_fingerprint` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `resume_id`, `revision_id`, `occurrence_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resume_bullet_occurrences_order_idx` ON `resume_bullet_occurrences` (`owner_id`,`resume_id`,`revision_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `resume_bullet_occurrences_content_idx` ON `resume_bullet_occurrences` (`owner_id`,`content_fingerprint`);--> statement-breakpoint
CREATE TABLE `resume_current_revision_operations` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`resume_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`prior_revision_id` text,
	`receipt` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `operation_id`)
);
--> statement-breakpoint
CREATE TABLE `resume_revision_review_impacts` (
	`owner_id` text NOT NULL,
	`resume_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`question_id` text NOT NULL,
	`solution_profile_revision` integer NOT NULL,
	`changed_claim_ids` text NOT NULL,
	`status` text DEFAULT 'needs_review' NOT NULL,
	`created_at` integer NOT NULL,
	`acknowledged_at` integer,
	PRIMARY KEY(`owner_id`, `resume_id`, `revision_id`, `question_id`)
);
--> statement-breakpoint
CREATE INDEX `resume_revision_review_impacts_question_idx` ON `resume_revision_review_impacts` (`owner_id`,`question_id`,`status`);--> statement-breakpoint
ALTER TABLE `resume_revisions` ADD `source_provider` text;--> statement-breakpoint
ALTER TABLE `resume_revisions` ADD `source_revision_fingerprint` text;--> statement-breakpoint
ALTER TABLE `resume_revisions` ADD `manifest_fingerprint` text;--> statement-breakpoint
ALTER TABLE `resume_revisions` ADD `extraction_version` text;