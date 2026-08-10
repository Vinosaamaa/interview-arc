CREATE TABLE `activity_resume_contexts` (
	`owner_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`snapshot_revision` integer NOT NULL,
	`resume_id` text NOT NULL,
	`resume_revision_id` text NOT NULL,
	`source_label` text NOT NULL,
	`resume_imported_at` integer NOT NULL,
	`state` text NOT NULL,
	`claim_ids` text NOT NULL,
	`evidence_ids` text NOT NULL,
	`captured_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `activity_id`, `snapshot_revision`)
);
