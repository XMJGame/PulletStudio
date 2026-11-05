CREATE TABLE `shot_take_selections` (
	`id` text PRIMARY KEY NOT NULL,
	`shot_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`version` integer NOT NULL,
	`take_id` text,
	`approval_id` text,
	`reason` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	`request_key` text NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shot_id`,`project_id`,`workspace_id`) REFERENCES `shots`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approval_id`,`take_id`,`shot_id`,`project_id`,`workspace_id`) REFERENCES `take_review_events`(`id`,`take_id`,`shot_id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "shot_selection_pair" CHECK(("shot_take_selections"."take_id" IS NULL AND "shot_take_selections"."approval_id" IS NULL) OR ("shot_take_selections"."take_id" IS NOT NULL AND "shot_take_selections"."approval_id" IS NOT NULL)),
	CONSTRAINT "shot_selection_version_positive" CHECK("shot_take_selections"."version">0),
	CONSTRAINT "shot_selection_reason" CHECK(length(trim("shot_take_selections"."reason")) BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shot_selection_version` ON `shot_take_selections` (`shot_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `shot_selection_request` ON `shot_take_selections` (`shot_id`,`actor_id`,`request_key`);--> statement-breakpoint
CREATE TABLE `take_review_events` (
	`id` text PRIMARY KEY NOT NULL,
	`take_id` text NOT NULL,
	`shot_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`media_version_id` text NOT NULL,
	`version` integer NOT NULL,
	`action` text NOT NULL,
	`shot_version` integer NOT NULL,
	`project_version` integer NOT NULL,
	`prompt_id` text,
	`generation_job_id` text,
	`reason` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	`request_key` text NOT NULL,
	FOREIGN KEY (`prompt_id`) REFERENCES `prompt_artifacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`generation_job_id`) REFERENCES `generation_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`take_id`,`shot_id`,`project_id`,`workspace_id`,`media_version_id`) REFERENCES `takes`(`id`,`shot_id`,`project_id`,`workspace_id`,`media_version_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "take_review_action" CHECK("take_review_events"."action" IN ('submit','withdraw','approve','reject','revoke')),
	CONSTRAINT "take_review_version_positive" CHECK("take_review_events"."version">0 AND "take_review_events"."shot_version">0 AND "take_review_events"."project_version">0),
	CONSTRAINT "take_review_reason" CHECK(length(trim("take_review_events"."reason")) BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `take_review_version` ON `take_review_events` (`take_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `take_review_request` ON `take_review_events` (`take_id`,`actor_id`,`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `take_review_selection_scope` ON `take_review_events` (`id`,`take_id`,`shot_id`,`project_id`,`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `take_review_scope` ON `takes` (`id`,`shot_id`,`project_id`,`workspace_id`,`media_version_id`);