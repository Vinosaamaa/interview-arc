CREATE TABLE `activity_audio_clips` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`activity_id` text NOT NULL,
	`object_key` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`label` text DEFAULT 'Practice answer' NOT NULL,
	`duration_seconds` integer,
	`status` text DEFAULT 'local_only' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `activity_finalizations` (
	`owner_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`specialty` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`payload` text NOT NULL,
	`finalized_at` integer,
	`published_at` integer,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `activity_id`)
);
--> statement-breakpoint
CREATE TABLE `practice_notes` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`activity_id` text NOT NULL,
	`date` text NOT NULL,
	`body` text NOT NULL,
	`kind` text DEFAULT 'remember' NOT NULL,
	`pinned` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `practice_transcript_turns` (
	`owner_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`specialty` text NOT NULL,
	`speaker` text NOT NULL,
	`body` text NOT NULL,
	`source` text DEFAULT 'codex' NOT NULL,
	`sequence` integer NOT NULL,
	`occurred_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `activity_id`, `turn_id`)
);
--> statement-breakpoint
CREATE TABLE `review_schedules` (
	`owner_id` text NOT NULL,
	`review_key` text NOT NULL,
	`activity_id` text NOT NULL,
	`question_id` text,
	`specialty` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`reason` text NOT NULL,
	`due_date` text NOT NULL,
	`interval_days` integer NOT NULL,
	`stage` integer DEFAULT 0 NOT NULL,
	`review_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `review_key`)
);
--> statement-breakpoint
CREATE TABLE `specialist_tasks` (
	`owner_id` text NOT NULL,
	`specialty` text NOT NULL,
	`thread_id` text NOT NULL,
	`host_id` text,
	`title` text NOT NULL,
	`connected_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `specialty`)
);
