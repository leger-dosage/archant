CREATE TABLE `cost_basis_locks` (
	`account_id` text NOT NULL,
	`security_id` text NOT NULL,
	`cost_basis` integer NOT NULL,
	`locked_on` text NOT NULL,
	PRIMARY KEY(`account_id`, `security_id`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`security_id`) REFERENCES `securities`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "cost_basis_locks_cost_basis_check" CHECK("cost_basis_locks"."cost_basis" >= 0)
);
