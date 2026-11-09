CREATE TABLE `library_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`creation_key` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "library_folder_version" CHECK("library_folders"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_folder_scope` ON `library_folders` (`id`,`project_id`,`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `library_folder_name` ON `library_folders` (`project_id`,`name_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `library_folder_creation` ON `library_folders` (`project_id`,`created_by`,`creation_key`);--> statement-breakpoint
CREATE TABLE `library_placements` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`media_asset_id` text,
	`entity_id` text,
	`folder_id` text,
	`version` integer NOT NULL,
	FOREIGN KEY (`media_asset_id`,`project_id`,`workspace_id`) REFERENCES `media_assets`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entity_id`,`project_id`,`workspace_id`) REFERENCES `asset_entities`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`folder_id`,`project_id`,`workspace_id`) REFERENCES `library_folders`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "library_placement_target" CHECK(("library_placements"."media_asset_id" IS NOT NULL) <> ("library_placements"."entity_id" IS NOT NULL)),
	CONSTRAINT "library_placement_version" CHECK("library_placements"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_placement_media` ON `library_placements` (`media_asset_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `library_placement_entity` ON `library_placements` (`entity_id`);--> statement-breakpoint
CREATE INDEX `library_placement_folder` ON `library_placements` (`project_id`,`folder_id`);