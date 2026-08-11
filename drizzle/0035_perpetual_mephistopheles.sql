CREATE TABLE `loop_capture_packet_operations` (
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`packet_id` text NOT NULL,
	`action` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`receipt` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `operation_id`)
);
