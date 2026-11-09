CREATE TABLE `workspace_media_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`creation_key` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workspace_folder_version" CHECK("workspace_media_folders"."version">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_folder_scope` ON `workspace_media_folders` (`id`,`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_folder_name` ON `workspace_media_folders` (`workspace_id`,`name_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_folder_creation` ON `workspace_media_folders` (`workspace_id`,`created_by`,`creation_key`);--> statement-breakpoint
CREATE TABLE `workspace_media_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`upload_id` text NOT NULL,
	`created_by` text NOT NULL,
	`creation_key` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`upload_id`) REFERENCES `media_uploads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resource_id`,`workspace_id`) REFERENCES `workspace_media_resources`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_media_imports_upload_id_unique` ON `workspace_media_imports` (`upload_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_media_import_key` ON `workspace_media_imports` (`project_id`,`created_by`,`creation_key`);--> statement-breakpoint
CREATE TABLE `workspace_media_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`source_media_version_id` text NOT NULL,
	`source_project_id` text NOT NULL,
	`folder_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`removed_at` text,
	`creation_key` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_media_version_id`,`source_project_id`,`workspace_id`) REFERENCES `media_versions`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`folder_id`,`workspace_id`) REFERENCES `workspace_media_folders`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workspace_resource_version" CHECK("workspace_media_resources"."version">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_resource_scope` ON `workspace_media_resources` (`id`,`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_resource_creation` ON `workspace_media_resources` (`workspace_id`,`created_by`,`creation_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_resource_active_source` ON `workspace_media_resources` (`workspace_id`,`source_media_version_id`) WHERE "workspace_media_resources"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX `workspace_resource_page` ON `workspace_media_resources` (`workspace_id`,`folder_id`,`id`);
--> statement-breakpoint
CREATE TRIGGER workspace_resource_identity BEFORE UPDATE OF id,workspace_id,source_media_version_id,source_project_id,created_by,created_at,creation_key ON workspace_media_resources BEGIN SELECT RAISE(ABORT,'public resource identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_resource_retention BEFORE DELETE ON workspace_media_resources BEGIN SELECT RAISE(ABORT,'public resources must be removed softly'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_import_immutable_update BEFORE UPDATE ON workspace_media_imports BEGIN SELECT RAISE(ABORT,'public import provenance is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_import_immutable_delete BEFORE DELETE ON workspace_media_imports BEGIN SELECT RAISE(ABORT,'public import provenance is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_import_scope BEFORE INSERT ON workspace_media_imports WHEN NOT EXISTS (SELECT 1 FROM media_uploads u WHERE u.id=NEW.upload_id AND u.project_id=NEW.project_id AND u.workspace_id=NEW.workspace_id AND u.created_by=NEW.created_by) BEGIN SELECT RAISE(ABORT,'public import upload scope mismatch'); END;
