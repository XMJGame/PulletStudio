CREATE TABLE `board_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`schema_version` text NOT NULL,
	`layout_json` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`request_key` text NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`board_id`,`project_id`,`workspace_id`) REFERENCES `boards`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "board_revision_limits" CHECK("board_revisions"."version">0 AND "board_revisions"."schema_version"='studio.board.v1' AND length(CAST("board_revisions"."layout_json" AS BLOB))<=262144 AND json_valid("board_revisions"."layout_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `board_revision_version` ON `board_revisions` (`board_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `board_revision_request` ON `board_revisions` (`board_id`,`created_by`,`request_key`);--> statement-breakpoint
CREATE TABLE `boards` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`unit_id` text,
	`title` text NOT NULL,
	`version` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`creation_key` text NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`,`project_id`,`workspace_id`) REFERENCES `episodes`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "board_version" CHECK("boards"."version">=0),
	CONSTRAINT "board_title" CHECK(length("boards"."title") BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `board_scope` ON `boards` (`id`,`project_id`,`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `board_create_key` ON `boards` (`project_id`,`created_by`,`creation_key`);--> statement-breakpoint
CREATE INDEX `board_project_page` ON `boards` (`project_id`,`created_at`,`id`);