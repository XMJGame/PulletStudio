CREATE TABLE `generation_outputs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`slot_id` text NOT NULL,
	`position` integer NOT NULL,
	`label` text NOT NULL,
	`role` text NOT NULL,
	`media_type` text NOT NULL,
	`descriptor_json` text NOT NULL,
	`upload_id` text,
	`media_version_id` text,
	FOREIGN KEY (`job_id`) REFERENCES `generation_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`upload_id`) REFERENCES `media_uploads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_version_id`) REFERENCES `media_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "generation_output_position" CHECK("generation_outputs"."position">=0 AND "generation_outputs"."position"<8),
	CONSTRAINT "generation_output_type" CHECK("generation_outputs"."media_type" IN ('image','video','audio')),
	CONSTRAINT "generation_output_role" CHECK("generation_outputs"."role" IN ('preview','intermediate'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_outputs_upload_id_unique` ON `generation_outputs` (`upload_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `generation_outputs_media_version_id_unique` ON `generation_outputs` (`media_version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `generation_output_slot` ON `generation_outputs` (`job_id`,`slot_id`,`position`);--> statement-breakpoint
CREATE INDEX `generation_output_job` ON `generation_outputs` (`job_id`);
--> statement-breakpoint
CREATE TRIGGER generation_extended_worker_guard BEFORE UPDATE OF lease_id ON generation_jobs
WHEN NEW.lease_id IS NOT NULL AND json_extract(NEW.snapshot_json,'$.extendedOutputs')=1
 AND NEW.lease_id NOT LIKE '%:b6' AND NEW.lease_id NOT LIKE '%:b6:b4'
BEGIN SELECT RAISE(ABORT,'extended outputs require updated generation worker'); END;
--> statement-breakpoint
CREATE TRIGGER generation_output_manifest_immutable BEFORE UPDATE OF result_json ON generation_jobs
WHEN json_extract(OLD.result_json,'$.version')='studio.generation-outputs.v1' AND NEW.result_json IS NOT OLD.result_json
BEGIN SELECT RAISE(ABORT,'generation output manifest is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER generation_output_insert_guard BEFORE INSERT ON generation_outputs
WHEN NEW.upload_id IS NOT NULL OR NEW.media_version_id IS NOT NULL OR NOT EXISTS (
 SELECT 1 FROM generation_jobs j, json_each(j.result_json,'$.outputs') f
 WHERE j.id=NEW.job_id AND j.project_id=NEW.project_id AND j.workspace_id=NEW.workspace_id
 AND j.shot_id IS NULL AND j.state='fetching' AND json_extract(j.snapshot_json,'$.extendedOutputs')=1
 AND json_extract(j.result_json,'$.version')='studio.generation-outputs.v1'
 AND json_extract(f.value,'$.slotId')=NEW.slot_id AND json_extract(f.value,'$.index')=NEW.position
 AND json_extract(f.value,'$.mediaType')=NEW.media_type AND json_extract(f.value,'$.label')=NEW.label
 AND json_extract(f.value,'$.role')=NEW.role AND json(json_extract(f.value,'$.result'))=json(NEW.descriptor_json))
BEGIN SELECT RAISE(ABORT,'generation output must match frozen manifest'); END;
--> statement-breakpoint
CREATE TRIGGER generation_output_identity BEFORE UPDATE ON generation_outputs
WHEN NEW.id IS NOT OLD.id OR NEW.job_id IS NOT OLD.job_id OR NEW.project_id IS NOT OLD.project_id
 OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.slot_id IS NOT OLD.slot_id OR NEW.position IS NOT OLD.position
 OR NEW.label IS NOT OLD.label OR NEW.role IS NOT OLD.role OR NEW.media_type IS NOT OLD.media_type
 OR NEW.descriptor_json IS NOT OLD.descriptor_json OR (OLD.upload_id IS NOT NULL AND NEW.upload_id IS NOT OLD.upload_id)
 OR (OLD.media_version_id IS NOT NULL AND NEW.media_version_id IS NOT OLD.media_version_id)
BEGIN SELECT RAISE(ABORT,'generation output identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER generation_output_retain BEFORE DELETE ON generation_outputs
BEGIN SELECT RAISE(ABORT,'generation outputs are retained'); END;
--> statement-breakpoint
CREATE TRIGGER generation_output_upload BEFORE UPDATE OF upload_id ON generation_outputs
WHEN NEW.upload_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM media_uploads u JOIN generation_jobs j ON j.id=NEW.job_id
 WHERE u.id=NEW.upload_id AND u.project_id=NEW.project_id AND u.workspace_id=NEW.workspace_id
 AND u.created_by=j.creator_id AND j.state='fetching' AND u.generation_job_id IS NULL AND u.animatic_job_id IS NULL
 AND u.idempotency_key='generation-output:'||NEW.id AND u.file_name=json_extract(NEW.descriptor_json,'$.filename'))
BEGIN SELECT RAISE(ABORT,'generation output upload scope mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER generation_output_media BEFORE UPDATE OF media_version_id ON generation_outputs
WHEN NEW.media_version_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM media_uploads u JOIN media_versions m ON m.id=u.media_version_id JOIN generation_jobs j ON j.id=NEW.job_id
 WHERE u.id=NEW.upload_id AND u.state='complete' AND m.id=NEW.media_version_id AND m.project_id=NEW.project_id
 AND m.workspace_id=NEW.workspace_id AND m.media_type=NEW.media_type AND j.state='fetching'
 AND m.origin=CASE WHEN j.purpose='workflow_test' THEN 'workflow_test' ELSE 'generation' END)
BEGIN SELECT RAISE(ABORT,'generation output media scope mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER generation_output_completion BEFORE UPDATE OF state ON generation_jobs
WHEN NEW.state IN ('completed','test_completed') AND json_extract(NEW.snapshot_json,'$.extendedOutputs')=1 AND (
 json_extract(NEW.result_json,'$.version') IS NOT 'studio.generation-outputs.v1'
 OR json_array_length(NEW.result_json,'$.outputs') NOT BETWEEN 1 AND 32
 OR (SELECT count(*) FROM generation_outputs o WHERE o.job_id=NEW.id)<>json_array_length(NEW.result_json,'$.outputs')
 OR EXISTS(SELECT 1 FROM generation_outputs o WHERE o.job_id=NEW.id AND o.media_version_id IS NULL))
BEGIN SELECT RAISE(ABORT,'all generation outputs must be archived before completion'); END;

--> statement-breakpoint
CREATE TRIGGER workspace_media_imports_generation_output_collision BEFORE INSERT ON workspace_media_imports
WHEN EXISTS(SELECT 1 FROM generation_outputs o WHERE o.upload_id=NEW.upload_id)
BEGIN SELECT RAISE(ABORT,'generation output upload cannot be imported'); END;

--> statement-breakpoint
CREATE TRIGGER workspace_native_imports_generation_output_collision BEFORE INSERT ON workspace_native_imports
WHEN EXISTS(SELECT 1 FROM generation_outputs o WHERE o.upload_id=NEW.upload_id)
BEGIN SELECT RAISE(ABORT,'generation output upload cannot be imported'); END;

--> statement-breakpoint
CREATE TRIGGER workspace_entity_import_media_generation_output_collision BEFORE INSERT ON workspace_entity_import_media
WHEN EXISTS(SELECT 1 FROM generation_outputs o WHERE o.upload_id=NEW.upload_id)
BEGIN SELECT RAISE(ABORT,'generation output upload cannot be imported'); END;

--> statement-breakpoint
DROP TRIGGER media_asset_identity;
--> statement-breakpoint
CREATE TRIGGER media_asset_identity BEFORE UPDATE ON media_assets
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.workspace_id IS NOT OLD.workspace_id
 OR NEW.name IS NOT OLD.name OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
 OR NOT (
 (NEW.in_library=OLD.in_library AND NEW.version=OLD.version+1)
 OR (OLD.in_library=0 AND NEW.in_library=1 AND NEW.version=OLD.version AND NEW.updated_at=OLD.updated_at AND (
 EXISTS(SELECT 1 FROM generation_jobs j JOIN media_versions m ON m.id=j.media_version_id
 WHERE m.asset_id=OLD.id AND j.state='completed' AND j.purpose='production' AND j.shot_id IS NULL)
 OR EXISTS(SELECT 1 FROM generation_outputs o JOIN generation_jobs j ON j.id=o.job_id JOIN media_versions m ON m.id=o.media_version_id
 WHERE m.asset_id=OLD.id AND j.state='completed' AND j.purpose='production' AND j.shot_id IS NULL))))
BEGIN SELECT RAISE(ABORT,'media identity or version transition invalid'); END;
--> statement-breakpoint
DROP TRIGGER generation_test_media_guard;
--> statement-breakpoint
CREATE TRIGGER generation_test_media_guard BEFORE INSERT ON media_versions
WHEN (NEW.origin='workflow_test') <> (
 EXISTS(SELECT 1 FROM media_uploads u JOIN generation_jobs j ON j.id=u.generation_job_id WHERE u.media_version_id=NEW.id AND j.purpose='workflow_test')
 OR EXISTS(SELECT 1 FROM media_uploads u JOIN generation_outputs o ON o.upload_id=u.id JOIN generation_jobs j ON j.id=o.job_id
 WHERE u.media_version_id=NEW.id AND j.purpose='workflow_test'))
 OR EXISTS(SELECT 1 FROM media_versions m WHERE m.asset_id=NEW.asset_id AND m.origin='workflow_test')
BEGIN SELECT RAISE(ABORT,'workflow test media origin or version mismatch'); END;

--> statement-breakpoint
CREATE TRIGGER generation_output_upload_identity BEFORE UPDATE ON media_uploads
WHEN EXISTS(SELECT 1 FROM generation_outputs o WHERE o.upload_id=OLD.id) AND (
 NEW.project_id IS NOT OLD.project_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.created_by IS NOT OLD.created_by
 OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.file_name IS NOT OLD.file_name
 OR NEW.generation_job_id IS NOT OLD.generation_job_id OR NEW.animatic_job_id IS NOT OLD.animatic_job_id
 OR NEW.asset_id IS NOT OLD.asset_id OR NEW.media_version_id IS NOT OLD.media_version_id
 OR NEW.expected_asset_version IS NOT OLD.expected_asset_version OR NEW.expected_bytes IS NOT OLD.expected_bytes
 OR NEW.storage_id IS NOT OLD.storage_id OR NEW.declared_mime IS NOT OLD.declared_mime)
BEGIN SELECT RAISE(ABORT,'generation output upload identity is immutable'); END;
