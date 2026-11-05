CREATE TABLE `analysis_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`body_json` text NOT NULL,
	`schema_version` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`,`project_id`,`workspace_id`) REFERENCES `analysis_runs`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analysis_proposals_run_id_unique` ON `analysis_proposals` (`run_id`);--> statement-breakpoint
CREATE TABLE `analysis_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`model_profile_id` text NOT NULL,
	`created_by` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`input_json` text NOT NULL,
	`connection_snapshot_json` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`next_run_at` integer DEFAULT 0 NOT NULL,
	`lease_owner` text,
	`lease_until` integer,
	`provider_task_id` text,
	`error_code` text,
	`error_message` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `script_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`model_profile_id`,`workspace_id`) REFERENCES `text_model_profiles`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analysis_idempotency` ON `analysis_runs` (`project_id`,`created_by`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `analysis_queue` ON `analysis_runs` (`state`,`next_run_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `analysis_project_page` ON `analysis_runs` (`project_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `analysis_run_scope` ON `analysis_runs` (`id`,`project_id`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `text_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`provider_type` text DEFAULT 'openai_compatible' NOT NULL,
	`base_url` text NOT NULL,
	`trusted_private` integer DEFAULT false NOT NULL,
	`encrypted_secret` text,
	`enabled` integer DEFAULT true NOT NULL,
	`approved_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `text_connections_scope` ON `text_connections` (`id`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `text_model_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`model` text NOT NULL,
	`output_mode` text NOT NULL,
	`token_parameter` text DEFAULT 'max_tokens' NOT NULL,
	`max_output_tokens` integer DEFAULT 4096 NOT NULL,
	`timeout_seconds` integer DEFAULT 120 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`connection_id`,`workspace_id`) REFERENCES `text_connections`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `text_models_scope` ON `text_model_profiles` (`id`,`workspace_id`);