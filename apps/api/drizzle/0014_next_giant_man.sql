CREATE TABLE `prompt_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`shot_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`card_id` text NOT NULL,
	`card_version` integer NOT NULL,
	`project_version` integer NOT NULL,
	`profile_revision_id` text,
	`compiler_version` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`rendered_json` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shot_id`,`project_id`,`workspace_id`) REFERENCES `shots`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`profile_revision_id`,`project_id`,`workspace_id`) REFERENCES `prompt_profiles`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `prompt_artifact_page` ON `prompt_artifacts` (`shot_id`,`id`);--> statement-breakpoint
CREATE TABLE `prompt_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`version` integer NOT NULL,
	`name` text NOT NULL,
	`config_json` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "prompt_profile_positive" CHECK("prompt_profiles"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prompt_profile_version` ON `prompt_profiles` (`profile_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `prompt_profile_scope` ON `prompt_profiles` (`id`,`project_id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `prompt_profile_project` ON `prompt_profiles` (`project_id`,`profile_id`,`version`);--> statement-breakpoint
CREATE TABLE `shot_card_editions` (
	`id` text PRIMARY KEY NOT NULL,
	`shot_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`version` integer NOT NULL,
	`body_json` text NOT NULL,
	`source_proposal_revision_id` text,
	`created_by` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shot_id`,`project_id`,`workspace_id`) REFERENCES `shots`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_proposal_revision_id`,`project_id`,`workspace_id`) REFERENCES `proposal_revisions`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "shot_card_edition_positive" CHECK("shot_card_editions"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shot_card_edition_version` ON `shot_card_editions` (`shot_id`,`version`);