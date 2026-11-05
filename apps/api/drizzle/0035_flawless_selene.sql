CREATE TABLE `workflow_catalog_revisions` (
	`workflow_id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`revision` integer NOT NULL,
	`summary` text NOT NULL,
	`restored_from_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`request_key` text,
	`request_hash` text,
	FOREIGN KEY (`restored_from_id`) REFERENCES `generation_workflows`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workflow_id`,`project_id`,`workspace_id`) REFERENCES `generation_workflows`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`family_id`,`project_id`,`workspace_id`) REFERENCES `workflow_catalogs`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workflow_revision_positive" CHECK("workflow_catalog_revisions"."revision">0 AND length("workflow_catalog_revisions"."summary")<=1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_catalog_revision` ON `workflow_catalog_revisions` (`family_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_catalog_request` ON `workflow_catalog_revisions` (`project_id`,`created_by`,`request_key`);--> statement-breakpoint
CREATE TABLE `workflow_catalogs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`head_workflow_id` text,
	`revision` integer NOT NULL,
	`version` integer NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `projects`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`head_workflow_id`,`project_id`,`workspace_id`) REFERENCES `generation_workflows`(`id`,`project_id`,`workspace_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "workflow_catalog_versions" CHECK("workflow_catalogs"."revision">=0 AND "workflow_catalogs"."version">=0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_catalog_scope` ON `workflow_catalogs` (`id`,`project_id`,`workspace_id`);
--> statement-breakpoint
CREATE TRIGGER workflow_catalog_initial BEFORE INSERT ON workflow_catalogs WHEN NEW.revision<>0 OR NEW.version<>0 OR NEW.head_workflow_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'workflow catalog must start empty'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_catalog_no_delete BEFORE DELETE ON workflow_catalogs BEGIN SELECT RAISE(ABORT,'workflow catalog retains history'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_catalog_revision_no_update BEFORE UPDATE ON workflow_catalog_revisions BEGIN SELECT RAISE(ABORT,'workflow revision is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_catalog_revision_no_delete BEFORE DELETE ON workflow_catalog_revisions BEGIN SELECT RAISE(ABORT,'workflow revision is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_catalog_append BEFORE INSERT ON workflow_catalog_revisions WHEN NOT EXISTS (SELECT 1 FROM workflow_catalogs c WHERE c.id=NEW.family_id AND c.project_id=NEW.project_id AND c.workspace_id=NEW.workspace_id AND NEW.revision=c.revision+1) OR (NEW.restored_from_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM workflow_catalog_revisions r WHERE r.workflow_id=NEW.restored_from_id AND r.family_id=NEW.family_id)) BEGIN SELECT RAISE(ABORT,'workflow revision sequence or source invalid'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_catalog_head BEFORE UPDATE ON workflow_catalogs WHEN NEW.id<>OLD.id OR NEW.project_id<>OLD.project_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.version<>OLD.version+1 OR NOT ((NEW.head_workflow_id IS OLD.head_workflow_id AND NEW.revision=OLD.revision) OR (NEW.revision=OLD.revision+1 AND EXISTS (SELECT 1 FROM workflow_catalog_revisions r WHERE r.family_id=NEW.id AND r.workflow_id=NEW.head_workflow_id AND r.revision=NEW.revision))) BEGIN SELECT RAISE(ABORT,'workflow head must follow history'); END;
--> statement-breakpoint
INSERT INTO workflow_catalogs (id,project_id,workspace_id,head_workflow_id,revision,version,archived,updated_at) SELECT id,project_id,workspace_id,NULL,0,0,0,created_at FROM generation_workflows;
--> statement-breakpoint
INSERT INTO workflow_catalog_revisions (workflow_id,family_id,project_id,workspace_id,revision,summary,restored_from_id,created_by,created_at,request_key,request_hash) SELECT id,id,project_id,workspace_id,1,'兼容既有不可变配置',NULL,created_by,created_at,NULL,NULL FROM generation_workflows;
--> statement-breakpoint
UPDATE workflow_catalogs SET head_workflow_id=id,revision=1,version=1;
