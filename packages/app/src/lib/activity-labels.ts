import type { ActivityLabel } from "@archant/data/activity-labels";

/** Each label's French name, Sure's `transactions.activity_labels.*`. */
export const ACTIVITY_LABEL_NAMES = {
	Buy: "transactions.activityLabels.buy",
	Sell: "transactions.activityLabels.sell",
	"Sweep In": "transactions.activityLabels.sweepIn",
	"Sweep Out": "transactions.activityLabels.sweepOut",
	Dividend: "transactions.activityLabels.dividend",
	Reinvestment: "transactions.activityLabels.reinvestment",
	Interest: "transactions.activityLabels.interest",
	Fee: "transactions.activityLabels.fee",
	Transfer: "transactions.activityLabels.transfer",
	Contribution: "transactions.activityLabels.contribution",
	Withdrawal: "transactions.activityLabels.withdrawal",
	Exchange: "transactions.activityLabels.exchange",
	Other: "transactions.activityLabels.other",
} as const satisfies Record<ActivityLabel, string>;
