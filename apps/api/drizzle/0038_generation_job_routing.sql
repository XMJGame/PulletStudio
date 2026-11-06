CREATE TABLE `generation_job_routes` (
	`job_id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`instance_name` text NOT NULL,
	`mode` text NOT NULL,
	`pool_version` integer NOT NULL,
	`checked_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `generation_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connection_id`,`workspace_id`) REFERENCES `generation_connections`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "generation_job_route_mode" CHECK("generation_job_routes"."mode" IN ('auto','manual'))
);
--> statement-breakpoint
CREATE INDEX `generation_job_route_instance` ON `generation_job_routes` (`connection_id`);
--> statement-breakpoint
CREATE TRIGGER generation_job_route_scope BEFORE INSERT ON generation_job_routes
WHEN NOT EXISTS(
 SELECT 1 FROM generation_jobs j
 JOIN generation_connections c ON c.id=NEW.connection_id AND c.workspace_id=NEW.workspace_id
 JOIN generation_instance_checks k ON k.connection_id=c.id AND k.workflow_id=j.workflow_id
 WHERE j.id=NEW.job_id AND j.workspace_id=NEW.workspace_id AND j.purpose='production'
   AND j.state='queued' AND j.lease_id IS NULL AND c.enabled=1 AND c.pool_enabled=1
   AND c.version=j.connection_version AND c.pool_version=NEW.pool_version
   AND k.connection_version=c.version AND k.pool_version=c.pool_version
   AND k.checked_at=NEW.checked_at AND k.reachable=1 AND k.status='compatible'
)
BEGIN SELECT RAISE(ABORT,'generation job route scope or evidence mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER generation_job_route_no_update BEFORE UPDATE ON generation_job_routes
BEGIN SELECT RAISE(ABORT,'generation job route is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER generation_job_route_no_delete BEFORE DELETE ON generation_job_routes
BEGIN SELECT RAISE(ABORT,'generation job route is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER generation_job_route_worker_guard BEFORE UPDATE OF lease_id ON generation_jobs
WHEN NEW.lease_id IS NOT NULL AND NEW.lease_id NOT LIKE 'pool:%'
 AND EXISTS(SELECT 1 FROM generation_job_routes r WHERE r.job_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'instance routing requires updated generation worker'); END;
