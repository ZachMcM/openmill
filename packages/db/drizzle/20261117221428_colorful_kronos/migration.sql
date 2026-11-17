CREATE TABLE `pr_observations` (
	`jobKey` integer PRIMARY KEY,
	`prUrl` text NOT NULL,
	`polledAt` integer NOT NULL,
	`state` text NOT NULL,
	`headSha` text NOT NULL,
	`checks` text NOT NULL,
	`unresolvedThreads` text NOT NULL,
	`latestReviewId` text,
	`readyNotifiedSha` text,
	CONSTRAINT `fk_pr_observations_jobKey_jobs_key_fk` FOREIGN KEY (`jobKey`) REFERENCES `jobs`(`key`) ON DELETE CASCADE
);
