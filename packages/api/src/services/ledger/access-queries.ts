import type { ServiceDeps } from "../deps.ts";
import type { SQL } from "drizzle-orm";

import { and, eq } from "drizzle-orm";

import { entries } from "@archant/data/schema/entries";
import type { securities } from "@archant/data/schema/securities";
import { trades } from "@archant/data/schema/trades";
import { transfers } from "@archant/data/schema/transfers";

type Reader = Pick<ServiceDeps["db"], "select">;

export const entryAccountColumn = entries.accountId;

export function entryAccount(db: Reader, id: string) {
	return db.select({ accountId: entries.accountId }).from(entries).where(eq(entries.id, id)).get();
}

export function scopedEntryIds(db: Reader, scope: SQL | undefined) {
	return db.select({ id: entries.id }).from(entries).where(scope);
}

export function transferEntries(db: Reader, id: string) {
	return db
		.select({ incoming: transfers.inflowTransactionId, outgoing: transfers.outflowTransactionId })
		.from(transfers)
		.where(eq(transfers.id, id))
		.get();
}

export function securityTrades(db: Reader, securityId: string | typeof securities.id, scope?: SQL) {
	return db
		.select({ id: entries.id })
		.from(trades)
		.innerJoin(entries, eq(entries.id, trades.entryId))
		.where(and(eq(trades.securityId, securityId), scope));
}
