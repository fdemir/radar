CREATE TABLE `webhook_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`verified_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_connection_user_id_unique` ON `webhook_connection` (`user_id`);--> statement-breakpoint
CREATE TABLE `webhook_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`run_id` text,
	`kind` text NOT NULL,
	`payload` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease` text,
	`next_attempt` integer NOT NULL,
	`created_at` integer NOT NULL,
	`sent_at` integer,
	`error` text,
	FOREIGN KEY (`connection_id`) REFERENCES `webhook_connection`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_delivery_run_idx` ON `webhook_delivery` (`run_id`,`connection_id`);--> statement-breakpoint
CREATE INDEX `webhook_delivery_due_idx` ON `webhook_delivery` (`status`,`next_attempt`);
--> statement-breakpoint
CREATE TRIGGER webhook_task_cancel AFTER UPDATE ON task WHEN NEW.revision != OLD.revision OR NEW.status != 'active' BEGIN
  UPDATE webhook_delivery SET status = 'cancelled', lease = NULL WHERE run_id IN (SELECT id FROM run WHERE task_id = NEW.id) AND status IN ('pending', 'sending');
END;
--> statement-breakpoint
CREATE TRIGGER webhook_connection_cancel AFTER UPDATE ON webhook_connection WHEN NEW.enabled = 0 BEGIN
  UPDATE webhook_delivery SET status = 'cancelled', lease = NULL WHERE connection_id = NEW.id AND kind = 'findings' AND status IN ('pending', 'sending');
END;
