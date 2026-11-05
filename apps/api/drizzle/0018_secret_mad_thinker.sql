CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`version` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "media_asset_version_positive" CHECK("media_assets"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_asset_scope` ON `media_assets` (`id`,`project_id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `media_asset_page` ON `media_assets` (`project_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `media_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`asset_id` text NOT NULL,
	`media_version_id` text NOT NULL,
	`expected_asset_version` integer NOT NULL,
	`storage_id` text NOT NULL,
	`file_name` text NOT NULL,
	`declared_mime` text NOT NULL,
	`expected_bytes` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`state` text NOT NULL,
	`lease_owner` text,
	`lease_until` integer,
	`received_bytes` integer DEFAULT 0 NOT NULL,
	`prepared_json` text,
	`error_code` text,
	`error_message` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`storage_id`) REFERENCES `storage_connections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_uploads_media_version_id_unique` ON `media_uploads` (`media_version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_upload_idempotency` ON `media_uploads` (`project_id`,`created_by`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `media_upload_page` ON `media_uploads` (`project_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `media_upload_lease` ON `media_uploads` (`state`,`lease_until`);--> statement-breakpoint
CREATE TABLE `media_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`version` integer NOT NULL,
	`storage_id` text NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`media_type` text NOT NULL,
	`mime` text NOT NULL,
	`byte_length` integer NOT NULL,
	`sha256` text NOT NULL,
	`metadata_json` text NOT NULL,
	`poster_json` text,
	`origin` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`storage_id`) REFERENCES `storage_connections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`,`project_id`,`workspace_id`) REFERENCES `media_assets`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "media_version_size" CHECK("media_versions"."byte_length">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_versions_object_key_unique` ON `media_versions` (`object_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_version_number` ON `media_versions` (`asset_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_version_scope` ON `media_versions` (`id`,`project_id`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `storage_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `takes` (
	`id` text PRIMARY KEY NOT NULL,
	`shot_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`media_version_id` text NOT NULL,
	`take_no` integer NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shot_id`,`project_id`,`workspace_id`) REFERENCES `shots`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_version_id`,`project_id`,`workspace_id`) REFERENCES `media_versions`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "take_positive" CHECK("takes"."take_no">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `take_number` ON `takes` (`shot_id`,`take_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `take_media_once` ON `takes` (`shot_id`,`media_version_id`);