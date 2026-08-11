CREATE TABLE `learning_course_blueprint_revisions` (
	`owner_id` text NOT NULL,
	`course_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `course_id`, `revision`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_blueprint_revisions_operation_idx` ON `learning_course_blueprint_revisions` (`owner_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `learning_courses` (
	`owner_id` text NOT NULL,
	`course_id` text NOT NULL,
	`current_blueprint_revision` integer NOT NULL,
	`state` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `course_id`)
);
--> statement-breakpoint
CREATE INDEX `learning_courses_owner_state_idx` ON `learning_courses` (`owner_id`,`state`,`updated_at`);--> statement-breakpoint
CREATE TABLE `learning_enrollments` (
	`owner_id` text NOT NULL,
	`enrollment_id` text NOT NULL,
	`course_id` text NOT NULL,
	`blueprint_revision` integer NOT NULL,
	`state` text NOT NULL,
	`current_module_id` text,
	`current_lesson_id` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`enrolled_at` integer NOT NULL,
	`completed_at` integer,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `enrollment_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_enrollments_owner_course_idx` ON `learning_enrollments` (`owner_id`,`course_id`);--> statement-breakpoint
CREATE INDEX `learning_enrollments_owner_state_idx` ON `learning_enrollments` (`owner_id`,`state`,`updated_at`);--> statement-breakpoint
CREATE TABLE `learning_lesson_revisions` (
	`owner_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operation_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`blueprint_revision` integer,
	`snapshot` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `lesson_id`, `revision`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_lesson_revisions_operation_idx` ON `learning_lesson_revisions` (`owner_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `learning_lessons` (
	`owner_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`scope_type` text NOT NULL,
	`course_id` text,
	`enrollment_id` text,
	`module_id` text,
	`current_revision` integer NOT NULL,
	`state` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `lesson_id`)
);
--> statement-breakpoint
CREATE INDEX `learning_lessons_course_idx` ON `learning_lessons` (`owner_id`,`course_id`,`module_id`);--> statement-breakpoint
CREATE INDEX `learning_lessons_scope_idx` ON `learning_lessons` (`owner_id`,`scope_type`,`state`,`updated_at`);--> statement-breakpoint
CREATE TABLE `learning_operations` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`aggregate_type` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`action` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`receipt` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `operation_id`)
);
