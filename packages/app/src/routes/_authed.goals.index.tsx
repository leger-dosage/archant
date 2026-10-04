import type { GoalData } from "@/hooks/useGoals";

import { createFileRoute } from "@tanstack/react-router";
import { ChevronDownIcon, GoalIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
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
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/goals/")({
	component: GoalsPage,
});

const GRID = "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3";

/**
 * Sure's archived section: collapsed below the grid, opened on demand, so a
 * goal put away stays out of sight until it is looked for.
 */
function Archived({ goals }: { goals: GoalData[] }) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const listId = useId();
	const headingId = useId();

	return (
		<section aria-labelledby={headingId} className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-3">
				<h2 id={headingId} className="card-title">
					{t("goals.archived.title")}
				</h2>
				<Button
					variant="ghost"
					aria-expanded={open}
					aria-controls={open ? listId : undefined}
					onClick={() => setOpen((shown) => !shown)}
				>
					<ChevronDownIcon
						aria-hidden="true"
						className={cn(
							"transition-transform motion-reduce:transition-none",
							open && "rotate-180",
						)}
					/>
					{open ? t("goals.archived.hide") : t("goals.archived.show", { count: goals.length })}
				</Button>
			</div>
			{open && (
				<ul id={listId} aria-label={t("goals.archived.title")} className={GRID}>
					{goals.map((goal) => (
						<li key={goal.id}>
							<GoalCard goal={goal} />
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

/**
 * Sure's goals page: a card per goal, active ones behind first, then paused
 * and completed ones, archived ones in a collapsed section below, and
 * « Nouvel objectif ». A viewer reads the cards without the button.
 */
function GoalsPage() {
	const { t } = useTranslation();
	const admin = useIsAdmin();
	const goals = useGoals();
	const fundable = useFundableAccounts();
	// A fresh dialog per opening, so it starts from blank fields.
	const [dialog, setDialog] = useState({ open: false, session: 0 });
	const list = goals.data ?? [];
	const shown = list.filter((goal) => goal.state !== "archived");
	const archived = list.filter((goal) => goal.state === "archived");
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
					<>
						{shown.length > 0 && (
							<ul aria-label={t("goals.list")} className={GRID}>
								{shown.map((goal) => (
									<li key={goal.id}>
										<GoalCard goal={goal} />
									</li>
								))}
							</ul>
						)}
						{archived.length > 0 && <Archived goals={archived} />}
					</>
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
