import type { GoalData } from "@/hooks/useGoals";
import type { TFunction } from "i18next";

import { daysFrom, longDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format-money";
import { intlLocale } from "@/lib/locale";

const monthAndYear = new Intl.DateTimeFormat(intlLocale, {
	month: "long",
	year: "numeric",
	timeZone: "UTC",
});

type Goal = Pick<
	GoalData,
	| "state"
	| "status"
	| "currency"
	| "targetDate"
	| "targetAmount"
	| "saved"
	| "remaining"
	| "pace"
	| "monthlyNeeded"
	| "catchUpAmount"
>;

type ActionPanel = {
	title: string;
	body: string;
	action: "adjust" | "setDate" | "complete" | null;
};

function targetText(goal: Goal, today: string, t: TFunction) {
	const amount = formatMoney({ amount: goal.targetAmount, currency: goal.currency });

	if (goal.targetDate === null) {
		return { target: t("goals.header.target", { amount }), daysLeft: null };
	}

	const days = daysFrom(today, goal.targetDate);
	const reached = goal.status === "reached";
	const key = days < 0 && !reached ? "goals.header.pastDue" : "goals.header.dated";

	return {
		target: t(key, { amount, date: longDate(goal.targetDate) }),
		daysLeft: days > 0 && !reached ? t("goals.header.daysLeft", { count: days }) : null,
	};
}

function stateText(
	goal: Goal,
	today: string,
	t: TFunction,
): { status: string | null; panel: ActionPanel | null; projection: string | null } {
	const money = (amount: Goal["saved"]) => formatMoney({ amount, currency: goal.currency });
	const noPanel = { status: null, panel: null };

	if (goal.state !== "active") {
		return {
			...noPanel,
			projection: goal.state === "paused" ? t("goals.projection.paused") : null,
		};
	}

	switch (goal.status) {
		case "funded":
		case "depleted": {
			const depleted = goal.status === "depleted";
			const reserve = depleted ? "depleted" : "funded";

			return {
				status: depleted ? t("goals.header.depleted", { amount: money(goal.remaining) }) : null,
				panel: {
					title: t(`goals.panel.${reserve}.title`),
					body: t(`goals.panel.${reserve}.body`, {
						saved: money(goal.saved),
						target: money(goal.targetAmount),
					}),
					action: null,
				},
				projection: t("goals.projection.reserve"),
			};
		}
		case "reached":
			return {
				status: null,
				panel: {
					title: t("goals.panel.reached.title"),
					body: t("goals.panel.reached.body", {
						saved: money(goal.saved),
						target: money(goal.targetAmount),
					}),
					action: "complete",
				},
				projection: t("goals.projection.reached"),
			};
		case "no_target_date":
			return {
				status: t("goals.header.noDate"),
				panel: {
					title: t("goals.panel.noDate.title"),
					body: t("goals.panel.noDate.body"),
					action: "setDate",
				},
				projection: t("goals.projection.noDate"),
			};
		case "pace_unknown":
			return {
				status: t("goals.header.unknown"),
				panel: null,
				projection: t("goals.projection.unknown"),
			};
		case "behind": {
			const { catchUpAmount, monthlyNeeded, pace } = goal;

			if (catchUpAmount === null || monthlyNeeded === null || pace === null) {
				// Never turn a missing amount into a measured shortfall.
				return { ...noPanel, projection: null };
			}

			const projection = t(pace === 0 ? "goals.projection.zero" : "goals.projection.behind");

			if (catchUpAmount === 0) {
				return { status: t("goals.pledge.covered"), panel: null, projection };
			}

			const status = t("goals.header.behind", { amount: money(catchUpAmount) });

			return {
				status,
				panel: {
					title: status,
					body: t("goals.panel.behind.body", { pace: money(pace), needed: money(monthlyNeeded) }),
					action: "adjust",
				},
				projection,
			};
		}
		case "on_track": {
			if (goal.pace === null || goal.pace <= 0) {
				return { ...noPanel, projection: null };
			}

			const months = Math.ceil(goal.remaining / goal.pace);
			const month = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
			month.setUTCMonth(month.getUTCMonth() + months);
			const date = monthAndYear.format(month);

			return {
				status: t("goals.header.onTrack", { date }),
				panel: null,
				projection: t("goals.projection.onTrack", { date }),
			};
		}
		default: {
			const status: never = goal.status;
			throw new Error(`Unhandled goal status: ${String(status)}`);
		}
	}
}

/** Sure's page messages, using the same status and pace as the graph and list. */
export function goalPageText(goal: Goal, today: string, t: TFunction) {
	return {
		...(goal.state === "active" ? targetText(goal, today, t) : { target: null, daysLeft: null }),
		...stateText(goal, today, t),
	};
}
