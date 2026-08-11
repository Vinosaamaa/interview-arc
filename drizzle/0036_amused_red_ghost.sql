CREATE TABLE `loop_activity_binding_operations` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`receipt` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `operation_id`)
);
--> statement-breakpoint
CREATE TABLE `loop_activity_bindings` (
	`owner_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`loop_id` text NOT NULL,
	`stage_id` text,
	`loop_revision` integer NOT NULL,
	`role_brief_revision` integer NOT NULL,
	`specialty` text NOT NULL,
	`question_id` text NOT NULL,
	`role_brief_display_snapshot` text NOT NULL,
	`binding_revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `activity_id`)
);
--> statement-breakpoint
CREATE INDEX `loop_activity_bindings_loop_idx` ON `loop_activity_bindings` (`owner_id`,`loop_id`,`stage_id`);--> statement-breakpoint
CREATE TABLE `loop_activity_history` (
	`owner_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`loop_id` text NOT NULL,
	`stage_id` text,
	`role_brief_revision` integer NOT NULL,
	`specialty` text NOT NULL,
	`question_id` text NOT NULL,
	`result` text NOT NULL,
	`completed_at` integer NOT NULL,
	`receipt` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `activity_id`)
);
--> statement-breakpoint
CREATE INDEX `loop_activity_history_loop_idx` ON `loop_activity_history` (`owner_id`,`loop_id`,`completed_at`);
--> statement-breakpoint
CREATE TRIGGER `loop_activity_history_after_timer_insert`
AFTER INSERT ON `timers`
WHEN NEW.`kind` = 'activity' AND NEW.`completed` = 1 AND NEW.`completed_at` IS NOT NULL
BEGIN
	INSERT OR IGNORE INTO `loop_activity_history` (
		`owner_id`, `activity_id`, `loop_id`, `stage_id`, `role_brief_revision`,
		`specialty`, `question_id`, `result`, `completed_at`, `receipt`, `created_at`
	)
	SELECT
		binding.`owner_id`, binding.`activity_id`, binding.`loop_id`, binding.`stage_id`,
		binding.`role_brief_revision`, binding.`specialty`, binding.`question_id`,
		outcome.`outcome`, NEW.`completed_at`,
		json_object(
			'schemaVersion', 1,
			'source', 'authoritative_timer_completion',
			'activityId', binding.`activity_id`,
			'timerRevision', NEW.`revision`,
			'outcomeRevision', outcome.`revision`,
			'completedAt', NEW.`completed_at`
		),
		NEW.`completed_at`
	FROM `loop_activity_bindings` AS binding
	JOIN `outcomes` AS outcome
		ON outcome.`owner_id` = binding.`owner_id`
		AND outcome.`activity_id` = binding.`activity_id`
	WHERE binding.`owner_id` = NEW.`owner_id`
		AND binding.`activity_id` = NEW.`subject_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `loop_activity_history_after_timer_update`
AFTER UPDATE OF `completed`, `completed_at` ON `timers`
WHEN NEW.`kind` = 'activity' AND NEW.`completed` = 1 AND NEW.`completed_at` IS NOT NULL
BEGIN
	INSERT OR IGNORE INTO `loop_activity_history` (
		`owner_id`, `activity_id`, `loop_id`, `stage_id`, `role_brief_revision`,
		`specialty`, `question_id`, `result`, `completed_at`, `receipt`, `created_at`
	)
	SELECT
		binding.`owner_id`, binding.`activity_id`, binding.`loop_id`, binding.`stage_id`,
		binding.`role_brief_revision`, binding.`specialty`, binding.`question_id`,
		outcome.`outcome`, NEW.`completed_at`,
		json_object(
			'schemaVersion', 1,
			'source', 'authoritative_timer_completion',
			'activityId', binding.`activity_id`,
			'timerRevision', NEW.`revision`,
			'outcomeRevision', outcome.`revision`,
			'completedAt', NEW.`completed_at`
		),
		NEW.`completed_at`
	FROM `loop_activity_bindings` AS binding
	JOIN `outcomes` AS outcome
		ON outcome.`owner_id` = binding.`owner_id`
		AND outcome.`activity_id` = binding.`activity_id`
	WHERE binding.`owner_id` = NEW.`owner_id`
		AND binding.`activity_id` = NEW.`subject_id`;
END;
