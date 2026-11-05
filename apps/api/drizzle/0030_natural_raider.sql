CREATE TABLE `animatic_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`timeline_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`request_key` text NOT NULL,
	`state` text NOT NULL,
	`lease_id` text,
	`lease_until` integer,
	`next_at` integer NOT NULL,
	`media_version_id` text,
	`error_code` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_version_id`) REFERENCES `media_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`timeline_id`,`project_id`,`workspace_id`) REFERENCES `timeline_revisions`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "animatic_completion" CHECK("animatic_jobs"."state"<>'completed' OR "animatic_jobs"."media_version_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `animatic_request` ON `animatic_jobs` (`project_id`,`created_by`,`request_key`);--> statement-breakpoint
CREATE INDEX `animatic_queue` ON `animatic_jobs` (`state`,`next_at`,`lease_until`);--> statement-breakpoint
CREATE INDEX `animatic_history` ON `animatic_jobs` (`timeline_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `timeline_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`version` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`request_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`snapshot_hash` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`duration_ms` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "timeline_limits" CHECK("timeline_revisions"."version">0 AND "timeline_revisions"."duration_ms" BETWEEN 40 AND 300000 AND length(CAST("timeline_revisions"."snapshot_json" AS BLOB))<=4194304)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `timeline_version` ON `timeline_revisions` (`project_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `timeline_request` ON `timeline_revisions` (`project_id`,`created_by`,`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `timeline_scope` ON `timeline_revisions` (`id`,`project_id`,`workspace_id`);--> statement-breakpoint
ALTER TABLE `media_uploads` ADD `animatic_job_id` text;