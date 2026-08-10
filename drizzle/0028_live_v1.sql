CREATE TABLE `live_activity_clips` (
	`owner_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`clip_id` text NOT NULL,
	`candidate_turn_id` text NOT NULL,
	`pair_id` text,
	`expected_mime_type` text NOT NULL,
	`expected_byte_size` integer NOT NULL,
	`expected_sha256` text NOT NULL,
	`object_key` text NOT NULL,
	`status` text DEFAULT 'staged' NOT NULL,
	`upload_operation_id` text,
	`upload_request_digest` text,
	`upload_holder_id` text,
	`upload_holder_session_id` text,
	`upload_fencing_token` integer,
	`failure_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `activity_id`, `clip_id`),
	CONSTRAINT "live_activity_clips_mime_type_check" CHECK("live_activity_clips"."expected_mime_type" IN ('audio/mp4','audio/mpeg','audio/wav','audio/webm','audio/x-m4a')),
	CONSTRAINT "live_activity_clips_byte_size_check" CHECK("live_activity_clips"."expected_byte_size" > 0 AND "live_activity_clips"."expected_byte_size" <= 104857600),
	CONSTRAINT "live_activity_clips_sha256_check" CHECK(length("live_activity_clips"."expected_sha256") = 64 AND "live_activity_clips"."expected_sha256" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "live_activity_clips_status_check" CHECK("live_activity_clips"."status" IN ('staged','uploading','available','failed','abandoned'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `live_activity_clips_candidate_turn_unique` ON `live_activity_clips` (`owner_id`,`activity_id`,`candidate_turn_id`);--> statement-breakpoint
CREATE INDEX `live_activity_clips_owner_status_idx` ON `live_activity_clips` (`owner_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `live_activity_leases` (
	`owner_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`holder_id` text,
	`holder_session_id` text,
	`fencing_token` integer DEFAULT 0 NOT NULL,
	`expires_at` integer,
	`acquired_at` integer,
	`renewed_at` integer,
	`updated_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `activity_id`)
);
--> statement-breakpoint
CREATE INDEX `live_activity_leases_owner_expiry_idx` ON `live_activity_leases` (`owner_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `live_candidate_evidence_confirmations` (
	`owner_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`pair_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`confirmed_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `activity_id`, `pair_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `live_candidate_evidence_confirmations_operation_unique` ON `live_candidate_evidence_confirmations` (`owner_id`,`activity_id`,`operation_id`);--> statement-breakpoint
CREATE TABLE `live_mutation_receipts` (
	`owner_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`operation` text NOT NULL,
	`request_digest` text NOT NULL,
	`receipt` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `activity_id`, `operation_id`)
);
--> statement-breakpoint
CREATE INDEX `live_mutation_receipts_owner_created_idx` ON `live_mutation_receipts` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `live_owner_revisions` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `live_turn_pairs` (
	`owner_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`pair_id` text NOT NULL,
	`candidate_turn_id` text NOT NULL,
	`interviewer_turn_id` text NOT NULL,
	`candidate_text` text NOT NULL,
	`candidate_evidence_status` text NOT NULL,
	`interviewer_display_markdown` text NOT NULL,
	`interviewer_spoken_text` text NOT NULL,
	`candidate_occurred_at` integer NOT NULL,
	`interviewer_occurred_at` integer NOT NULL,
	`candidate_sequence` integer NOT NULL,
	`interviewer_sequence` integer NOT NULL,
	`clip_id` text,
	`request_digest` text NOT NULL,
	`evidence_confirmed_at` integer,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `activity_id`, `pair_id`),
	CONSTRAINT "live_turn_pairs_evidence_status_check" CHECK("live_turn_pairs"."candidate_evidence_status" IN ('verified','best_available','possible_contamination')),
	CONSTRAINT "live_turn_pairs_adjacent_sequence_check" CHECK("live_turn_pairs"."interviewer_sequence" = "live_turn_pairs"."candidate_sequence" + 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `live_turn_pairs_candidate_turn_unique` ON `live_turn_pairs` (`owner_id`,`activity_id`,`candidate_turn_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `live_turn_pairs_interviewer_turn_unique` ON `live_turn_pairs` (`owner_id`,`activity_id`,`interviewer_turn_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `live_turn_pairs_candidate_sequence_unique` ON `live_turn_pairs` (`owner_id`,`activity_id`,`candidate_sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `live_turn_pairs_interviewer_sequence_unique` ON `live_turn_pairs` (`owner_id`,`activity_id`,`interviewer_sequence`);--> statement-breakpoint
CREATE TABLE `live_turn_reservations` (
	`owner_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`pair_id` text NOT NULL,
	`side` text NOT NULL,
	`sequence` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `activity_id`, `turn_id`),
	CONSTRAINT "live_turn_reservations_side_check" CHECK("live_turn_reservations"."side" IN ('candidate','interviewer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `live_turn_reservations_sequence_unique` ON `live_turn_reservations` (`owner_id`,`activity_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `live_turn_reservations_pair_side_unique` ON `live_turn_reservations` (`owner_id`,`activity_id`,`pair_id`,`side`);
