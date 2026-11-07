CREATE TABLE `workspace_entity_import_media` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`source_media_version_id` text NOT NULL,
	`source_project_id` text NOT NULL,
	`upload_id` text NOT NULL,
	FOREIGN KEY (`upload_id`) REFERENCES `media_uploads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`import_id`,`project_id`,`workspace_id`) REFERENCES `workspace_entity_imports`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_media_version_id`,`source_project_id`,`workspace_id`) REFERENCES `media_versions`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_entity_import_media_upload_id_unique` ON `workspace_entity_import_media` (`upload_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_entity_import_image` ON `workspace_entity_import_media` (`import_id`,`source_media_version_id`);--> statement-breakpoint
CREATE TABLE `workspace_entity_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`created_by` text NOT NULL,
	`creation_key` text NOT NULL,
	`created_at` text NOT NULL,
	`entity_id` text,
	`revision_id` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resource_id`,`workspace_id`) REFERENCES `workspace_entity_resources`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entity_id`,`project_id`,`workspace_id`) REFERENCES `asset_entities`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revision_id`,`project_id`,`workspace_id`) REFERENCES `asset_entity_revisions`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workspace_entity_import_result" CHECK(("workspace_entity_imports"."entity_id" IS NULL)=("workspace_entity_imports"."revision_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_entity_import_scope` ON `workspace_entity_imports` (`id`,`project_id`,`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_entity_import_key` ON `workspace_entity_imports` (`project_id`,`created_by`,`creation_key`);--> statement-breakpoint
CREATE TABLE `workspace_entity_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`source_project_id` text NOT NULL,
	`source_entity_id` text NOT NULL,
	`source_revision_id` text NOT NULL,
	`folder_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`removed_at` text,
	`creation_key` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_entity_id`,`source_project_id`,`workspace_id`) REFERENCES `asset_entities`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_revision_id`,`source_project_id`,`workspace_id`) REFERENCES `asset_entity_revisions`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`folder_id`,`workspace_id`) REFERENCES `workspace_media_folders`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workspace_entity_version" CHECK("workspace_entity_resources"."version">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_entity_scope` ON `workspace_entity_resources` (`id`,`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_entity_creation` ON `workspace_entity_resources` (`workspace_id`,`created_by`,`creation_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_entity_active_source` ON `workspace_entity_resources` (`workspace_id`,`source_revision_id`) WHERE "workspace_entity_resources"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX `workspace_entity_page` ON `workspace_entity_resources` (`workspace_id`,`folder_id`,`id`);
--> statement-breakpoint
CREATE TRIGGER workspace_entity_identity BEFORE UPDATE OF id,workspace_id,source_project_id,source_entity_id,source_revision_id,created_by,created_at,creation_key ON workspace_entity_resources BEGIN SELECT RAISE(ABORT,'public entity identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_entity_retention BEFORE DELETE ON workspace_entity_resources BEGIN SELECT RAISE(ABORT,'public entities must be removed softly'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_entity_source BEFORE INSERT ON workspace_entity_resources WHEN NOT EXISTS(SELECT 1 FROM asset_entity_revisions r JOIN asset_entities e ON e.id=r.entity_id WHERE r.id=NEW.source_revision_id AND r.entity_id=NEW.source_entity_id AND r.project_id=NEW.source_project_id AND r.workspace_id=NEW.workspace_id AND e.kind IN ('character','environment','prop')) BEGIN SELECT RAISE(ABORT,'public entity source mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_entity_import_identity BEFORE UPDATE OF id,resource_id,project_id,workspace_id,created_by,creation_key,created_at ON workspace_entity_imports BEGIN SELECT RAISE(ABORT,'entity import provenance is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_entity_import_retention BEFORE DELETE ON workspace_entity_imports BEGIN SELECT RAISE(ABORT,'entity import provenance is retained'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_entity_import_complete BEFORE UPDATE ON workspace_entity_imports WHEN OLD.entity_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'completed entity imports are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_entity_import_result BEFORE UPDATE OF entity_id,revision_id ON workspace_entity_imports WHEN NEW.entity_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM asset_entity_revisions r WHERE r.id=NEW.revision_id AND r.entity_id=NEW.entity_id AND r.project_id=NEW.project_id AND r.workspace_id=NEW.workspace_id) BEGIN SELECT RAISE(ABORT,'entity import result mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_entity_copy_update BEFORE UPDATE ON workspace_entity_import_media BEGIN SELECT RAISE(ABORT,'entity media provenance is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_entity_copy_delete BEFORE DELETE ON workspace_entity_import_media BEGIN SELECT RAISE(ABORT,'entity media provenance is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_entity_copy_scope BEFORE INSERT ON workspace_entity_import_media WHEN NOT EXISTS(SELECT 1 FROM workspace_entity_imports i JOIN workspace_entity_resources r ON r.id=i.resource_id JOIN entity_media_bindings b ON b.revision_id=r.source_revision_id JOIN media_uploads u ON u.id=NEW.upload_id WHERE i.id=NEW.import_id AND b.media_version_id=NEW.source_media_version_id AND b.project_id=NEW.source_project_id AND i.project_id=NEW.project_id AND i.workspace_id=NEW.workspace_id AND u.project_id=NEW.project_id AND u.workspace_id=NEW.workspace_id AND u.created_by=i.created_by) BEGIN SELECT RAISE(ABORT,'entity media import scope mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_entity_copy_collision BEFORE INSERT ON workspace_entity_import_media WHEN EXISTS(SELECT 1 FROM workspace_media_imports WHERE upload_id=NEW.upload_id) OR EXISTS(SELECT 1 FROM workspace_native_imports WHERE upload_id=NEW.upload_id) BEGIN SELECT RAISE(ABORT,'entity media upload collision'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_legacy_entity_collision BEFORE INSERT ON workspace_media_imports WHEN EXISTS(SELECT 1 FROM workspace_entity_import_media WHERE upload_id=NEW.upload_id) BEGIN SELECT RAISE(ABORT,'entity media upload collision'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_native_entity_collision BEFORE INSERT ON workspace_native_imports WHEN EXISTS(SELECT 1 FROM workspace_entity_import_media WHERE upload_id=NEW.upload_id) BEGIN SELECT RAISE(ABORT,'entity media upload collision'); END;
