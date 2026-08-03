ALTER TABLE `leetcode_code_attempts` ADD `review_response_turn_id` text;
--> statement-breakpoint
CREATE TABLE `leetcode_code_attempt_review_backfills` (
	`owner_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`review_response_turn_id` text NOT NULL,
	`review` text NOT NULL,
	`evidence_hash` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `attempt_id`)
);
--> statement-breakpoint
CREATE INDEX `code_attempt_review_backfills_activity_idx`
ON `leetcode_code_attempt_review_backfills` (`owner_id`,`activity_id`);
--> statement-breakpoint
CREATE TRIGGER `validate_code_attempt_review_backfill`
BEFORE INSERT ON `leetcode_code_attempt_review_backfills`
BEGIN
	SELECT CASE WHEN
		json_extract(NEW.`review`, '$.schemaVersion') IS NOT 1
		OR json_extract(NEW.`review`, '$.status') IS NOT 'complete'
		OR json_extract(NEW.`review`, '$.provenance') IS NOT 'explicit_evidence_backfill'
	THEN RAISE(ABORT, 'invalid_code_attempt_review_backfill') END;
	SELECT CASE WHEN NOT EXISTS (
		SELECT 1 FROM `leetcode_code_attempts`
		WHERE `owner_id` = NEW.`owner_id`
			AND `id` = NEW.`attempt_id`
			AND `activity_id` = NEW.`activity_id`
			AND (
				`review` IS NULL
				OR json_extract(`review`, '$.schemaVersion') IS NOT 1
			)
	) THEN RAISE(ABORT, 'code_attempt_review_not_backfillable') END;
	SELECT CASE WHEN NOT EXISTS (
		SELECT 1 FROM `practice_transcript_turns`
		WHERE `owner_id` = NEW.`owner_id`
			AND `activity_id` = NEW.`activity_id`
			AND `turn_id` = NEW.`review_response_turn_id`
			AND `speaker` = 'specialist'
	) THEN RAISE(ABORT, 'code_attempt_review_turn_not_found') END;
END;
--> statement-breakpoint
CREATE TRIGGER `apply_code_attempt_review_backfill`
AFTER INSERT ON `leetcode_code_attempt_review_backfills`
BEGIN
	UPDATE `leetcode_code_attempts`
	SET `review` = NEW.`review`,
		`review_response_turn_id` = NEW.`review_response_turn_id`,
		`updated_at` = MAX(`updated_at`, NEW.`created_at`)
	WHERE `owner_id` = NEW.`owner_id`
		AND `id` = NEW.`attempt_id`
		AND `activity_id` = NEW.`activity_id`;
END;
