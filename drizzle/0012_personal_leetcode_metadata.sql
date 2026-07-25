ALTER TABLE `owner_bank_questions` ADD `problem_number` integer;
--> statement-breakpoint
ALTER TABLE `owner_bank_questions` ADD `difficulty` text;
--> statement-breakpoint
ALTER TABLE `owner_bank_questions` ADD `acceptance_rate` real;
--> statement-breakpoint
ALTER TABLE `owner_bank_questions` ADD `topics` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `owner_bank_questions` ADD `company_tags` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `owner_bank_questions` ADD `company_signals` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `owner_bank_questions` ADD `metadata_references` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `owner_bank_questions` ADD `metadata_captured_at` integer;
