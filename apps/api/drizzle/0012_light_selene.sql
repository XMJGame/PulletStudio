CREATE TABLE `proposal_adoptions` (
	`proposal_id` text NOT NULL,
	`candidate_index` integer NOT NULL,
	`proposal_revision_id` text NOT NULL,
	`shot_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	PRIMARY KEY(`proposal_id`, `candidate_index`),
	FOREIGN KEY (`proposal_id`,`project_id`,`workspace_id`) REFERENCES `analysis_proposals`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proposal_revision_id`,`project_id`,`workspace_id`) REFERENCES `proposal_revisions`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shot_id`,`project_id`,`workspace_id`) REFERENCES `shots`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proposal_adoptions_shot_id_unique` ON `proposal_adoptions` (`shot_id`);--> statement-breakpoint
CREATE TABLE `proposal_reviews` (
	`proposal_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`state` text NOT NULL,
	`version` integer NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`proposal_id`,`project_id`,`workspace_id`) REFERENCES `analysis_proposals`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "proposal_review_version" CHECK("proposal_reviews"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE `proposal_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`proposal_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`version` integer NOT NULL,
	`action` text NOT NULL,
	`body_json` text NOT NULL,
	`summary` text NOT NULL,
	`decision_json` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proposal_id`,`project_id`,`workspace_id`) REFERENCES `analysis_proposals`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proposal_revisions_version` ON `proposal_revisions` (`proposal_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `proposal_revisions_scope` ON `proposal_revisions` (`id`,`project_id`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `script_spans` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`start_offset` integer NOT NULL,
	`end_offset` integer NOT NULL,
	`text_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`revision_id`,`project_id`,`workspace_id`) REFERENCES `script_revisions`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "script_span_offsets" CHECK("script_spans"."start_offset" >= 0 AND "script_spans"."end_offset" > "script_spans"."start_offset")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `script_spans_scope` ON `script_spans` (`id`,`project_id`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `shot_card_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`shot_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`version` integer NOT NULL,
	`body_json` text NOT NULL,
	`source_proposal_revision_id` text NOT NULL,
	`created_by` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shot_id`,`project_id`,`workspace_id`) REFERENCES `shots`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_proposal_revision_id`,`project_id`,`workspace_id`) REFERENCES `proposal_revisions`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shot_card_version` ON `shot_card_revisions` (`shot_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `shot_card_scope` ON `shot_card_revisions` (`id`,`project_id`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `shot_script_spans` (
	`card_revision_id` text NOT NULL,
	`span_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	PRIMARY KEY(`card_revision_id`, `span_id`),
	FOREIGN KEY (`card_revision_id`,`project_id`,`workspace_id`) REFERENCES `shot_card_revisions`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`span_id`,`project_id`,`workspace_id`) REFERENCES `script_spans`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analysis_proposals_scope` ON `analysis_proposals` (`id`,`project_id`,`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `script_revisions_scope` ON `script_revisions` (`id`,`project_id`,`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `shots_scope` ON `shots` (`id`,`project_id`,`workspace_id`);