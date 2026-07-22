CREATE TABLE `content_highlights` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`quote` text NOT NULL,
	`prefix` text DEFAULT '' NOT NULL,
	`suffix` text DEFAULT '' NOT NULL,
	`color` text DEFAULT 'yellow' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
