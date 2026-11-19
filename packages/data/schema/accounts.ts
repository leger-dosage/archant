import type { AccountOrder } from "../account-orders.ts";
import type { AccountDetails, AccountSubtype, AccountType } from "../account-types.ts";
import type { StoredDashboardLayout } from "../dashboard-sections.ts";
import type { Locale } from "../locales.ts";
import type { SurePeriod } from "../periods.ts";
import type { StoredReportsLayout } from "../reports-sections.ts";
import type { UserRole } from "../user-roles.ts";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { ACCOUNT_ORDERS, DEFAULT_ACCOUNT_ORDER } from "../account-orders.ts";
import { ACCOUNT_TYPE_IDS, ACCOUNT_TYPES, allowsNullSubtype } from "../account-types.ts";
import { LOCALES } from "../locales.ts";
import { DEFAULT_PERIOD, SURE_PERIODS } from "../periods.ts";
import { USER_ROLES } from "../user-roles.ts";
import { bankAccounts } from "./bank-accounts.ts";
import { inList } from "./check.ts";

export const accounts = sqliteTable(
	"accounts",
	{
		id: text("id").primaryKey(),
		ownerId: text("owner_id").references((): AnySQLiteColumn => users.id, { onDelete: "restrict" }),
		name: text("name").notNull(),
		type: text("type").$type<AccountType>().notNull(),
		subtype: text("subtype").$type<AccountSubtype>(),
		currency: text("currency").notNull(),
		// A loan's, a credit card's, a property's or a vehicle's optional details;
		// null for every other type.
		details: text("details", { mode: "json" }).$type<AccountDetails>(),
		// Deactivated rather than deleted: hidden from the lists, history kept,
		// reactivable. Left out of its group's total, as in Sure.
		active: integer("active", { mode: "boolean" }).notNull().default(true),
		// Still listed, but left out of its group's total and, with Epic 6, of
		// every report (AD-9).
		excludedFromReports: integer("excluded_from_reports", { mode: "boolean" })
			.notNull()
			.default(false),
		// The bank account that feeds it, which makes it computed backward from
		// the bank balance (AD-8). Unique: one bank account feeds one account at
		// most, and the reverse. Cleared when its connection goes, so the
		// account and its history outlive the consent.
		bankAccountId: text("bank_account_id").references(() => bankAccounts.id, {
			onDelete: "set null",
		}),
		// Sure's `institution_name`, `institution_domain` and `notes`, typed in
		// « Détails supplémentaires »; null when blank. A linked account without
		// a name shows its bank's.
		institutionName: text("institution_name"),
		institutionDomain: text("institution_domain"),
		notes: text("notes"),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		index("accounts_owner").on(table.ownerId),
		uniqueIndex("accounts_bank_account_unique").on(table.bankAccountId),
		check("accounts_type_check", sql`${table.type} in ${inList(ACCOUNT_TYPE_IDS)}`),
		// One clause per type, so the database refuses a savings credit card as
		// firmly as the API does. `is not null` is spelled out because `null in
		// (...)` is null, and a check constraint lets null through. A type whose
		// subtype is optional, as Sure's depository and investment, says `is
		// null or` instead.
		check(
			"accounts_subtype_check",
			sql.join(
				ACCOUNT_TYPE_IDS.map((type) => {
					const subtypes: readonly string[] = ACCOUNT_TYPES[type].subtypes;

					if (subtypes.length === 0) {
						return sql`(${table.type} = ${sql.raw(`'${type}'`)} and ${table.subtype} is null)`;
					}

					return allowsNullSubtype(type)
						? sql`(${table.type} = ${sql.raw(`'${type}'`)} and (${table.subtype} is null or ${table.subtype} in ${inList(subtypes)}))`
						: sql`(${table.type} = ${sql.raw(`'${type}'`)} and ${table.subtype} is not null and ${table.subtype} in ${inList(subtypes)})`;
				}),
				sql` or `,
			),
		),
	],
);
// The user and account tables reference each other through ownership and the default account.
const createdAt = () =>
	integer("created_at", { mode: "timestamp_ms" })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.notNull();

const updatedAt = () =>
	integer("updated_at", { mode: "timestamp_ms" })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.$onUpdate(() => new Date())
		.notNull();

export const users = sqliteTable(
	"users",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		email: text("email").notNull().unique(),
		emailVerified: integer("email_verified", { mode: "boolean" }).default(false).notNull(),
		image: text("image"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		// The admin plugin declares it `input: false`, so Better Auth's own
		// update endpoint refuses it: nobody promotes themselves through it.
		role: text("role").$type<UserRole>().notNull(),
		banned: integer("banned", { mode: "boolean" }).default(false),
		banReason: text("ban_reason"),
		banExpires: integer("ban_expires", { mode: "timestamp_ms" }),
		// The `twoFactor` plugin's, `input: false`: only its own endpoints, after
		// a valid code or the password, turn it on or off.
		twoFactorEnabled: integer("two_factor_enabled", { mode: "boolean" }).default(false),
		// Sure's `users.default_account_id`: the account a new transaction
		// starts on, per user. Deleting the account clears it, as Sure's
		// `on_delete: :nullify`; deactivating or linking it keeps it, and the
		// form ignores it while the account is not eligible.
		defaultAccountId: text("default_account_id").references((): AnySQLiteColumn => accounts.id, {
			onDelete: "set null",
		}),
		// Sure's `users.default_account_order`: how this user's account lists
		// are sorted. Existing users read the name order they had before.
		defaultAccountOrder: text("default_account_order")
			.$type<AccountOrder>()
			.notNull()
			.default(DEFAULT_ACCOUNT_ORDER),
		// Sure's `users.default_period`: the chart period the dashboard and the
		// account pages open on when the address names none, saved by an
		// administrator's pick. Existing users read Sure's default.
		defaultPeriod: text("default_period").$type<SurePeriod>().notNull().default(DEFAULT_PERIOD),
		// Sure's `users.locale`. Null follows the browser's language, so a user
		// who never chose reads the language they travel with.
		locale: text("locale").$type<Locale>(),
		// Sure's `preferences.show_split_grouped`: whether this user's
		// transaction lists show a split's lines under their parent. Absent in
		// Sure means on, so every existing user keeps the grouping.
		showSplitGrouped: integer("show_split_grouped", { mode: "boolean" }).notNull().default(true),
		// Sure's `users.rule_prompts_disabled` and `rule_prompt_dismissed_at`:
		// whether the rule prompt after a hand categorisation is turned off for
		// good, and when it was last hidden for the day.
		rulePromptsDisabled: integer("rule_prompts_disabled", { mode: "boolean" })
			.notNull()
			.default(false),
		rulePromptDismissedAt: integer("rule_prompt_dismissed_at", { mode: "timestamp_ms" }),
		// Sure's dashboard keys of `users.preferences`: this user's widget order,
		// collapsed and hidden widgets and sizes. Null is Sure's default layout;
		// a key the code no longer knows is dropped on read, so a widget removed
		// later needs no data migration.
		dashboardLayout: text("dashboard_layout", { mode: "json" }).$type<StoredDashboardLayout>(),
		// Sure's `reports_section_order` and `reports_collapsed_sections`. Null
		// is Sure's default order with nothing collapsed.
		reportsLayout: text("reports_layout", { mode: "json" }).$type<StoredReportsLayout>(),
	},
	(table) => [
		check("users_role_check", sql`${table.role} in ${inList(USER_ROLES)}`),
		check(
			"users_default_account_order_check",
			sql`${table.defaultAccountOrder} in ${inList(ACCOUNT_ORDERS)}`,
		),
		check("users_default_period_check", sql`${table.defaultPeriod} in ${inList(SURE_PERIODS)}`),
		check(
			"users_locale_check",
			sql`${table.locale} is null or ${table.locale} in ${inList(LOCALES)}`,
		),
	],
);
