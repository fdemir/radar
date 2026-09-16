CREATE TABLE `delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`task_id` text NOT NULL,
	`target` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt` integer NOT NULL,
	`sent_at` integer,
	`read` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_run_target_idx` ON `delivery` (`run_id`,`target`);--> statement-breakpoint
CREATE INDEX `delivery_due_idx` ON `delivery` (`status`,`next_attempt`);--> statement-breakpoint
CREATE TABLE `finding` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`run_id` text NOT NULL,
	`event_key` text NOT NULL,
	`version` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`reason` text NOT NULL,
	`url` text NOT NULL,
	`source` text NOT NULL,
	`date` text NOT NULL,
	`read` integer DEFAULT false NOT NULL,
	`saved` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finding_event_idx` ON `finding` (`task_id`,`event_key`,`version`);--> statement-breakpoint
CREATE INDEX `finding_task_idx` ON `finding` (`task_id`);--> statement-breakpoint
CREATE TABLE `run` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`user_id` text NOT NULL,
	`revision` integer NOT NULL,
	`started` integer NOT NULL,
	`finished` integer,
	`stage` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`outcome` text DEFAULT 'unchanged' NOT NULL,
	`summary` text DEFAULT 'Queued' NOT NULL,
	`findings` integer DEFAULT 0 NOT NULL,
	`sources` text DEFAULT '[]' NOT NULL,
	`lease` text,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_one_active_idx` ON `run` (`task_id`) WHERE status = 'running';--> statement-breakpoint
CREATE INDEX `run_user_idx` ON `run` (`user_id`,`started`);--> statement-breakpoint
CREATE INDEX `run_task_idx` ON `run` (`task_id`,`started`);--> statement-breakpoint
CREATE TABLE `usage` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`checks` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `day`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TRIGGER run_validate BEFORE INSERT ON run BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM task WHERE id = NEW.task_id AND user_id = NEW.user_id AND status = 'active') THEN RAISE(ABORT, 'task_not_active') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM task WHERE id = NEW.task_id AND revision = NEW.revision) THEN RAISE(ABORT, 'task_changed') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM usage WHERE user_id = NEW.user_id AND day = strftime('%Y-%m-%d', NEW.started / 1000, 'unixepoch') AND checks >= 30) THEN RAISE(ABORT, 'daily_run_limit') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM run WHERE task_id = NEW.task_id AND started > NEW.started - 10000) THEN RAISE(ABORT, 'run_cooldown') END;
END;
--> statement-breakpoint
CREATE TRIGGER run_usage AFTER INSERT ON run BEGIN
  INSERT INTO usage (user_id, day, checks) VALUES (NEW.user_id, strftime('%Y-%m-%d', NEW.started / 1000, 'unixepoch'), 1)
  ON CONFLICT(user_id, day) DO UPDATE SET checks = checks + 1;
END;
--> statement-breakpoint
CREATE TRIGGER task_cancel_runs AFTER UPDATE ON task WHEN NEW.revision != OLD.revision OR NEW.status != 'active' BEGIN
  UPDATE run SET status = 'cancelled', finished = cast(unixepoch('subsecond') * 1000 as integer), summary = 'Task changed.' WHERE task_id = NEW.id AND status = 'running';
  UPDATE delivery SET status = 'cancelled' WHERE task_id = NEW.id AND status IN ('pending', 'sending');
END;
--> statement-breakpoint
CREATE TRIGGER run_failure AFTER UPDATE OF status ON run WHEN OLD.status = 'running' AND NEW.status = 'failed' BEGIN
  UPDATE task SET failures = failures + 1 WHERE id = NEW.task_id AND revision = NEW.revision;
  UPDATE task SET status = 'paused', next_run_at = NULL WHERE id = NEW.task_id AND failures >= 3;
END;
--> statement-breakpoint
CREATE TRIGGER run_success AFTER UPDATE OF status ON run WHEN OLD.status = 'running' AND NEW.status = 'completed' BEGIN
  UPDATE task SET failures = 0 WHERE id = NEW.task_id AND revision = NEW.revision;
END;
--> statement-breakpoint
CREATE TRIGGER preferences_cancel_delivery AFTER UPDATE ON preference WHEN NEW.email_enabled = 0 BEGIN
  UPDATE delivery SET status = 'cancelled' WHERE task_id IN (SELECT id FROM task WHERE user_id = NEW.user_id) AND status IN ('pending', 'sending');
END;
