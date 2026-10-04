CREATE TABLE `securities` (
	`id` text PRIMARY KEY NOT NULL,
	`isin` text,
	`ticker` text,
	`mic` text,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`provider` text,
	`offline` integer DEFAULT false NOT NULL,
	`failed_fetch_count` integer DEFAULT 0 NOT NULL,
	`first_price_on` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "securities_provider_check" CHECK("securities"."provider" in ('yahoo')),
	CONSTRAINT "securities_failed_fetch_count_check" CHECK("securities"."failed_fetch_count" >= 0)
);
--> statement-breakpoint
-- Edited by hand: drizzle-kit splits an index expression at its commas, which
-- turned `coalesce("mic", '')` into two quoted names.
CREATE UNIQUE INDEX `securities_ticker_mic_unique` ON `securities` (upper("ticker"),coalesce("mic", ''));--> statement-breakpoint
CREATE TABLE `security_prices` (
	`security_id` text NOT NULL,
	`date` text NOT NULL,
	`price` integer NOT NULL,
	`currency` text NOT NULL,
	`provisional` integer DEFAULT false NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`security_id`, `date`),
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "security_prices_price_check" CHECK("security_prices"."price" > 0),
	CONSTRAINT "security_prices_source_check" CHECK("security_prices"."source" in ('provider', 'manual'))
);
