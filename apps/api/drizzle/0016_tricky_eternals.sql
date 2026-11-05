CREATE TABLE `storyboard_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`format` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`snapshot_hash` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`content` blob NOT NULL,
	`sha256` text NOT NULL,
	`byte_length` integer NOT NULL,
	`shot_count` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "storyboard_export_size" CHECK("storyboard_exports"."byte_length" > 0 AND "storyboard_exports"."byte_length" <= 8388608),
	CONSTRAINT "storyboard_export_shot_count" CHECK("storyboard_exports"."shot_count" > 0 AND "storyboard_exports"."shot_count" <= 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storyboard_export_idempotency` ON `storyboard_exports` (`project_id`,`created_by`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `storyboard_export_page` ON `storyboard_exports` (`project_id`,`created_at`,`id`);