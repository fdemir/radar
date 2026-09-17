CREATE TABLE `provider_backoff` (
	`scope` text NOT NULL,
	`service` text NOT NULL,
	`retry_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `service`)
);
--> statement-breakpoint
CREATE TABLE `provider_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`service` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `provider_usage_window_idx` ON `provider_usage` (`scope`,`service`,`created_at`);--> statement-breakpoint
ALTER TABLE `run` ADD `retry_at` integer;--> statement-breakpoint
ALTER TABLE `run` ADD `claimed_at` integer;--> statement-breakpoint
ALTER TABLE `run` ADD `checkpoint` text;
--> statement-breakpoint
CREATE TRIGGER run_clear_checkpoint AFTER UPDATE OF status ON run WHEN NEW.status != 'running' BEGIN
  UPDATE run SET checkpoint = NULL, retry_at = NULL WHERE id = NEW.id;
END;
