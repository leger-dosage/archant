import type { Transaction } from "./ledger/shared.ts";
import type { ImportedAccount } from "./ledger/sure-import.ts";
import type { SampleGoal } from "./sample-data-plan.ts";
import type { SureImportDeps } from "./sure-import.ts";

import type { CurrencyCode } from "@archant/data/money";
import { goalAccounts, goals } from "@archant/data/schema/goals";

import { today } from "../domain/dates.ts";
import { resetFinancialData } from "./ledger/reset.ts";
import { SAMPLE_DATA_SEED, samplePlan } from "./sample-data-plan.ts";
import { getReportingCurrency } from "./settings.ts";
import { afterImport, writeArchive } from "./sure-import.ts";

/**
 * Sure's goals of the demo, beside the ones the household kept: Sure's reset
 * keeps goals and its generator adds nine. Each in the reporting currency,
 * its accounts' own.
 */
async function insertGoals(
	tx: Transaction,
	plan: readonly SampleGoal[],
	accounts: ReadonlyMap<string, ImportedAccount>,
	currency: CurrencyCode,
): Promise<void> {
	const now = Date.now();
	const rows = plan.map((goal) => ({ id: crypto.randomUUID(), goal }));

	await tx.insert(goals).values(
		rows.map(({ id, goal }) => ({
			id,
			name: goal.name,
			targetAmount: goal.targetAmount,
			currency,
			targetDate: goal.targetDate,
			color: goal.color,
			state: goal.state,
			completedAmount: goal.completedAmount,
			completedAt: goal.completedAmount === null ? null : now,
			createdAt: now,
			updatedAt: now,
		})),
	);
	await tx.insert(goalAccounts).values(
		rows.flatMap(({ id, goal }) =>
			goal.accounts.map((link) => {
				const account = accounts.get(link.accountSourceId);

				// A typo in the sample's goals, never a household's data.
				if (account === undefined) {
					throw new RangeError("A sample goal names an account the sample lacks.");
				}

				return { goalId: id, accountId: account.id, allocatedAmount: link.allocatedAmount };
			}),
		),
	);
}

/**
 * « Réinitialiser et précharger »: Sure's `FamilyResetJob` with
 * `load_sample_data_for_email`, its reset then `Demo::Generator`. One
 * immediate transaction holds both, where Sure runs two: the request waits
 * for it, and a failed load must not leave an empty household. The reset
 * nests as a savepoint and refuses a live sync's lease first. Statistics and
 * recurring detection follow the commit, as after an archive import, so the
 * demo's bills appear as Sure's sync finds them.
 */
export async function resetWithSampleData(deps: SureImportDeps): Promise<void> {
	const currency = getReportingCurrency();
	// Built before the write lock is taken: the plan depends on no row.
	const sample = samplePlan({ seed: SAMPLE_DATA_SEED, today: today(deps.timeZone), currency });

	await deps.db.transaction(
		async (tx) => {
			await resetFinancialData({ ...deps, db: tx }, { origin: "user" });
			const accounts = await writeArchive(deps, tx, sample.plan);
			await insertGoals(tx, sample.goals, accounts, currency);
		},
		{ behavior: "immediate" },
	);
	await afterImport(deps);
}
