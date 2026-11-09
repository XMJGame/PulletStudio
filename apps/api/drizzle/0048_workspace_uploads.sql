CREATE TABLE `workspace_media_files` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`storage_id` text NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`media_type` text NOT NULL,
	`mime` text NOT NULL,
	`byte_length` integer NOT NULL,
	`sha256` text NOT NULL,
	`metadata_json` text NOT NULL,
	`poster_json` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`storage_id`) REFERENCES `storage_connections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workspace_file_size" CHECK("workspace_media_files"."byte_length">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_media_files_object_key_unique` ON `workspace_media_files` (`object_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_file_scope` ON `workspace_media_files` (`id`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `workspace_media_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`file_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`folder_id` text,
	`storage_id` text NOT NULL,
	`file_name` text NOT NULL,
	`declared_mime` text NOT NULL,
	`expected_bytes` integer NOT NULL,
	`received_bytes` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'created' NOT NULL,
	`lease_owner` text,
	`lease_until` integer,
	`prepared_json` text,
	`error_code` text,
	`error_message` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`storage_id`) REFERENCES `storage_connections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workspace_upload_size" CHECK("workspace_media_uploads"."expected_bytes">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_media_uploads_file_id_unique` ON `workspace_media_uploads` (`file_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_media_uploads_resource_id_unique` ON `workspace_media_uploads` (`resource_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_upload_key` ON `workspace_media_uploads` (`workspace_id`,`created_by`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `workspace_upload_lease` ON `workspace_media_uploads` (`state`,`lease_until`);--> statement-breakpoint
CREATE INDEX `workspace_upload_page` ON `workspace_media_uploads` (`workspace_id`,`created_by`,`id`);--> statement-breakpoint
CREATE TABLE `workspace_native_imports` (
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
	FOREIGN KEY (`resource_id`,`workspace_id`) REFERENCES `workspace_native_resources`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_native_imports_upload_id_unique` ON `workspace_native_imports` (`upload_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_native_import_key` ON `workspace_native_imports` (`project_id`,`created_by`,`creation_key`);--> statement-breakpoint
CREATE TABLE `workspace_native_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`file_id` text NOT NULL,
	`folder_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`removed_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`,`workspace_id`) REFERENCES `workspace_media_files`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`folder_id`,`workspace_id`) REFERENCES `workspace_media_folders`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workspace_native_version" CHECK("workspace_native_resources"."version">0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_native_resources_file_id_unique` ON `workspace_native_resources` (`file_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_native_scope` ON `workspace_native_resources` (`id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `workspace_native_page` ON `workspace_native_resources` (`workspace_id`,`folder_id`,`id`);
--> statement-breakpoint
CREATE TRIGGER workspace_file_immutable_update BEFORE UPDATE ON workspace_media_files BEGIN SELECT RAISE(ABORT,'workspace media files are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_file_immutable_delete BEFORE DELETE ON workspace_media_files BEGIN SELECT RAISE(ABORT,'workspace media files are retained'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_native_identity BEFORE UPDATE OF id,workspace_id,file_id,created_by,created_at ON workspace_native_resources BEGIN SELECT RAISE(ABORT,'native resource identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_native_retention BEFORE DELETE ON workspace_native_resources BEGIN SELECT RAISE(ABORT,'native resources must be removed softly'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_native_id BEFORE INSERT ON workspace_native_resources WHEN EXISTS(SELECT 1 FROM workspace_media_resources WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'public resource id collision'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_legacy_resource_id BEFORE INSERT ON workspace_media_resources WHEN EXISTS(SELECT 1 FROM workspace_native_resources WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'public resource id collision'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_upload_identity BEFORE UPDATE OF id,workspace_id,file_id,resource_id,folder_id,storage_id,file_name,declared_mime,expected_bytes,created_by,created_at,idempotency_key,request_hash ON workspace_media_uploads BEGIN SELECT RAISE(ABORT,'workspace upload identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_upload_complete BEFORE UPDATE ON workspace_media_uploads WHEN OLD.state='complete' BEGIN SELECT RAISE(ABORT,'completed workspace uploads are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_upload_retention BEFORE DELETE ON workspace_media_uploads BEGIN SELECT RAISE(ABORT,'workspace upload records are retained'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_native_import_immutable_update BEFORE UPDATE ON workspace_native_imports BEGIN SELECT RAISE(ABORT,'public import provenance is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_native_import_immutable_delete BEFORE DELETE ON workspace_native_imports BEGIN SELECT RAISE(ABORT,'public import provenance is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_native_import_scope BEFORE INSERT ON workspace_native_imports WHEN NOT EXISTS(SELECT 1 FROM media_uploads u WHERE u.id=NEW.upload_id AND u.project_id=NEW.project_id AND u.workspace_id=NEW.workspace_id AND u.created_by=NEW.created_by) BEGIN SELECT RAISE(ABORT,'public import upload scope mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_native_import_collision BEFORE INSERT ON workspace_native_imports WHEN EXISTS(SELECT 1 FROM workspace_media_imports i WHERE i.upload_id=NEW.upload_id OR (i.project_id=NEW.project_id AND i.created_by=NEW.created_by AND i.creation_key=NEW.creation_key)) BEGIN SELECT RAISE(ABORT,'public import key conflict'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_legacy_import_collision BEFORE INSERT ON workspace_media_imports WHEN EXISTS(SELECT 1 FROM workspace_native_imports i WHERE i.upload_id=NEW.upload_id OR (i.project_id=NEW.project_id AND i.created_by=NEW.created_by AND i.creation_key=NEW.creation_key)) BEGIN SELECT RAISE(ABORT,'public import key conflict'); END;
