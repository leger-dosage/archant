import type { ServiceDeps } from "../deps.ts";
import type { DetectionResult } from "./series.ts";

import { today } from "../../domain/dates.ts";
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
			const result = await detectWithin(tx, day);

			await generateOccurrences(tx, day);
			await matchOccurrences(tx, day, { backfill: false });
			await detectPriceChanges(tx, day);

			if (backfill) {
				await backfillOccurrences(tx, day);
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
		await runRecurring(deps, { backfill: false });
	}
}
