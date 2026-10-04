import { createFileRoute } from "@tanstack/react-router";
import { GoalIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { EmptyState } from "@/components/EmptyState";
import { GoalCard } from "@/components/GoalCard";
import { GoalDialog } from "@/components/GoalDialog";
import { Page } from "@/components/Page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useFundableAccounts, useGoals } from "@/hooks/useGoals";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { errorCodeOf } from "@/lib/api";

export const Route = createFileRoute("/_authed/goals/")({
	component: GoalsPage,
});

/**
 * Sure's goals page: a card per goal, behind ones first, and « Nouvel
 * objectif ». A viewer reads the cards without the button.
 */
function GoalsPage() {
	const { t } = useTranslation();
	const admin = useIsAdmin();
	const goals = useGoals();
	const fundable = useFundableAccounts();
	// A fresh dialog per opening, so it starts from blank fields.
	const [dialog, setDialog] = useState({ open: false, session: 0 });
	const list = goals.data ?? [];
	const openDialog = () => setDialog(({ session }) => ({ open: true, session: session + 1 }));
	const addButton = admin ? <Button onClick={openDialog}>{t("goals.add")}</Button> : null;

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("goals.title"), app: t("app.name") });
	}, [t]);

	return (
		<Page
			title={t("goals.title")}
			description={t("goals.description")}
			// An empty list offers its own, the one way forward.
			actions={list.length > 0 && addButton !== null ? addButton : undefined}
		>
			{goals.isPending && (
				<div aria-hidden="true" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
					<Skeleton className="h-28 rounded-xl" />
					<Skeleton className="h-28 rounded-xl" />
				</div>
			)}

			{goals.isError && goals.data === undefined && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-xl border bg-card p-4">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(goals.error)}`)}</p>
					<Button variant="outline" onClick={() => void goals.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{goals.data !== undefined &&
				(list.length === 0 ? (
					<EmptyState
						level={2}
						labelled
						icon={{ kind: "transfer", icon: GoalIcon }}
						title={t("goals.empty.title")}
						description={t("goals.empty.description")}
						action={addButton}
					/>
				) : (
					<ul
						aria-label={t("goals.list")}
						className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
					>
						{list.map((goal) => (
							<li key={goal.id}>
								<GoalCard goal={goal} />
							</li>
						))}
					</ul>
				))}

			{admin && fundable.data !== undefined && dialog.session > 0 && (
				<GoalDialog
					key={dialog.session}
					open={dialog.open}
					onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
					accounts={fundable.data.accounts}
					reportingCurrency={fundable.data.reportingCurrency}
				/>
			)}
		</Page>
	);
}
