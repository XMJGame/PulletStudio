CREATE INDEX `generation_job_project` ON `generation_jobs` (`project_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE TRIGGER generation_free_worker_guard BEFORE UPDATE OF lease_id ON generation_jobs
WHEN NEW.shot_id IS NULL AND NEW.lease_id IS NOT NULL
 AND NEW.lease_id NOT LIKE 'free:%' AND NEW.lease_id NOT LIKE 'pool:free:%'
BEGIN SELECT RAISE(ABORT,'free generation requires updated generation worker'); END;
