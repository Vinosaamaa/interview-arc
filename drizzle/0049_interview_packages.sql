CREATE TABLE `interview_packages` (
  `owner_id` text NOT NULL, `package_id` text NOT NULL, `revision` integer NOT NULL,
  `status` text NOT NULL, `interview_at` integer, `time_zone` text, `loop_id` text,
  `stage_id` text, `manifest_digest` text, `consent_affirmed_at` integer,
  `retention` text NOT NULL, `created_at` integer NOT NULL, `updated_at` integer NOT NULL DEFAULT 0,
  PRIMARY KEY (`owner_id`, `package_id`)
);--> statement-breakpoint
CREATE INDEX `interview_packages_assignment_idx` ON `interview_packages` (`owner_id`,`loop_id`,`stage_id`,`status`);--> statement-breakpoint
CREATE INDEX `interview_packages_status_idx` ON `interview_packages` (`owner_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `interview_package_sources` (
  `owner_id` text NOT NULL, `package_id` text NOT NULL, `source_id` text NOT NULL,
  `kind` text NOT NULL, `state` text NOT NULL, `revision` integer NOT NULL,
  `label` text NOT NULL, `media_type` text NOT NULL, `size_bytes` integer NOT NULL,
  `content_hash` text, `private_locator` text, `object_etag` text,
  `transcript_representation` text, `rejection_code` text,
  `created_at` integer NOT NULL, `updated_at` integer NOT NULL DEFAULT 0,
  PRIMARY KEY (`owner_id`, `source_id`)
);--> statement-breakpoint
CREATE UNIQUE INDEX `interview_package_sources_package_source_unique` ON `interview_package_sources` (`owner_id`,`package_id`,`source_id`);--> statement-breakpoint
CREATE INDEX `interview_package_sources_manifest_idx` ON `interview_package_sources` (`owner_id`,`package_id`,`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `interview_package_sources_digest_idx` ON `interview_package_sources` (`owner_id`,`content_hash`);--> statement-breakpoint
CREATE TABLE `interview_package_entries` (
  `owner_id` text NOT NULL, `package_id` text NOT NULL, `entry_id` text NOT NULL,
  `kind` text NOT NULL, `current_revision` integer NOT NULL, `state` text NOT NULL,
  `created_at` integer NOT NULL, `updated_at` integer NOT NULL DEFAULT 0,
  PRIMARY KEY (`owner_id`, `entry_id`)
);--> statement-breakpoint
CREATE INDEX `interview_package_entries_manifest_idx` ON `interview_package_entries` (`owner_id`,`package_id`,`state`,`created_at`);--> statement-breakpoint
CREATE TABLE `interview_package_entry_revisions` (
  `owner_id` text NOT NULL, `entry_id` text NOT NULL, `revision` integer NOT NULL,
  `operation_id` text NOT NULL, `request_fingerprint` text NOT NULL,
  `snapshot` text NOT NULL, `content_hash` text NOT NULL, `created_at` integer NOT NULL,
  PRIMARY KEY (`owner_id`, `entry_id`, `revision`)
);--> statement-breakpoint
CREATE UNIQUE INDEX `interview_package_entry_revisions_operation_idx` ON `interview_package_entry_revisions` (`owner_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `interview_package_assignments` (
  `owner_id` text NOT NULL, `package_id` text NOT NULL, `assignment_revision` integer NOT NULL,
  `operation_id` text NOT NULL, `loop_id` text, `stage_id` text, `loop_revision` integer,
  `role_brief_revision` integer, `assigned_at` integer NOT NULL,
  PRIMARY KEY (`owner_id`, `package_id`, `assignment_revision`)
);--> statement-breakpoint
CREATE UNIQUE INDEX `interview_package_assignments_operation_idx` ON `interview_package_assignments` (`owner_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `interview_package_upload_sessions` (
  `owner_id` text NOT NULL, `session_id` text NOT NULL, `package_id` text NOT NULL,
  `source_id` text NOT NULL, `operation_id` text NOT NULL, `request_fingerprint` text NOT NULL,
  `private_locator` text NOT NULL, `r2_upload_id` text NOT NULL, `expected_bytes` integer NOT NULL,
  `status` text NOT NULL, `expires_at` integer NOT NULL, `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL DEFAULT 0, PRIMARY KEY (`owner_id`, `session_id`)
);--> statement-breakpoint
CREATE UNIQUE INDEX `interview_package_upload_sessions_operation_idx` ON `interview_package_upload_sessions` (`owner_id`,`operation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `interview_package_upload_sessions_source_idx` ON `interview_package_upload_sessions` (`owner_id`,`source_id`);--> statement-breakpoint
CREATE INDEX `interview_package_upload_sessions_expiry_idx` ON `interview_package_upload_sessions` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `interview_package_upload_parts` (
  `owner_id` text NOT NULL, `session_id` text NOT NULL, `part_number` integer NOT NULL,
  `byte_count` integer NOT NULL, `content_hash` text NOT NULL, `etag` text NOT NULL,
  `created_at` integer NOT NULL, PRIMARY KEY (`owner_id`,`session_id`,`part_number`)
);--> statement-breakpoint
CREATE TABLE `interview_package_material_links` (
  `owner_id` text NOT NULL, `package_id` text NOT NULL, `link_revision` integer NOT NULL,
  `state` text NOT NULL, `material_id` text, `material_revision` integer, `proposal_id` text,
  `source_digests` text NOT NULL, `operation_id` text NOT NULL,
  `created_at` integer NOT NULL, `updated_at` integer NOT NULL DEFAULT 0,
  PRIMARY KEY (`owner_id`,`package_id`)
);--> statement-breakpoint
CREATE UNIQUE INDEX `interview_package_material_links_operation_idx` ON `interview_package_material_links` (`owner_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `interview_package_material_proposals` (
  `owner_id` text NOT NULL, `proposal_id` text NOT NULL, `package_id` text NOT NULL,
  `operation_id` text NOT NULL, `request_fingerprint` text NOT NULL, `status` text NOT NULL,
  `material_id` text NOT NULL, `base_material_revision` integer,
  `base_loop_revision` integer NOT NULL, `base_role_brief_revision` integer NOT NULL,
  `source_digests` text NOT NULL, `proposed_snapshot` text NOT NULL,
  `confirmed_material_revision` integer, `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL DEFAULT 0, PRIMARY KEY (`owner_id`,`proposal_id`)
);--> statement-breakpoint
CREATE UNIQUE INDEX `interview_package_material_proposals_operation_idx` ON `interview_package_material_proposals` (`owner_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `interview_package_material_proposals_package_idx` ON `interview_package_material_proposals` (`owner_id`,`package_id`,`status`);--> statement-breakpoint
CREATE TABLE `interview_package_operations` (
  `owner_id` text NOT NULL, `operation_id` text NOT NULL, `package_id` text NOT NULL,
  `action` text NOT NULL, `request_fingerprint` text NOT NULL, `receipt` text NOT NULL,
  `created_at` integer NOT NULL, PRIMARY KEY (`owner_id`,`operation_id`)
);
