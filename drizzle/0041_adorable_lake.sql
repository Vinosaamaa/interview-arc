CREATE TABLE `loop_interview_material_operations` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`material_id` text NOT NULL,
	`action` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`material_revision` integer NOT NULL,
	`receipt` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `operation_id`)
);
--> statement-breakpoint
CREATE TABLE `loop_interview_material_revisions` (
	`owner_id` text NOT NULL,
	`material_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `material_id`, `revision`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `loop_interview_material_revisions_operation_idx` ON `loop_interview_material_revisions` (`owner_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `loop_interview_materials` (
	`owner_id` text NOT NULL,
	`material_id` text NOT NULL,
	`loop_id` text NOT NULL,
	`stage_id` text,
	`binding_key` text NOT NULL,
	`kind` text NOT NULL,
	`current_revision` integer NOT NULL,
	`state` text NOT NULL,
	`label` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `material_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `loop_interview_materials_scope_unique` ON `loop_interview_materials` (`owner_id`,`loop_id`,`binding_key`,`kind`);--> statement-breakpoint
CREATE INDEX `loop_interview_materials_loop_idx` ON `loop_interview_materials` (`owner_id`,`loop_id`,`stage_id`,`state`);