ALTER TABLE `jobs` RENAME COLUMN `harness` TO `agent`;--> statement-breakpoint
ALTER TABLE `runs` RENAME COLUMN `harness` TO `agent`;--> statement-breakpoint
ALTER TABLE `runs` ADD `blockId` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `transcriptPath` text;--> statement-breakpoint
ALTER TABLE `runs` DROP COLUMN `recovery`;