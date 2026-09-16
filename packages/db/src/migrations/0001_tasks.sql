CREATE TABLE `preference` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email_enabled` integer DEFAULT true NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`language` text DEFAULT 'English' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `task` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`brief` text NOT NULL,
	`category` text NOT NULL,
	`status` text NOT NULL,
	`frequency` text NOT NULL,
	`time` text NOT NULL,
	`language` text NOT NULL,
	`email` integer DEFAULT true NOT NULL,
	`messages` text DEFAULT '[]' NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`next_run_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_user_idx` ON `task` (`user_id`);--> statement-breakpoint
CREATE INDEX `task_schedule_idx` ON `task` (`status`,`next_run_at`);--> statement-breakpoint
CREATE TRIGGER task_active_limit_insert BEFORE INSERT ON task
WHEN NEW.status = 'active' AND (SELECT count(*) FROM task WHERE user_id = NEW.user_id AND status = 'active') >= 5
BEGIN SELECT RAISE(ABORT, 'active_task_limit'); END;
--> statement-breakpoint
CREATE TRIGGER task_active_limit_update BEFORE UPDATE OF status ON task
WHEN NEW.status = 'active' AND (SELECT count(*) FROM task WHERE user_id = NEW.user_id AND status = 'active' AND id != NEW.id) >= 5
BEGIN SELECT RAISE(ABORT, 'active_task_limit'); END;
