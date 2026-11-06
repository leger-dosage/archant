import type { DateRange } from "../domain/balances/history.ts";
import type { ServiceDeps } from "./deps.ts";
import type { ReturnData } from "./reports.ts";

import { INVESTMENT_TAX_TREATMENTS, investmentTaxTreatment } from "@archant/data/account-types";
import { formatMicros } from "@archant/data/micros";
import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

import { addDays } from "../domain/dates.ts";
import { historicalSaleGain, purchaseAverage } from "../domain/holdings/historical-basis.ts";
import { returnOf } from "../domain/holdings/portfolio.ts";
import { percentOf } from "../domain/holdings/positions.ts";
import { lastBalanceOnOrBefore } from "./ledger/balances.ts";
import { holdingsValueOn, reportSales } from "./ledger/holdings.ts";
import { investmentFunding, investmentMarketFlows } from "./ledger/queries.ts";
import { readInvestmentFigures, reportedAccounts } from "./reports.ts";

const amount = (value: bigint) => toMinorUnits(Number(value));
const sum = (values: readonly (MinorUnits | null)[]) =>
	amount(values.reduce<bigint>((total, value) => total + BigInt(value ?? 0), 0n));

/** Every report investment amount comes from the same eligible accounts and explicit period. */
export async function getReportInvestments(deps: ServiceDeps, range: DateRange) {
	const [{ summary, accounts, positions }, fundingAccounts] = await Promise.all([
		readInvestmentFigures(deps, range),
		reportedAccounts(deps),
	]);
	const accountIds = accounts.map((account) => account.id);
	const before = addDays(range.from, -1);
	const [boundaries, flows, historical, funding] = await Promise.all([
		Promise.all(
			accountIds.map(async (id) => {
				const [start, end, balance] = await Promise.all([
					holdingsValueOn(deps.db, id, before),
					holdingsValueOn(deps.db, id, range.to),
					lastBalanceOnOrBefore(deps.db, id, before),
				]);
				return {
					gain: end.amount - start.amount,
					capital: BigInt(balance?.balance ?? 0),
					hasHoldings: start.hasHoldings || end.hasHoldings,
				};
			}),
		),
		investmentMarketFlows(deps, { ...range, accountIds }),
		reportSales(deps.db, { ...range, accountIds }),
		investmentFunding(deps, {
			...range,
			accountIds: fundingAccounts.counted.map((account) => account.id),
		}),
	]);
	const gain = boundaries.reduce((total, row) => total + row.gain, flows);
	const capital = boundaries.reduce((total, row) => total + row.capital, 0n);
	const percent = percentOf(gain, capital < 0n ? -capital : capital);
	const periodReturn: ReturnData | null =
		capital === 0n ||
		(!boundaries.some((boundary) => boundary.hasHoldings) &&
			summary.available &&
			summary.activity.trades === 0)
			? null
			: {
					gain: amount(gain),
					percent:
						percent === null ? (gain < 0n ? "-Infinity" : "Infinity") : formatMicros(percent),
					trend: gain > 0n ? "up" : gain < 0n ? "down" : "flat",
				};
	const byAccount = new Map(accounts.map((account) => [account.id, account]));
	// One prefix walk per account/security. All purchases of the snapshot day
	// count, including those recorded after its sale, as Sure's average does.
	const purchases = new Map<string, typeof historical.purchases>();
	for (const purchase of historical.purchases) {
		const key = `${purchase.accountId}:${purchase.securityId}`;
		const rows = purchases.get(key) ?? [];
		rows.push(purchase);
		purchases.set(key, rows);
	}
	const averages = new Map<
		string,
		{ index: number; average: ReturnType<typeof purchaseAverage> }
	>();
	const locks = new Map(
		historical.locks.map((lock) => [`${lock.accountId}:${lock.securityId}`, lock]),
	);
	const sales = historical.sales.map((sale) => {
		const key = `${sale.accountId}:${sale.security.id}`;
		const prefix = averages.get(key) ?? { index: 0, average: { quantity: 0n, value: 0n } };
		const rows = purchases.get(key) ?? [];
		while (prefix.index < rows.length) {
			const next = rows[prefix.index];
			if (next === undefined || sale.snapshotDate === null || next.date > sale.snapshotDate) {
				break;
			}
			const extra = purchaseAverage([next]);
			prefix.average.quantity += extra.quantity;
			prefix.average.value += extra.value;
			prefix.index += 1;
		}
		averages.set(key, prefix);
		const candidate = locks.get(key);
		const lock =
			candidate !== undefined &&
			sale.snapshotDate !== null &&
			sale.snapshotDate >= candidate.lockedOn &&
			(candidate.endedOn === null || sale.snapshotDate <= candidate.endedOn)
				? candidate
				: undefined;

		return {
			id: sale.id,
			accountId: sale.accountId,
			date: sale.date,
			security: sale.security,
			gain:
				sale.snapshotDate === null
					? null
					: historicalSaleGain(
							{
								...sale,
								costBasis: lock?.costBasis ?? sale.costBasis,
								costBasisLocked: lock !== undefined,
								purchases: prefix.average,
							},
							summary.available ? summary.currency : "EUR",
						),
		};
	});
	const gainsByTaxTreatment = INVESTMENT_TAX_TREATMENTS.flatMap((treatment) => {
		const groupAccountIds = new Set(
			accounts
				.filter((account) => investmentTaxTreatment(account) === treatment)
				.map((account) => account.id),
		);
		const holdings = positions
			.filter((position) => groupAccountIds.has(position.accountId))
			.map((position) => ({
				accountId: position.accountId,
				security: {
					id: position.security.id,
					name: position.security.name,
					ticker: position.security.ticker,
				},
				gain:
					returnOf([position], byAccount.get(position.accountId)?.currency ?? "EUR")?.gain ?? null,
			}));
		const sold = sales.filter((sale) => groupAccountIds.has(sale.accountId));
		if (holdings.length === 0 && sold.length === 0) {
			return [];
		}
		const unrealizedGain = sum(holdings.map((holding) => holding.gain));
		const realizedGain = sum(sold.map((sale) => sale.gain));
		return [
			{
				treatment,
				totalGain: sum([unrealizedGain, realizedGain]),
				unrealizedGain,
				realizedGain,
				holdings,
				sales: sold,
			},
		];
	});
	return {
		investments: summary.available
			? {
					...summary,
					periodReturn,
					gainsByTaxTreatment,
					accounts: accounts.map((account) => ({
						id: account.id,
						name: account.name,
						type: account.type,
						subtype: account.subtype,
						balance: account.balance,
					})),
				}
			: summary,
		investmentFlows: {
			available: summary.available && (funding.contributions > 0n || funding.withdrawals > 0n),
			currency: fundingAccounts.currency,
			contributions: amount(funding.contributions),
			withdrawals: amount(funding.withdrawals),
			netFlow: amount(funding.contributions - funding.withdrawals),
			leftOut: fundingAccounts.leftOut,
		},
	};
}
