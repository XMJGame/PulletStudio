CREATE TABLE `generation_instance_checks` (
	`workflow_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`connection_version` integer NOT NULL,
	`pool_version` integer NOT NULL,
	`checked_at` integer NOT NULL,
	`reachable` integer NOT NULL,
	`running` integer,
	`pending` integer,
	`status` text NOT NULL,
	`binding` text NOT NULL,
	`report_json` text,
	PRIMARY KEY(`workflow_id`, `connection_id`),
	FOREIGN KEY (`workflow_id`,`project_id`,`workspace_id`) REFERENCES `generation_workflows`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connection_id`,`workspace_id`) REFERENCES `generation_connections`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "generation_instance_check_counts" CHECK(("generation_instance_checks"."running" IS NULL AND "generation_instance_checks"."pending" IS NULL) OR ("generation_instance_checks"."running" IS NOT NULL AND "generation_instance_checks"."pending" IS NOT NULL AND "generation_instance_checks"."running">=0 AND "generation_instance_checks"."pending">=0))
);
--> statement-breakpoint
ALTER TABLE `generation_connections` ADD `pool_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `generation_connections` ADD `pool_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `generation_connections` ADD `max_running` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `generation_connections` ADD `max_pending` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `generation_pool_endpoint` ON `generation_connections` (`workspace_id`,`base_url`) WHERE "generation_connections"."pool_enabled" = 1;