DROP INDEX `voice_specialist_responses_owner_response_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `voice_specialist_responses_owner_response_unique`
ON `voice_specialist_responses` (`owner_id`,`response_turn_id`);
