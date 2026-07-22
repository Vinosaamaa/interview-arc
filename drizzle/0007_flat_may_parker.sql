CREATE TABLE `activity_delivery_analyses` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`activity_id` text NOT NULL,
	`audio_clip_id` text NOT NULL,
	`transcript_turn_id` text NOT NULL,
	`specialty` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`payload` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
