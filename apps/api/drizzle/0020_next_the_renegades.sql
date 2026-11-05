CREATE TABLE `asset_entities` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`version` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`creation_key` text NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "entity_version_positive" CHECK("asset_entities"."version">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_scope` ON `asset_entities` (`id`,`project_id`,`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `entity_create_key` ON `asset_entities` (`project_id`,`created_by`,`creation_key`);--> statement-breakpoint
CREATE INDEX `entity_page` ON `asset_entities` (`project_id`,`kind`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `asset_entity_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`version` integer NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`attributes_json` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entity_id`,`project_id`,`workspace_id`) REFERENCES `asset_entities`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "entity_revision_positive" CHECK("asset_entity_revisions"."version">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_revision_number` ON `asset_entity_revisions` (`entity_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `entity_revision_scope` ON `asset_entity_revisions` (`id`,`project_id`,`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `entity_revision_key` ON `asset_entity_revisions` (`entity_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `entity_media_bindings` (
	`revision_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`media_version_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`revision_id`, `role`, `media_version_id`),
	FOREIGN KEY (`revision_id`,`project_id`,`workspace_id`) REFERENCES `asset_entity_revisions`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_version_id`,`project_id`,`workspace_id`) REFERENCES `media_versions`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entity_media_lookup` ON `entity_media_bindings` (`media_version_id`,`role`);--> statement-breakpoint
CREATE TABLE `shot_asset_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`shot_id` text NOT NULL,
	`card_version` integer NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`purpose` text NOT NULL,
	FOREIGN KEY (`shot_id`,`project_id`,`workspace_id`) REFERENCES `shots`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revision_id`,`project_id`,`workspace_id`) REFERENCES `asset_entity_revisions`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shot_asset_revision` ON `shot_asset_bindings` (`shot_id`,`card_version`,`revision_id`);--> statement-breakpoint
CREATE INDEX `shot_asset_impact` ON `shot_asset_bindings` (`revision_id`,`id`);