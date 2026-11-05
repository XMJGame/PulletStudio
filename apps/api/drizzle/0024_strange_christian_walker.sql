CREATE TABLE `generation_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`trusted_private` integer NOT NULL,
	`encrypted_secret` text,
	`enabled` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_connection_scope` ON `generation_connections` (`id`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `generation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`shot_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`prompt_id` text NOT NULL,
	`shot_version` integer NOT NULL,
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
	FOREIGN KEY (`prompt_id`) REFERENCES `prompt_artifacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_version_id`) REFERENCES `media_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`take_id`) REFERENCES `takes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shot_id`,`project_id`,`workspace_id`) REFERENCES `shots`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workflow_id`,`project_id`,`workspace_id`) REFERENCES `generation_workflows`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "generation_job_complete" CHECK("generation_jobs"."state" <> 'completed' OR ("generation_jobs"."media_version_id" IS NOT NULL AND "generation_jobs"."take_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_job_request` ON `generation_jobs` (`shot_id`,`creator_id`,`request_key`);--> statement-breakpoint
CREATE INDEX `generation_job_schedule` ON `generation_jobs` (`state`,`next_at`,`lease_until`);--> statement-breakpoint
CREATE INDEX `generation_job_shot` ON `generation_jobs` (`shot_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `generation_workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`name` text NOT NULL,
	`capability` text NOT NULL,
	`definition_json` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connection_id`,`workspace_id`) REFERENCES `generation_connections`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_workflow_scope` ON `generation_workflows` (`id`,`project_id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `generation_workflow_project` ON `generation_workflows` (`project_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `media_uploads` ADD `generation_job_id` text;