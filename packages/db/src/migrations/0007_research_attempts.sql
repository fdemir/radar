CREATE TABLE `research_attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`operation` text NOT NULL,
	`service` text NOT NULL,
	`target` text NOT NULL,
	`attempt` integer NOT NULL,
	`started` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`status` integer,
	`source_status` integer,
	`code` text,
	`error` text,
	`retry_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `research_attempt_run_idx` ON `research_attempt` (`run_id`,`started`);