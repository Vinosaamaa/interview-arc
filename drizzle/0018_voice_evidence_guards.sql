ALTER TABLE `activity_audio_clips` ADD `audio_lost_reason` text;
--> statement-breakpoint
ALTER TABLE `activity_audio_clips` ADD `audio_lost_detected_at` integer;
--> statement-breakpoint
ALTER TABLE `activity_audio_clips` ADD `audio_lost_acknowledged_at` integer;
--> statement-breakpoint
ALTER TABLE `activity_delivery_analyses` ADD `publish_without_review_acknowledged_at` integer;
