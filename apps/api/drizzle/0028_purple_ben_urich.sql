CREATE TABLE `media_package_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`request_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`snapshot_hash` text NOT NULL,
	`manifest_json` text NOT NULL,
	`shot_count` integer NOT NULL,
	`media_bytes` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "media_package_limits" CHECK("media_package_exports"."shot_count" BETWEEN 1 AND 100 AND "media_package_exports"."media_bytes">0 AND "media_package_exports"."media_bytes"<=2147483648 AND length(CAST("media_package_exports"."manifest_json" AS BLOB))<=4194304)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_package_request` ON `media_package_exports` (`project_id`,`created_by`,`request_key`);--> statement-breakpoint
CREATE INDEX `media_package_page` ON `media_package_exports` (`project_id`,`created_at`,`id`);