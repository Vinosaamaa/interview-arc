CREATE TABLE `behavioral_claim_status_events` (
	`owner_id` text NOT NULL,
	`claim_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`status` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `claim_id`, `revision`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `behavioral_claim_events_operation_idx` ON `behavioral_claim_status_events` (`owner_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `behavioral_claims` (
	`owner_id` text NOT NULL,
	`claim_id` text NOT NULL,
	`question_id` text NOT NULL,
	`text` text NOT NULL,
	`scope` text NOT NULL,
	`status` text NOT NULL,
	`claim_strength` text NOT NULL,
	`evidence_ids` text NOT NULL,
	`contrary_evidence_ids` text NOT NULL,
	`gaps` text NOT NULL,
	`safer_wording` text,
	`tags` text NOT NULL,
	`visibility` text DEFAULT 'owner_private' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `claim_id`)
);
--> statement-breakpoint
CREATE INDEX `behavioral_claims_question_idx` ON `behavioral_claims` (`owner_id`,`question_id`,`status`);--> statement-breakpoint
CREATE TABLE `behavioral_evidence_items` (
	`owner_id` text NOT NULL,
	`evidence_id` text NOT NULL,
	`project_key` text NOT NULL,
	`origin` text NOT NULL,
	`statement` text NOT NULL,
	`source_revision` text,
	`evidence_grade` text NOT NULL,
	`attribution_grade` text NOT NULL,
	`claim_strength` text NOT NULL,
	`candidate_state` text NOT NULL,
	`visibility` text DEFAULT 'owner_private' NOT NULL,
	`safe_provenance` text NOT NULL,
	`supports` text NOT NULL,
	`limitations` text NOT NULL,
	`tags` text NOT NULL,
	`owner_attestation` text,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `evidence_id`)
);
--> statement-breakpoint
CREATE INDEX `behavioral_evidence_owner_project_idx` ON `behavioral_evidence_items` (`owner_id`,`project_key`);--> statement-breakpoint
CREATE INDEX `behavioral_evidence_owner_state_idx` ON `behavioral_evidence_items` (`owner_id`,`candidate_state`);--> statement-breakpoint
CREATE TABLE `behavioral_evidence_question_links` (
	`owner_id` text NOT NULL,
	`question_id` text NOT NULL,
	`evidence_id` text NOT NULL,
	`relevance` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `question_id`, `evidence_id`)
);
--> statement-breakpoint
CREATE INDEX `behavioral_evidence_question_idx` ON `behavioral_evidence_question_links` (`owner_id`,`question_id`,`relevance`);
