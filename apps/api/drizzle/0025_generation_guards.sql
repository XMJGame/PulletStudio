CREATE TRIGGER generation_workflow_immutable BEFORE UPDATE ON generation_workflows BEGIN SELECT RAISE(ABORT,'generation workflow is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER generation_job_input_immutable BEFORE UPDATE ON generation_jobs
WHEN NEW.id<>OLD.id OR NEW.project_id<>OLD.project_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.shot_id<>OLD.shot_id OR NEW.workflow_id<>OLD.workflow_id OR NEW.prompt_id<>OLD.prompt_id OR NEW.shot_version<>OLD.shot_version OR NEW.project_version<>OLD.project_version OR NEW.connection_version<>OLD.connection_version OR NEW.creator_id<>OLD.creator_id OR NEW.request_key<>OLD.request_key OR NEW.snapshot_json<>OLD.snapshot_json OR NEW.created_at<>OLD.created_at OR OLD.state='completed'
BEGIN SELECT RAISE(ABORT,'generation job input is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER generation_upload_scope BEFORE INSERT ON media_uploads
WHEN NEW.generation_job_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM generation_jobs j WHERE j.id=NEW.generation_job_id AND j.project_id=NEW.project_id AND j.workspace_id=NEW.workspace_id AND j.creator_id=NEW.created_by AND j.state='fetching')
BEGIN SELECT RAISE(ABORT,'generation upload scope mismatch'); END;
--> statement-breakpoint
CREATE UNIQUE INDEX generation_upload_job ON media_uploads(generation_job_id) WHERE generation_job_id IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER generation_upload_immutable BEFORE UPDATE ON media_uploads WHEN NEW.generation_job_id IS NOT OLD.generation_job_id BEGIN SELECT RAISE(ABORT,'generation upload is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER generation_job_complete_scope BEFORE UPDATE ON generation_jobs WHEN NEW.state='completed' AND NOT EXISTS(
 SELECT 1 FROM takes t JOIN media_uploads u ON u.media_version_id=t.media_version_id
 WHERE t.id=NEW.take_id AND t.shot_id=NEW.shot_id AND t.media_version_id=NEW.media_version_id AND u.generation_job_id=NEW.id AND u.state='complete'
) BEGIN SELECT RAISE(ABORT,'generation output and take mismatch'); END;
