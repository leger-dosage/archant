-- Sure's rule prompt settings (Story 32.11): every existing user starts with
-- the prompt on and never dismissed, as Sure's migration defaults.
ALTER TABLE `users` ADD `rule_prompts_disabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `rule_prompt_dismissed_at` integer;