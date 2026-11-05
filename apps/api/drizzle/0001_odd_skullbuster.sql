CREATE TABLE `script_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`script_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`restored_from_version` integer,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`script_id`,`project_id`,`workspace_id`) REFERENCES `scripts`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "script_revisions_positive_version" CHECK("script_revisions"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `script_revisions_version` ON `script_revisions` (`script_id`,`version`);--> statement-breakpoint
CREATE TABLE `scripts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "scripts_positive_version" CHECK("scripts"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scripts_project_id_unique` ON `scripts` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `scripts_parent` ON `scripts` (`id`,`project_id`,`workspace_id`);