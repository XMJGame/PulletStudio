CREATE TABLE `asset_revision_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`version` integer NOT NULL,
	`action` text NOT NULL,
	`reason` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	`request_key` text NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revision_id`,`project_id`,`workspace_id`) REFERENCES `asset_entity_revisions`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "asset_decision_action" CHECK("asset_revision_decisions"."action" IN ('approve', 'revoke')),
	CONSTRAINT "asset_decision_reason" CHECK(length(trim("asset_revision_decisions"."reason")) BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_decision_version` ON `asset_revision_decisions` (`revision_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `asset_decision_request` ON `asset_revision_decisions` (`revision_id`,`actor_id`,`request_key`);