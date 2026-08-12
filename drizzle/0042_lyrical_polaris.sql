CREATE TABLE `behavioral_project_activity_links` (
	`owner_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`question_id` text NOT NULL,
	`binding_revision` integer NOT NULL,
	`project_id` text NOT NULL,
	`focus` text NOT NULL,
	`source_claim_id` text,
	`solution_revision` integer,
	`source` text NOT NULL,
	`operation_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`linked_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `activity_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `behavioral_project_activity_link_operation_idx` ON `behavioral_project_activity_links` (`owner_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `behavioral_project_activity_link_project_idx` ON `behavioral_project_activity_links` (`owner_id`,`project_id`,`linked_at`);--> statement-breakpoint
CREATE TABLE `behavioral_project_operations` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`action` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`receipt` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `operation_id`)
);
--> statement-breakpoint
CREATE TABLE `behavioral_project_question_binding_revisions` (
	`owner_id` text NOT NULL,
	`question_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`project_id` text NOT NULL,
	`focus` text NOT NULL,
	`source_claim_id` text,
	`state` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `question_id`, `revision`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `behavioral_project_binding_revision_operation_idx` ON `behavioral_project_question_binding_revisions` (`owner_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `behavioral_project_question_bindings` (
	`owner_id` text NOT NULL,
	`question_id` text NOT NULL,
	`current_revision` integer NOT NULL,
	`project_id` text NOT NULL,
	`focus` text NOT NULL,
	`source_claim_id` text,
	`state` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `question_id`)
);
--> statement-breakpoint
CREATE INDEX `behavioral_project_bindings_project_idx` ON `behavioral_project_question_bindings` (`owner_id`,`project_id`,`focus`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `behavioral_project_overview_unique` ON `behavioral_project_question_bindings` (`owner_id`,`project_id`) WHERE "behavioral_project_question_bindings"."state" = 'active' AND "behavioral_project_question_bindings"."focus" = 'project_overview';--> statement-breakpoint
CREATE UNIQUE INDEX `behavioral_project_resume_claim_unique` ON `behavioral_project_question_bindings` (`owner_id`,`project_id`,`source_claim_id`) WHERE "behavioral_project_question_bindings"."state" = 'active' AND "behavioral_project_question_bindings"."focus" = 'resume_claim';