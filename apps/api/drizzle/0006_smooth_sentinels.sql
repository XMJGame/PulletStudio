CREATE TABLE `script_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`file_name` text NOT NULL,
	`kind` text NOT NULL,
	`origin` text NOT NULL,
	`encoding` text NOT NULL,
	`sha256` text NOT NULL,
	`byte_length` integer NOT NULL,
	`original_bytes` blob NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `script_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "script_sources_size" CHECK("script_sources"."byte_length" > 0 AND "script_sources"."byte_length" <= 180000 AND length("script_sources"."original_bytes") = "script_sources"."byte_length")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `script_sources_revision_id_unique` ON `script_sources` (`revision_id`);--> statement-breakpoint
ALTER TABLE `scripts` ADD `lock_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `scripts` ADD `locked_at` text;--> statement-breakpoint
ALTER TABLE `scripts` ADD `locked_by` text REFERENCES users(id);