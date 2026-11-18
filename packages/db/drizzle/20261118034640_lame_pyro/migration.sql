ALTER TABLE `jobs` ADD `nextRun` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `restack` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `kind` text DEFAULT 'feature' NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `trigger` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `gate` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `startSha` text;