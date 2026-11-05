-- Custom SQL migration file, put your code below! --
CREATE TRIGGER timeline_no_update BEFORE UPDATE ON timeline_revisions BEGIN SELECT RAISE(ABORT,'timeline revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER timeline_no_delete BEFORE DELETE ON timeline_revisions BEGIN SELECT RAISE(ABORT,'timeline revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER timeline_sequence BEFORE INSERT ON timeline_revisions WHEN NEW.version<>COALESCE((SELECT MAX(version) FROM timeline_revisions WHERE project_id=NEW.project_id),0)+1 BEGIN SELECT RAISE(ABORT,'invalid timeline version'); END;
--> statement-breakpoint
CREATE TRIGGER animatic_input_immutable BEFORE UPDATE ON animatic_jobs
WHEN NEW.id<>OLD.id OR NEW.timeline_id<>OLD.timeline_id OR NEW.project_id<>OLD.project_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.created_by<>OLD.created_by OR NEW.request_key<>OLD.request_key OR NEW.created_at<>OLD.created_at OR OLD.state IN ('completed','failed','canceled')
BEGIN SELECT RAISE(ABORT,'animatic job input is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER animatic_upload_scope BEFORE INSERT ON media_uploads WHEN NEW.animatic_job_id IS NOT NULL AND (
 NEW.generation_job_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM animatic_jobs j WHERE j.id=NEW.animatic_job_id AND j.project_id=NEW.project_id AND j.workspace_id=NEW.workspace_id AND j.created_by=NEW.created_by AND j.state='archiving')
) BEGIN SELECT RAISE(ABORT,'animatic upload scope mismatch'); END;
--> statement-breakpoint
CREATE UNIQUE INDEX animatic_upload_job ON media_uploads(animatic_job_id) WHERE animatic_job_id IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER animatic_upload_immutable BEFORE UPDATE ON media_uploads WHEN NEW.animatic_job_id IS NOT OLD.animatic_job_id BEGIN SELECT RAISE(ABORT,'animatic upload is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER animatic_complete_scope BEFORE UPDATE ON animatic_jobs WHEN NEW.state='completed' AND NOT EXISTS(
 SELECT 1 FROM media_uploads u JOIN media_versions v ON v.id=u.media_version_id WHERE u.animatic_job_id=NEW.id AND u.state='complete' AND v.id=NEW.media_version_id AND v.project_id=NEW.project_id AND v.workspace_id=NEW.workspace_id AND v.media_type='video' AND v.origin='animatic'
) BEGIN SELECT RAISE(ABORT,'animatic output mismatch'); END;
