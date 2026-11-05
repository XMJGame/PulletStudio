ALTER TABLE `episodes` ADD `unit_type` text DEFAULT 'episode' NOT NULL;--> statement-breakpoint
ALTER TABLE `episodes` ADD `parent_id` text REFERENCES episodes(id);--> statement-breakpoint
ALTER TABLE `episodes` ADD `outline` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `episodes` ADD `target_duration_seconds` integer;--> statement-breakpoint
CREATE INDEX `units_project_parent` ON `episodes` (`project_id`,`parent_id`,`order_index`);--> statement-breakpoint
CREATE UNIQUE INDEX `units_project_root` ON `episodes` (`project_id`) WHERE "episodes"."unit_type" = 'project_root';--> statement-breakpoint
ALTER TABLE `projects` ADD `work_format` text DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `narrative_mode` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `target_duration_seconds` integer;--> statement-breakpoint
ALTER TABLE `projects` ADD `director_notes` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `next_unit_number` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `shots` ADD `technique` text DEFAULT 'unspecified' NOT NULL;