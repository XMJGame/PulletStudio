CREATE TABLE `workflow_release_events` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`action` text NOT NULL,
	`test_job_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`reason` text NOT NULL,
	`request_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `workflow_catalogs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflow_catalog_revisions`(`workflow_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`test_job_id`) REFERENCES `generation_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workflow_release_valid" CHECK("workflow_release_events"."sequence">0 AND "workflow_release_events"."action" IN ('publish','revoke') AND length("workflow_release_events"."reason") BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_release_sequence` ON `workflow_release_events` (`family_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_release_request` ON `workflow_release_events` (`family_id`,`actor_id`,`request_key`);--> statement-breakpoint
ALTER TABLE `generation_jobs` ADD `purpose` text DEFAULT 'production' NOT NULL;
--> statement-breakpoint
CREATE TRIGGER generation_job_purpose_insert BEFORE INSERT ON generation_jobs
WHEN NEW.purpose NOT IN ('production','workflow_test') OR NEW.state='test_completed'
BEGIN SELECT RAISE(ABORT,'generation job purpose or initial state invalid'); END;
--> statement-breakpoint
CREATE TRIGGER generation_test_job_guard BEFORE UPDATE ON generation_jobs
WHEN NEW.purpose<>OLD.purpose OR OLD.state='test_completed'
  OR (NEW.purpose='workflow_test' AND (NEW.take_id IS NOT NULL OR NEW.state='completed'))
  OR (NEW.state='test_completed' AND (OLD.state<>'fetching' OR NEW.purpose<>'workflow_test' OR NOT EXISTS(
    SELECT 1 FROM media_uploads u JOIN media_versions m ON m.id=u.media_version_id
    WHERE u.generation_job_id=NEW.id AND u.state='complete' AND m.id=NEW.media_version_id AND m.origin='workflow_test'
  )))
BEGIN SELECT RAISE(ABORT,'workflow test job result mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER generation_test_media_guard BEFORE INSERT ON media_versions
WHEN (NEW.origin='workflow_test') <> EXISTS(
  SELECT 1 FROM media_uploads u JOIN generation_jobs j ON j.id=u.generation_job_id
  WHERE u.media_version_id=NEW.id AND j.purpose='workflow_test'
) OR EXISTS(SELECT 1 FROM media_versions m WHERE m.asset_id=NEW.asset_id AND m.origin='workflow_test')
BEGIN SELECT RAISE(ABORT,'workflow test media origin or version mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER generation_test_take_guard BEFORE INSERT ON takes
WHEN EXISTS(SELECT 1 FROM media_versions m WHERE m.id=NEW.media_version_id AND m.origin='workflow_test')
BEGIN SELECT RAISE(ABORT,'workflow test media cannot become a take'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_release_immutable_update BEFORE UPDATE ON workflow_release_events
BEGIN SELECT RAISE(ABORT,'workflow release event is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_release_immutable_delete BEFORE DELETE ON workflow_release_events
BEGIN SELECT RAISE(ABORT,'workflow release event is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_release_evidence BEFORE INSERT ON workflow_release_events
WHEN NEW.sequence<>coalesce((SELECT max(e.sequence) FROM workflow_release_events e WHERE e.family_id=NEW.family_id),0)+1
  OR NOT EXISTS(
    SELECT 1 FROM workflow_catalog_revisions r
    JOIN workflow_catalogs c ON c.id=r.family_id
    JOIN generation_jobs j ON j.id=NEW.test_job_id AND j.workflow_id=r.workflow_id
    WHERE r.workflow_id=NEW.workflow_id AND r.family_id=NEW.family_id
      AND j.purpose='workflow_test' AND j.state='test_completed' AND j.media_version_id IS NOT NULL
      AND (NEW.action='revoke' OR (c.head_workflow_id=r.workflow_id AND c.archived=0))
  )
  OR (NEW.action='revoke' AND NOT EXISTS(
    SELECT 1 FROM workflow_release_events e
    WHERE e.family_id=NEW.family_id AND e.sequence=NEW.sequence-1 AND e.action='publish'
      AND e.workflow_id=NEW.workflow_id AND e.test_job_id=NEW.test_job_id
  ))
BEGIN SELECT RAISE(ABORT,'workflow release sequence or evidence mismatch'); END;
