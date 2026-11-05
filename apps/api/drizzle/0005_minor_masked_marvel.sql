ALTER TABLE `projects` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `deleted_by` text REFERENCES users(id);