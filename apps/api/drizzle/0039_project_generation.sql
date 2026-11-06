-- Preserve historical jobs and inbound references inside the migrator transaction. No rename of referenced tables.
PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
CREATE TEMP TABLE l1_generation_jobs_backup AS SELECT * FROM generation_jobs;
--> statement-breakpoint
DROP TABLE generation_jobs;
--> statement-breakpoint
CREATE TABLE `generation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`purpose` text DEFAULT 'production' NOT NULL,
	`shot_id` text,
	`board_id` text,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`prompt_id` text,
	`shot_version` integer,
	`project_version` integer NOT NULL,
	`connection_version` integer NOT NULL,
	`creator_id` text NOT NULL,
	`request_key` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`state` text NOT NULL,
	`remote_id` text,
	`result_json` text,
	`media_version_id` text,
	`take_id` text,
	`lease_id` text,
	`lease_until` integer,
	`next_at` integer NOT NULL,
	`deadline` integer,
	`error_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`prompt_id`) REFERENCES `prompt_artifacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_version_id`) REFERENCES `media_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`take_id`) REFERENCES `takes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shot_id`,`project_id`,`workspace_id`) REFERENCES `shots`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workflow_id`,`project_id`,`workspace_id`) REFERENCES `generation_workflows`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "generation_job_complete" CHECK("generation_jobs"."state" <> 'completed' OR ("generation_jobs"."media_version_id" IS NOT NULL AND ("generation_jobs"."shot_id" IS NULL OR "generation_jobs"."take_id" IS NOT NULL))),
	CONSTRAINT "generation_context" CHECK(("generation_jobs"."shot_id" IS NOT NULL AND "generation_jobs"."prompt_id" IS NOT NULL AND "generation_jobs"."shot_version" IS NOT NULL AND "generation_jobs"."board_id" IS NULL) OR ("generation_jobs"."shot_id" IS NULL AND "generation_jobs"."prompt_id" IS NULL AND "generation_jobs"."shot_version" IS NULL))
);

--> statement-breakpoint
INSERT INTO generation_jobs (`id`,`purpose`,`shot_id`,`project_id`,`workspace_id`,`workflow_id`,`prompt_id`,`shot_version`,`project_version`,`connection_version`,`creator_id`,`request_key`,`snapshot_json`,`state`,`remote_id`,`result_json`,`media_version_id`,`take_id`,`lease_id`,`lease_until`,`next_at`,`deadline`,`error_code`,`created_at`,`updated_at`) SELECT `id`,`purpose`,`shot_id`,`project_id`,`workspace_id`,`workflow_id`,`prompt_id`,`shot_version`,`project_version`,`connection_version`,`creator_id`,`request_key`,`snapshot_json`,`state`,`remote_id`,`result_json`,`media_version_id`,`take_id`,`lease_id`,`lease_until`,`next_at`,`deadline`,`error_code`,`created_at`,`updated_at` FROM l1_generation_jobs_backup;
--> statement-breakpoint
DROP TABLE l1_generation_jobs_backup;
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_job_request` ON `generation_jobs` (`shot_id`,`creator_id`,`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `generation_project_request` ON `generation_jobs` (`project_id`,`creator_id`,`request_key`) WHERE "generation_jobs"."shot_id" IS NULL;--> statement-breakpoint
CREATE INDEX `generation_job_schedule` ON `generation_jobs` (`state`,`next_at`,`lease_until`);--> statement-breakpoint
CREATE INDEX `generation_job_shot` ON `generation_jobs` (`shot_id`,`created_at`,`id`);--> statement-breakpoint
ALTER TABLE `media_assets` ADD `in_library` integer DEFAULT true NOT NULL;
--> statement-breakpoint
DROP TRIGGER media_asset_identity;
--> statement-breakpoint
CREATE TRIGGER media_asset_identity BEFORE UPDATE ON media_assets
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.workspace_id IS NOT OLD.workspace_id
 OR NEW.name IS NOT OLD.name OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
 OR NOT (
   (NEW.in_library=OLD.in_library AND NEW.version=OLD.version+1)
   OR (OLD.in_library=0 AND NEW.in_library=1 AND NEW.version=OLD.version AND NEW.updated_at=OLD.updated_at
     AND EXISTS(SELECT 1 FROM generation_jobs j JOIN media_versions m ON m.id=j.media_version_id
       WHERE m.asset_id=OLD.id AND j.state='completed' AND j.purpose='production' AND j.shot_id IS NULL))
 )
BEGIN SELECT RAISE(ABORT,'media identity or version transition invalid'); END;
--> statement-breakpoint
CREATE TRIGGER generation_job_input_immutable BEFORE UPDATE ON generation_jobs
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.shot_id IS NOT OLD.shot_id OR NEW.board_id IS NOT OLD.board_id OR NEW.workflow_id IS NOT OLD.workflow_id OR NEW.prompt_id IS NOT OLD.prompt_id OR NEW.shot_version IS NOT OLD.shot_version OR NEW.project_version IS NOT OLD.project_version OR NEW.connection_version IS NOT OLD.connection_version OR NEW.creator_id IS NOT OLD.creator_id OR NEW.request_key IS NOT OLD.request_key OR NEW.snapshot_json IS NOT OLD.snapshot_json OR NEW.created_at IS NOT OLD.created_at OR OLD.state='completed'
BEGIN SELECT RAISE(ABORT,'generation job input is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER generation_job_complete_scope BEFORE UPDATE ON generation_jobs WHEN NEW.state='completed' AND (
  NOT EXISTS(SELECT 1 FROM media_uploads u JOIN media_versions m ON m.id=u.media_version_id WHERE u.generation_job_id=NEW.id AND u.state='complete' AND m.id=NEW.media_version_id AND m.project_id=NEW.project_id AND m.origin='generation')
  OR (NEW.shot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM takes t WHERE t.id=NEW.take_id AND t.shot_id=NEW.shot_id AND t.media_version_id=NEW.media_version_id))
  OR (NEW.shot_id IS NULL AND NEW.take_id IS NOT NULL)
) BEGIN SELECT RAISE(ABORT,'generation output and context mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER generation_project_context BEFORE INSERT ON generation_jobs
WHEN NEW.board_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM boards b WHERE b.id=NEW.board_id AND b.project_id=NEW.project_id AND b.workspace_id=NEW.workspace_id)
BEGIN SELECT RAISE(ABORT,'generation board scope mismatch'); END;
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

--> statement-breakpoint
CREATE TRIGGER generation_job_route_worker_guard BEFORE UPDATE OF lease_id ON generation_jobs
WHEN NEW.lease_id IS NOT NULL AND (
 (EXISTS(SELECT 1 FROM generation_job_routes r WHERE r.job_id=NEW.id) AND NEW.lease_id NOT LIKE 'pool:%')
 OR (NEW.shot_id IS NULL AND NEW.lease_id NOT LIKE 'free:%' AND NEW.lease_id NOT LIKE 'pool:%')
) BEGIN SELECT RAISE(ABORT,'generation context requires updated generation worker'); END;
