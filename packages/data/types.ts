import type { accounts } from "./schema/accounts.ts";
import type { balances } from "./schema/balances.ts";
import type { entries } from "./schema/entries.ts";
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
