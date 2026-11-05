-- Custom SQL migration file, put your code below! --
CREATE TRIGGER take_review_no_update BEFORE UPDATE ON take_review_events BEGIN SELECT RAISE(ABORT,'take reviews are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER take_review_no_delete BEFORE DELETE ON take_review_events BEGIN SELECT RAISE(ABORT,'take reviews are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER shot_selection_no_update BEFORE UPDATE ON shot_take_selections BEGIN SELECT RAISE(ABORT,'take selections are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER shot_selection_no_delete BEFORE DELETE ON shot_take_selections BEGIN SELECT RAISE(ABORT,'take selections are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER take_review_transition BEFORE INSERT ON take_review_events WHEN
NEW.version<>COALESCE((SELECT MAX(version) FROM take_review_events WHERE take_id=NEW.take_id),0)+1 OR NOT (
 (NEW.action='submit' AND COALESCE((SELECT action FROM take_review_events WHERE take_id=NEW.take_id ORDER BY version DESC LIMIT 1),'withdraw') IN ('withdraw','reject','revoke')) OR
 (NEW.action IN ('withdraw','approve','reject') AND (SELECT action FROM take_review_events WHERE take_id=NEW.take_id ORDER BY version DESC LIMIT 1)='submit') OR
 (NEW.action='revoke' AND (SELECT action FROM take_review_events WHERE take_id=NEW.take_id ORDER BY version DESC LIMIT 1)='approve')
) BEGIN SELECT RAISE(ABORT,'invalid take review transition'); END;
--> statement-breakpoint
CREATE TRIGGER take_review_context BEFORE INSERT ON take_review_events WHEN
 (NEW.action<>'submit' AND NOT EXISTS(
   SELECT 1 FROM take_review_events e WHERE e.take_id=NEW.take_id AND e.version=NEW.version-1
   AND e.shot_version=NEW.shot_version AND e.project_version=NEW.project_version
   AND e.prompt_id IS NEW.prompt_id AND e.generation_job_id IS NEW.generation_job_id
 )) OR
 (NEW.action IN ('submit','approve') AND NOT EXISTS(
   SELECT 1 FROM shots s JOIN projects p ON p.id=s.project_id
   WHERE s.id=NEW.shot_id AND s.version=NEW.shot_version AND p.version=NEW.project_version
 )) OR
 ((NEW.generation_job_id IS NULL)<>(NEW.prompt_id IS NULL)) OR
 (NEW.generation_job_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM generation_jobs j WHERE j.id=NEW.generation_job_id AND j.state='completed'
   AND j.take_id=NEW.take_id AND j.shot_id=NEW.shot_id AND j.prompt_id=NEW.prompt_id
   AND j.media_version_id=NEW.media_version_id AND j.project_id=NEW.project_id AND j.workspace_id=NEW.workspace_id
 ))
 BEGIN SELECT RAISE(ABORT,'invalid take review context'); END;
--> statement-breakpoint
CREATE TRIGGER shot_selection_valid BEFORE INSERT ON shot_take_selections WHEN
 NEW.version<>COALESCE((SELECT MAX(version) FROM shot_take_selections WHERE shot_id=NEW.shot_id),0)+1 OR
 (NEW.take_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM take_review_events r JOIN shots s ON s.id=r.shot_id JOIN projects p ON p.id=r.project_id
   WHERE r.id=NEW.approval_id AND r.take_id=NEW.take_id AND r.shot_id=NEW.shot_id
   AND r.project_id=NEW.project_id AND r.workspace_id=NEW.workspace_id AND r.action='approve'
   AND r.version=(SELECT MAX(version) FROM take_review_events WHERE take_id=NEW.take_id)
   AND r.shot_version=s.version AND r.project_version=p.version
 )) BEGIN SELECT RAISE(ABORT,'invalid take selection'); END;
