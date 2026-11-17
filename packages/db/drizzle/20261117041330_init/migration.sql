CREATE TABLE `job_dependencies` (
	`jobKey` integer NOT NULL,
	`dependsOnKey` integer NOT NULL,
	CONSTRAINT `job_dependencies_pk` PRIMARY KEY(`jobKey`, `dependsOnKey`),
	CONSTRAINT `fk_job_dependencies_jobKey_jobs_key_fk` FOREIGN KEY (`jobKey`) REFERENCES `jobs`(`key`) ON DELETE CASCADE,
	CONSTRAINT `fk_job_dependencies_dependsOnKey_jobs_key_fk` FOREIGN KEY (`dependsOnKey`) REFERENCES `jobs`(`key`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`key` integer PRIMARY KEY AUTOINCREMENT,
	`id` text NOT NULL,
	`repoPath` text NOT NULL,
	`docPath` text NOT NULL,
	`docSnapshot` text NOT NULL,
	`projectSnapshot` text,
	`baseBranch` text,
	`prBaseBranch` text,
	`requestedBase` text,
	`branchName` text NOT NULL,
	`worktreePath` text NOT NULL,
	`harness` text,
	`model` text,
	`effort` text,
	`state` text DEFAULT 'queued' NOT NULL,
	`blockedReason` text,
	`prUrl` text,
	`sessionId` text,
	`createdAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`jobKey` integer NOT NULL,
	`harness` text NOT NULL,
	`model` text,
	`effort` text NOT NULL,
	`sessionId` text,
	`recovery` integer DEFAULT false NOT NULL,
	`startedAt` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`endedAt` integer,
	`result` text,
	CONSTRAINT `fk_runs_jobKey_jobs_key_fk` FOREIGN KEY (`jobKey`) REFERENCES `jobs`(`key`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `job_dependencies_depends_on` ON `job_dependencies` (`dependsOnKey`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_repo_id` ON `jobs` (`repoPath`,`id`);--> statement-breakpoint
CREATE INDEX `runs_job` ON `runs` (`jobKey`);