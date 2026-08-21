ALTER TABLE `interview_loops` ADD `identity_key` text;--> statement-breakpoint
UPDATE `interview_loops`
SET `identity_key` = lower(trim(`company`)) || char(31) || lower(trim(`role_title`))
WHERE `identity_key` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `interview_loops_owner_identity_unique`
ON `interview_loops` (`owner_id`, `identity_key`);
