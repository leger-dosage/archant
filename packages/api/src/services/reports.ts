import type { DailyBalance } from "../domain/balances/forward.ts";
import type { BalanceChange } from "../domain/balances/history.ts";
import type { IsoDate } from "../domain/dates.ts";
import type { CountedAccount } from "../domain/net-worth.ts";
import type { BalancePeriod } from "../schemas/balances.ts";
import type { ServiceDeps } from "./deps.ts";

import type { Classification } from "@archant/data/account-types";
import { classificationOf } from "@archant/data/account-types";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";
import { accounts } from "@archant/data/schema/accounts";

import { balanceChange, periodRange } from "../domain/balances/history.ts";
import { today } from "../domain/dates.ts";
import { netWorthSeries } from "../domain/net-worth.ts";
import { PERIOD_MONTHS } from "./balances.ts";
import { balancesBetween, openingDateOf } from "./ledger.ts";
import { getReportingCurrency } from "./settings.ts";

/** An account left out of the totals because no rate converts its currency. */
export type LeftOutAccount = { id: string; name: string; currency: string };

export type NetWorth = {
	period: BalancePeriod;
	/** First day of the series; `null` when no counted account has opened by today. */
	from: IsoDate | null;
	to: IsoDate;
	/** The reporting currency every amount below is in. */
	currency: string;
	/** Today's assets minus liabilities: the series' last point. */
	netWorth: MinorUnits;
	assets: MinorUnits;
	/** The amount owed, positive (AD-5). */
	liabilities: MinorUnits;
	/** Net worth at the end of every day of the period, oldest first, today last. */
	points: DailyBalance[];
	change: BalanceChange | null;
	/** Active accounts included in reports but held in another currency, by name. */
	leftOut: LeftOutAccount[];
};

const byName = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

function totalOf(series: readonly CountedAccount[], classification: Classification): MinorUnits {
	return toMinorUnits(
		series
			.filter((account) => account.classification === classification)
			.reduce((sum, account) => sum + (account.points.at(-1)?.balance ?? 0), 0),
	);
}

/**
 * The household's net worth over a period ending today. Counted are the
 * accounts `listAccounts` totals: active, included in reports, held in the
 * reporting currency. Today's set counts for every day, since an account keeps
 * no deactivation date, so the headline always equals the last point.
 */
export async function getNetWorth(deps: ServiceDeps, period: BalancePeriod): Promise<NetWorth> {
	const to = today(deps.timeZone);
	const currency = getReportingCurrency();
	const rows = await deps.db.select().from(accounts);
	const reported = rows.filter((row) => row.active && !row.excludedFromReports);
	const counted = reported.filter((row) => row.currency === currency);
	const leftOut = reported
		.filter((row) => row.currency !== currency)
		.toSorted((a, b) => byName.compare(a.name, b.name))
		.map((row) => ({ id: row.id, name: row.name, currency: row.currency }));

	const openingDates = await Promise.all(counted.map((row) => openingDateOf(deps, row.id)));
	const earliest = openingDates
		.filter((date): date is IsoDate => date !== null)
		.reduce<IsoDate | null>((min, date) => (min === null || date < min ? date : min), null);
	const range = earliest === null ? null : periodRange(PERIOD_MONTHS[period], to, earliest);

	const series: CountedAccount[] =
		range === null
			? []
			: await Promise.all(
					counted.map(async (row) => ({
						classification: classificationOf(row.type),
						points: await balancesBetween(deps, row.id, range.from, range.to),
					})),
				);
	const points = netWorthSeries(series);
	const assets = totalOf(series, "asset");
	const liabilities = totalOf(series, "liability");

	return {
		period,
		from: range?.from ?? null,
		to,
		currency,
		netWorth: toMinorUnits(assets - liabilities),
		assets,
		liabilities,
		points,
		change: balanceChange(points),
		leftOut,
	};
}
