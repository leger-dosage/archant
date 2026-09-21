import type { AccountSubtype, AccountType } from "../account-types.ts";

import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { ACCOUNT_TYPE_IDS, ACCOUNT_TYPES } from "../account-types.ts";
import { inList } from "./check.ts";

export const accounts = sqliteTable(
	"accounts",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		type: text("type").$type<AccountType>().notNull(),
		subtype: text("subtype").$type<AccountSubtype>(),
		currency: text("currency").notNull(),
		// Deactivated rather than deleted: hidden from the lists, history kept,
		// reactivable. Left out of its group's total, as in Sure.
		active: integer("active", { mode: "boolean" }).notNull().default(true),
		// Still listed, but left out of its group's total and, with Epic 6, of
		// every report (AD-9).
		excludedFromReports: integer("excluded_from_reports", { mode: "boolean" })
			.notNull()
			.default(false),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		check("accounts_type_check", sql`${table.type} in ${inList(ACCOUNT_TYPE_IDS)}`),
		// One clause per type, so the database refuses a savings credit card as
		// firmly as the API does. `is not null` is spelled out because `null in
		// (...)` is null, and a check constraint lets null through.
		check(
			"accounts_subtype_check",
			sql.join(
				ACCOUNT_TYPE_IDS.map((type) => {
					const subtypes: readonly string[] = ACCOUNT_TYPES[type].subtypes;

					return subtypes.length === 0
						? sql`(${table.type} = ${sql.raw(`'${type}'`)} and ${table.subtype} is null)`
						: sql`(${table.type} = ${sql.raw(`'${type}'`)} and ${table.subtype} is not null and ${table.subtype} in ${inList(subtypes)})`;
				}),
				sql` or `,
			),
		),
	],
);
