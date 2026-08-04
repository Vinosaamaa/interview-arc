CREATE TABLE `voice_response_groups` (
	`owner_id` text NOT NULL,
	`response_turn_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`specialty` text NOT NULL,
	`response_body` text NOT NULL,
	`response_occurred_at` integer NOT NULL,
	`member_count` integer NOT NULL,
	`status` text DEFAULT 'provisional' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `response_turn_id`)
);
--> statement-breakpoint
CREATE TABLE `voice_response_group_members` (
	`owner_id` text NOT NULL,
	`capture_id` text NOT NULL,
	`response_turn_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`user_turn_id` text NOT NULL,
	`member_order` integer NOT NULL,
	`transcript` text,
	`checksum` text,
	`occurred_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `capture_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `voice_response_group_members_order_unique`
ON `voice_response_group_members` (`owner_id`,`response_turn_id`,`member_order`);
--> statement-breakpoint
CREATE UNIQUE INDEX `voice_response_group_members_turn_unique`
ON `voice_response_group_members` (`owner_id`,`activity_id`,`user_turn_id`);
--> statement-breakpoint
CREATE INDEX `voice_response_group_members_response_idx`
ON `voice_response_group_members` (`owner_id`,`response_turn_id`);
--> statement-breakpoint
CREATE TABLE `voice_exchange_reservations` (
	`owner_id` text NOT NULL,
	`identity_type` text NOT NULL,
	`identity` text NOT NULL,
	`exchange_kind` text NOT NULL,
	`response_turn_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `identity_type`, `identity`)
);
--> statement-breakpoint
CREATE INDEX `voice_exchange_reservations_response_idx`
ON `voice_exchange_reservations` (`owner_id`,`response_turn_id`);
--> statement-breakpoint
INSERT INTO `voice_exchange_reservations`
  (`owner_id`,`identity_type`,`identity`,`exchange_kind`,`response_turn_id`,`created_at`)
SELECT `owner_id`,'capture',`capture_id`,'single',`response_turn_id`,`created_at`
FROM `voice_specialist_responses`;
--> statement-breakpoint
INSERT INTO `voice_exchange_reservations`
  (`owner_id`,`identity_type`,`identity`,`exchange_kind`,`response_turn_id`,`created_at`)
SELECT `owner_id`,'response_turn',`response_turn_id`,'single',`response_turn_id`,`created_at`
FROM `voice_specialist_responses`;
