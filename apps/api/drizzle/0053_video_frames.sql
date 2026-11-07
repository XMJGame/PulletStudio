CREATE TABLE `media_frame_extractions` (
	`id` text PRIMARY KEY NOT NULL,
	`source_version_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`created_by` text NOT NULL,
	`request_key` text NOT NULL,
	`at_ms` integer NOT NULL,
	`expected_sha256` text NOT NULL,
	`upload_id` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`upload_id`) REFERENCES `media_uploads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_version_id`,`project_id`,`workspace_id`) REFERENCES `media_versions`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "media_frame_time" CHECK("media_frame_extractions"."at_ms">=0 AND "media_frame_extractions"."at_ms"<86400000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_frame_extractions_upload_id_unique` ON `media_frame_extractions` (`upload_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_frame_request` ON `media_frame_extractions` (`project_id`,`created_by`,`request_key`);
--> statement-breakpoint
CREATE TRIGGER media_frame_identity BEFORE UPDATE ON media_frame_extractions
WHEN NEW.id IS NOT OLD.id OR NEW.source_version_id IS NOT OLD.source_version_id OR NEW.project_id IS NOT OLD.project_id
 OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.created_by IS NOT OLD.created_by OR NEW.request_key IS NOT OLD.request_key
 OR NEW.at_ms IS NOT OLD.at_ms OR NEW.expected_sha256 IS NOT OLD.expected_sha256
 OR (OLD.upload_id IS NOT NULL AND NEW.upload_id IS NOT OLD.upload_id)
BEGIN SELECT RAISE(ABORT,'frame extraction identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER media_frame_source BEFORE INSERT ON media_frame_extractions
WHEN NEW.upload_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM media_versions m WHERE m.id=NEW.source_version_id
 AND m.project_id=NEW.project_id AND m.workspace_id=NEW.workspace_id AND m.media_type='video' AND m.origin<>'workflow_test'
 AND NEW.at_ms>=0 AND NEW.at_ms<json_extract(m.metadata_json,'$.durationMs'))
BEGIN SELECT RAISE(ABORT,'frame extraction source invalid'); END;
--> statement-breakpoint
CREATE TRIGGER media_frame_upload BEFORE UPDATE OF upload_id ON media_frame_extractions
WHEN NEW.upload_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM media_uploads u WHERE u.id=NEW.upload_id
 AND u.project_id=NEW.project_id AND u.workspace_id=NEW.workspace_id AND u.created_by=NEW.created_by
 AND u.idempotency_key='frame:'||NEW.id AND u.file_name='frame-'||NEW.at_ms||'ms-'||NEW.id||'.png'
 AND u.expected_asset_version=0 AND u.generation_job_id IS NULL AND u.animatic_job_id IS NULL
 AND NOT EXISTS(SELECT 1 FROM generation_outputs o WHERE o.upload_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM workspace_media_imports i WHERE i.upload_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM workspace_native_imports i WHERE i.upload_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM workspace_entity_import_media i WHERE i.upload_id=u.id))
BEGIN SELECT RAISE(ABORT,'frame extraction upload scope invalid'); END;
--> statement-breakpoint
CREATE TRIGGER media_frame_retain BEFORE DELETE ON media_frame_extractions
BEGIN SELECT RAISE(ABORT,'frame extraction sources are retained'); END;
--> statement-breakpoint
CREATE TRIGGER media_frame_origin BEFORE INSERT ON media_versions
WHEN (NEW.origin='video_frame')<>(EXISTS(SELECT 1 FROM media_frame_extractions f JOIN media_uploads u ON u.id=f.upload_id WHERE u.media_version_id=NEW.id))
 OR (NEW.origin='video_frame' AND NOT EXISTS(SELECT 1 FROM media_frame_extractions f JOIN media_uploads u ON u.id=f.upload_id
 WHERE u.media_version_id=NEW.id AND NEW.project_id=f.project_id AND NEW.workspace_id=f.workspace_id
 AND NEW.created_by=f.created_by AND NEW.media_type='image' AND NEW.mime='image/png' AND NEW.sha256=f.expected_sha256
 AND json_extract(NEW.metadata_json,'$.derivedFrom.mediaVersionId')=f.source_version_id AND json_extract(NEW.metadata_json,'$.derivedFrom.atMs')=f.at_ms))
BEGIN SELECT RAISE(ABORT,'frame media source mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER media_frame_upload_identity BEFORE UPDATE ON media_uploads
WHEN EXISTS(SELECT 1 FROM media_frame_extractions f WHERE f.upload_id=OLD.id) AND (
 NEW.project_id IS NOT OLD.project_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.created_by IS NOT OLD.created_by
 OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.file_name IS NOT OLD.file_name OR NEW.expected_bytes IS NOT OLD.expected_bytes
 OR NEW.storage_id IS NOT OLD.storage_id OR NEW.asset_id IS NOT OLD.asset_id OR NEW.media_version_id IS NOT OLD.media_version_id
 OR NEW.expected_asset_version IS NOT OLD.expected_asset_version OR NEW.generation_job_id IS NOT OLD.generation_job_id OR NEW.animatic_job_id IS NOT OLD.animatic_job_id)
BEGIN SELECT RAISE(ABORT,'frame upload identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_media_imports_frame_collision BEFORE INSERT ON workspace_media_imports
WHEN EXISTS(SELECT 1 FROM media_frame_extractions f WHERE f.upload_id=NEW.upload_id)
BEGIN SELECT RAISE(ABORT,'frame upload cannot be imported'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_native_imports_frame_collision BEFORE INSERT ON workspace_native_imports
WHEN EXISTS(SELECT 1 FROM media_frame_extractions f WHERE f.upload_id=NEW.upload_id)
BEGIN SELECT RAISE(ABORT,'frame upload cannot be imported'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_entity_import_media_frame_collision BEFORE INSERT ON workspace_entity_import_media
WHEN EXISTS(SELECT 1 FROM media_frame_extractions f WHERE f.upload_id=NEW.upload_id)
BEGIN SELECT RAISE(ABORT,'frame upload cannot be imported'); END;
