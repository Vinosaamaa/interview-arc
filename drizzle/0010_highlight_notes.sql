CREATE TABLE `content_highlight_notes` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`highlight_id` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `content_highlight_notes_highlight_idx` ON `content_highlight_notes` (`owner_id`, `highlight_id`);
--> statement-breakpoint
INSERT INTO `content_highlight_notes` (`owner_id`, `id`, `highlight_id`, `body`, `created_at`, `updated_at`)
SELECT `owner_id`, `id` || '-legacy-note', `id`, `note`, `created_at`, `updated_at`
FROM `content_highlights`
WHERE trim(`note`) <> '';
