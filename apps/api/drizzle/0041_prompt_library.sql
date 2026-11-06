CREATE TABLE `prompt_library_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`version` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "prompt_library_version" CHECK("prompt_library_entries"."version">=1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prompt_library_scope` ON `prompt_library_entries` (`id`,`project_id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `prompt_library_page` ON `prompt_library_entries` (`project_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `prompt_library_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`positive_prompt` text NOT NULL,
	`negative_prompt` text NOT NULL,
	`tags_json` text NOT NULL,
	`source` text NOT NULL,
	`workflow_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`request_key` text NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entry_id`,`project_id`,`workspace_id`) REFERENCES `prompt_library_entries`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workflow_id`,`project_id`,`workspace_id`) REFERENCES `generation_workflows`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "prompt_library_text" CHECK("prompt_library_revisions"."version">=1 AND length("prompt_library_revisions"."title") BETWEEN 1 AND 200 AND length("prompt_library_revisions"."positive_prompt") BETWEEN 1 AND 16000 AND length("prompt_library_revisions"."negative_prompt")<=16000 AND length("prompt_library_revisions"."source")<=300 AND json_valid("prompt_library_revisions"."tags_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prompt_library_revision` ON `prompt_library_revisions` (`entry_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `prompt_library_request` ON `prompt_library_revisions` (`project_id`,`created_by`,`request_key`);
--> statement-breakpoint
CREATE TRIGGER prompt_library_revision_no_update BEFORE UPDATE ON prompt_library_revisions BEGIN SELECT RAISE(ABORT,'prompt library revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER prompt_library_revision_no_delete BEFORE DELETE ON prompt_library_revisions BEGIN SELECT RAISE(ABORT,'prompt library revisions retain history'); END;
--> statement-breakpoint
CREATE TRIGGER prompt_library_entry_no_delete BEFORE DELETE ON prompt_library_entries BEGIN SELECT RAISE(ABORT,'prompt library entries retain history'); END;
--> statement-breakpoint
CREATE TRIGGER prompt_library_initial BEFORE INSERT ON prompt_library_entries WHEN NEW.version<>1 BEGIN SELECT RAISE(ABORT,'prompt library must start at version one'); END;
--> statement-breakpoint
CREATE TRIGGER prompt_library_append BEFORE INSERT ON prompt_library_revisions
WHEN NEW.version<>(SELECT coalesce(max(version),0)+1 FROM prompt_library_revisions WHERE entry_id=NEW.entry_id)
 OR NOT EXISTS(SELECT 1 FROM prompt_library_entries e WHERE e.id=NEW.entry_id AND e.project_id=NEW.project_id AND e.workspace_id=NEW.workspace_id AND (NEW.version=e.version+1 OR (NEW.version=1 AND e.version=1)))
BEGIN SELECT RAISE(ABORT,'prompt library revision scope or sequence mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER prompt_library_head BEFORE UPDATE ON prompt_library_entries
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.workspace_id IS NOT OLD.workspace_id
 OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at OR NEW.version<>OLD.version+1
 OR NOT EXISTS(SELECT 1 FROM prompt_library_revisions r WHERE r.entry_id=NEW.id AND r.version=NEW.version)
BEGIN SELECT RAISE(ABORT,'prompt library head transition mismatch'); END;
