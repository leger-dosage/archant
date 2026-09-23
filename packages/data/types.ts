import type { accounts } from "./schema/accounts.ts";
import type { sessions, users } from "./schema/auth.ts";
import type { balances } from "./schema/balances.ts";
import type { categories } from "./schema/categories.ts";
import type { entries } from "./schema/entries.ts";
import type { entryKeys } from "./schema/entry-keys.ts";
import type { importMappings } from "./schema/import-mappings.ts";
import type { imports } from "./schema/imports.ts";
import type { merchants } from "./schema/merchants.ts";
import type { transactions } from "./schema/transactions.ts";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

export type Account = InferSelectModel<typeof accounts>;
export type NewAccount = InferInsertModel<typeof accounts>;

export type Entry = InferSelectModel<typeof entries>;
export type NewEntry = InferInsertModel<typeof entries>;

export type Transaction = InferSelectModel<typeof transactions>;
export type NewTransaction = InferInsertModel<typeof transactions>;

export type Balance = InferSelectModel<typeof balances>;
export type NewBalance = InferInsertModel<typeof balances>;

export type EntryKey = InferSelectModel<typeof entryKeys>;
export type NewEntryKey = InferInsertModel<typeof entryKeys>;

export type Import = InferSelectModel<typeof imports>;
export type NewImport = InferInsertModel<typeof imports>;

export type ImportMapping = InferSelectModel<typeof importMappings>;
export type NewImportMapping = InferInsertModel<typeof importMappings>;

export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;

export type Session = InferSelectModel<typeof sessions>;
export type NewSession = InferInsertModel<typeof sessions>;

export type Category = InferSelectModel<typeof categories>;
export type NewCategory = InferInsertModel<typeof categories>;

export type Merchant = InferSelectModel<typeof merchants>;
export type NewMerchant = InferInsertModel<typeof merchants>;
