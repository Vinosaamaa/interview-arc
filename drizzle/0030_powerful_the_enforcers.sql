CREATE TABLE `behavioral_target_binding_mutations` (
	`owner_id` text NOT NULL,
	`mutation_id` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`receipt` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `mutation_id`)
);
--> statement-breakpoint
CREATE TABLE `behavioral_target_bindings` (
	`owner_id` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`target_id` text,
	`target_revision` integer,
	`revision` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `scope_type`, `scope_id`)
);
--> statement-breakpoint
CREATE TRIGGER `behavioral_target_bindings_delete_activity`
AFTER DELETE ON `extra_activities`
BEGIN
	DELETE FROM `behavioral_target_bindings`
	WHERE `owner_id` = OLD.`owner_id`
		AND `scope_type` = 'activity'
		AND `scope_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `behavioral_target_bindings_delete_session`
AFTER DELETE ON `live_sessions`
BEGIN
	DELETE FROM `behavioral_target_bindings`
	WHERE `owner_id` = OLD.`owner_id`
		AND `scope_type` = 'session'
		AND `scope_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TABLE `behavioral_target_profile_operations` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`target_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`target_revision` integer NOT NULL,
	`status` text NOT NULL,
	`receipt` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `operation_id`)
);
--> statement-breakpoint
CREATE TABLE `behavioral_target_profile_revisions` (
	`owner_id` text NOT NULL,
	`target_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`display_snapshot` text NOT NULL,
	`private_snapshot` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `target_id`, `revision`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `behavioral_target_revisions_operation_idx` ON `behavioral_target_profile_revisions` (`owner_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `behavioral_target_profiles` (
	`owner_id` text NOT NULL,
	`target_id` text NOT NULL,
	`current_revision` integer NOT NULL,
	`state` text NOT NULL,
	`label` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `target_id`)
);
--> statement-breakpoint
CREATE INDEX `behavioral_target_profiles_owner_state_idx` ON `behavioral_target_profiles` (`owner_id`,`state`,`updated_at`);
