ALTER TABLE media_uploads ADD COLUMN add_to_library integer NOT NULL DEFAULT 1 CHECK(add_to_library IN (0,1));
--> statement-breakpoint
CREATE TRIGGER media_upload_library_intent_immutable BEFORE UPDATE OF add_to_library ON media_uploads
WHEN NEW.add_to_library IS NOT OLD.add_to_library
BEGIN SELECT RAISE(ABORT,'upload library intent is immutable'); END;
--> statement-breakpoint
ALTER TABLE library_placements ADD COLUMN display_name text CHECK(display_name IS NULL OR (length(display_name)>0 AND length(display_name)<=180));
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
 WHERE m.asset_id=OLD.id AND j.state='completed' AND j.purpose='production' AND j.shot_id IS NULL)
 OR EXISTS(SELECT 1 FROM media_uploads u JOIN media_versions m ON m.id=u.media_version_id
 WHERE m.asset_id=OLD.id AND m.version=1 AND m.origin='manual' AND u.state='complete' AND u.add_to_library=0
 AND u.expected_asset_version=0 AND u.generation_job_id IS NULL AND u.animatic_job_id IS NULL))))
BEGIN SELECT RAISE(ABORT,'media identity or version transition invalid'); END;
