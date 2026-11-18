import type { GoalData } from "@/hooks/useGoals";

import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useChangeGoalPledge } from "@/hooks/useGoals";
import { errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { formatMoney } from "@/lib/format-money";

type Pledge = GoalData["pledges"][number];

function PledgeActions({ goalId, pledge }: { goalId: string; pledge: Pledge }) {
	const { t } = useTranslation();
	const change = useChangeGoalPledge(goalId);
	const run = (action: "extend" | "cancel") =>
		change.mutate(
			{ action, pledgeId: pledge.id },
			{ onError: (error) => showErrorToast(errorCodeOf(error)) },
		);

	return (
		<div className="flex flex-wrap gap-2">
			<Button size="sm" variant="outline" disabled={change.isPending} onClick={() => run("extend")}>
				{t("goals.pledge.extend")}
			</Button>
			<Button size="sm" variant="ghost" disabled={change.isPending} onClick={() => run("cancel")}>
				{t("common.cancel")}
			</Button>
		</div>
	);
}

export function GoalPledges({ goal, admin }: { goal: GoalData; admin: boolean }) {
	const { t } = useTranslation();

	if (goal.pledges.length === 0) {
		return null;
	}

	return (
		<ul className="flex flex-col gap-2" aria-label={t("goals.pledge.list")}>
			{goal.pledges.map((pledge) => (
				<li
					key={pledge.id}
					className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card px-4 py-3"
				>
					<p role="status">
						{t(pledge.status === "open" ? "goals.pledge.pending" : "goals.pledge.expired", {
							amount: formatMoney({ amount: pledge.amount, currency: goal.currency }),
							account: pledge.accountName,
							count: pledge.daysLeft,
						})}
					</p>
					{admin && pledge.status === "open" && <PledgeActions goalId={goal.id} pledge={pledge} />}
				</li>
			))}
		</ul>
	);
}
