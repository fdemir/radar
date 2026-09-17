CREATE TABLE `discord_authorization` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discord_authorization_user_id_unique` ON `discord_authorization` (`user_id`);--> statement-breakpoint
CREATE TABLE `discord_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`discord_user_id` text NOT NULL,
	`username` text NOT NULL,
	`channel_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discord_connection_user_id_unique` ON `discord_connection` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `discord_connection_discord_user_id_unique` ON `discord_connection` (`discord_user_id`);--> statement-breakpoint
CREATE TABLE `discord_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`run_id` text,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt` integer NOT NULL,
	`message_id` text,
	`sent_at` integer,
	`read` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `discord_connection`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discord_delivery_run_idx` ON `discord_delivery` (`run_id`,`connection_id`);--> statement-breakpoint
CREATE INDEX `discord_delivery_due_idx` ON `discord_delivery` (`status`,`next_attempt`);
--> statement-breakpoint
CREATE TRIGGER discord_task_cancel AFTER UPDATE ON task WHEN NEW.revision != OLD.revision OR NEW.status != 'active' BEGIN
  UPDATE discord_delivery SET status = 'cancelled' WHERE run_id IN (SELECT id FROM run WHERE task_id = NEW.id) AND status IN ('pending', 'sending');
END;
--> statement-breakpoint
CREATE TRIGGER discord_connection_cancel AFTER UPDATE ON discord_connection WHEN NEW.enabled = 0 OR NEW.status IN ('blocked', 'failed') BEGIN
  UPDATE discord_delivery SET status = 'cancelled' WHERE connection_id = NEW.id AND kind = 'findings' AND status IN ('pending', 'sending');
END;
