ALTER TABLE `episodes` ADD `next_shot_number` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `style_preset` text DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `style_description` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `next_episode_number` integer DEFAULT 1 NOT NULL;