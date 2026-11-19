import type { ServiceDeps } from "../deps.ts";
import type { DetectionResult } from "./series.ts";

import { recurringTransactions } from "@archant/data/schema/recurring-transactions";

import { today } from "../../domain/dates.ts";
import { limitedEditableAccounts } from "../account-access.ts";
import { recurringProcessingScope } from "./access.ts";
import { backfillOccurrences, generateOccurrences, matchOccurrences } from "./occurrences.ts";
import { detectPriceChanges } from "./price-changes.ts";
import { detectWithin } from "./series.ts";
import { recurringEnabled } from "./switch.ts";

/**
 * Sure's `Pipeline#run!` at `14638a701`, in one immediate transaction:
 * detection, every active series' occurrences, the live match, price
 * changes, then, when asked, six months of history. An import, a revert and
 * a sync run it without the history; « Détecter » with it. No lock, job or
 * debounce: the write transaction serialises two runs.
 */
export async function runRecurring(
	deps: ServiceDeps,
	{ backfill }: { backfill: boolean },
): Promise<DetectionResult> {
	const day = today(deps.timeZone);

	return deps.db.transaction(
		async (tx) => {
			const accountIds = await limitedEditableAccounts({ ...deps, db: tx });
			const result = await detectWithin(tx, day, accountIds);
			const filter = recurringProcessingScope(accountIds);
			const rows =
				filter === undefined
					? undefined
					: await tx
							.select({ id: recurringTransactions.id })
							.from(recurringTransactions)
							.where(filter);
			const ids = rows?.map((row) => row.id);

			await generateOccurrences(tx, day, ids);
			await matchOccurrences(tx, day, { backfill: false, ids, accountIds });
			await detectPriceChanges(tx, day, ids);

			if (backfill) {
				await backfillOccurrences(tx, day, ids, accountIds);
			}

			return result;
		},
		{ behavior: "immediate" },
	);
}

/**
 * The run an import, a revert or a sync starts: nothing while « Activer les
 * transactions récurrentes » is off, as Sure's
 * `IdentifyRecurringTransactionsJob` returns for a family that disabled it.
 */
export async function runAutomaticRecurring(deps: ServiceDeps): Promise<void> {
	if (await recurringEnabled(deps)) {
		await runRecurring({ ...deps, actor: undefined }, { backfill: false });
	}
}
