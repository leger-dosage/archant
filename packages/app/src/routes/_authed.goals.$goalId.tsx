import type { GoalData } from "@/hooks/useGoals";
import type { TFunction } from "i18next";
import type { ReactNode } from "react";

import { Link, createFileRoute } from "@tanstack/react-router";
import { GoalIcon, PencilIcon } from "lucide-react";
import { Suspense, lazy, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { GoalEvent } from "@archant/data/goals";
import { formatMoney } from "@archant/data/money";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { goalBadge } from "@/components/GoalCard";
import { GoalDialog } from "@/components/GoalDialog";
import { GoalMenu } from "@/components/GoalMenu";
import { GoalStateBanner } from "@/components/GoalStateBanner";
import { Money } from "@/components/Money";
import { Page } from "@/components/Page";
import { ProgressRing } from "@/components/ProgressRing";
import { Section } from "@/components/Section";
import { StatusBadge } from "@/components/StatusBadge";
import { TintedIcon } from "@/components/TintedIcon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	useDeleteGoal,
	useFundableAccounts,
	useGoal,
	useGoalEvent,
	useGoalHistory,
} from "@/hooks/useGoals";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { ApiError, errorCodeOf } from "@/lib/api";
import { formatShortDate } from "@/lib/balance-change";
import { CHART_HEIGHTS } from "@/lib/chart-heights";
import { toIsoDate } from "@/lib/dates";
import { showErrorToast } from "@/lib/error-toast";
import { formatWholePercent } from "@/lib/percent";

// Recharts weighs more than the rest of the page: it downloads with the chart.
const GoalChart = lazy(async () => ({
	default: (await import("@/components/GoalChart")).GoalChart,
}));

export const Route = createFileRoute("/_authed/goals/$goalId")({
	component: GoalPage,
});

function Figure({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex flex-col gap-0.5">
			<dt className="text-sm text-muted-foreground">{label}</dt>
			<dd className="tabular-nums">{children}</dd>
		</div>
	);
}

/**
 * How a reserve in months of expenses reaches its target: the months and the
 * median they multiply, or, without a median, that the target last computed
 * stands, as Sure keeps its stale floor.
 */
function reserveTargetNote(goal: GoalData, t: TFunction): string | null {
	if (goal.targetMonths === null) {
		return null;
	}

	return goal.monthlyExpenses === null
		? t("goals.figures.monthsStale", { count: goal.targetMonths })
		: t("goals.figures.monthsOfExpenses", {
				count: goal.targetMonths,
				median: formatMoney({ amount: goal.monthlyExpenses, currency: goal.currency }),
			});
}

/**
 * Saved against target, what remains, the monthly amount by the date, and the
 * pace. Only an active goal asks for a monthly amount. A completed goal says
 * when it was reached and with how much, as Sure's « Atteint le … » and its
 * `show_frozen_note?`, and asks for nothing more. A reserve has no date, and
 * what it misses is to refill, as Sure's « À recompléter ».
 */
function Progress({ goal }: { goal: GoalData }) {
	const { t } = useTranslation();
	const money = (amount: GoalData["saved"]) => <Money amount={amount} currency={goal.currency} />;
	const completed = goal.state === "completed";
	const reserve = goal.kind === "maintained";
	const months = reserveTargetNote(goal, t);

	return (
		<Section title={t("goals.figures.title")}>
			<div className="flex flex-wrap items-center gap-6 p-4">
				<ProgressRing
					size={96}
					percent={goal.percent}
					subject={{ kind: "goal", color: goal.color, icon: goal.icon, name: goal.name }}
					label={t("goals.ring", { percent: formatWholePercent(goal.percent) })}
				/>
				<div className="flex min-w-0 flex-1 flex-col gap-3">
					<div className="flex flex-wrap items-center gap-2">
						<StatusBadge status={goalBadge(goal)} />
						{completed && goal.completedAt !== null && (
							<span className="text-sm text-muted-foreground tabular-nums">
								{t("goals.figures.reachedOn", {
									date: formatShortDate(toIsoDate(new Date(goal.completedAt))),
									amount: formatMoney({ amount: goal.saved, currency: goal.currency }),
								})}
							</span>
						)}
					</div>
					{months !== null && <p className="text-sm text-muted-foreground">{months}</p>}
					<dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
						<Figure label={t("goals.figures.saved")}>{money(goal.saved)}</Figure>
						<Figure label={t("goals.figures.target")}>{money(goal.targetAmount)}</Figure>
						{!completed && (
							<Figure label={t(reserve ? "goals.figures.refill" : "goals.figures.remaining")}>
								{money(goal.remaining)}
							</Figure>
						)}
						{!reserve && (
							<Figure label={t("goals.figures.date")}>
								{goal.targetDate === null
									? t("goals.figures.noDate")
									: formatShortDate(goal.targetDate)}
							</Figure>
						)}
						{goal.state === "active" && goal.monthlyNeeded !== null && goal.remaining > 0 && (
							<Figure label={t("goals.figures.monthly")}>{money(goal.monthlyNeeded)}</Figure>
						)}
						<Figure label={t("goals.figures.pace")}>
							{t("goals.figures.perMonth", {
								amount: formatMoney({ amount: goal.pace, currency: goal.currency }),
							})}
						</Figure>
					</dl>
				</div>
			</div>
		</Section>
	);
}

/**
 * Each linked account's share; « X affectés sur Y » for a fixed amount, as
 * Sure's. A deactivated account is named, counting for nothing; a goal whose
 * last account was deleted says it has none.
 */
function Accounts({ goal }: { goal: GoalData }) {
	const { t } = useTranslation();

	return (
		<Section title={t("goals.accounts.title")}>
			{goal.accounts.length === 0 && (
				<p className="p-4 text-muted-foreground">{t("goals.accounts.none")}</p>
			)}
			<ul className="divide-y divide-line">
				{goal.accounts.map((account) => (
					<li key={account.accountId} className="flex items-center gap-3 px-4 py-3">
						<TintedIcon subject={{ kind: "account", type: account.type }} />
						<div className="flex min-w-0 flex-1 flex-col">
							<Link
								to="/accounts/$accountId"
								params={{ accountId: account.accountId }}
								className="truncate font-medium hover:underline"
							>
								{account.name}
							</Link>
							<p className="text-sm text-muted-foreground tabular-nums">
								{!account.active
									? t("goals.accounts.inactive")
									: account.allocatedAmount === null
										? t("goals.accounts.whole")
										: t("goals.accounts.earmarked", {
												share: formatMoney({ amount: account.share, currency: goal.currency }),
												balance: formatMoney({
													amount: account.balance,
													currency: account.currency,
												}),
											})}
							</p>
						</div>
						<Money amount={account.share} currency={goal.currency} />
					</li>
				))}
			</ul>
		</Section>
	);
}

/** The events Sure confirms first, and deleting. */
type Confirmation = "complete" | "archive" | "delete";

/** Sure's `goal_complete_confirm`: short of the target, it says how far the goal got. */
function completeDescription(goal: GoalData, t: TFunction): string {
	return goal.percent < 100
		? t("goals.completeDialog.short", {
				percent: goal.percent,
				saved: formatMoney({ amount: goal.saved, currency: goal.currency }),
				target: formatMoney({ amount: goal.targetAmount, currency: goal.currency }),
			})
		: t("goals.completeDialog.description");
}

/** The chart, for a goal that still saves: active or paused, as Sure's projection panel. */
function Projection({ goal }: { goal: GoalData }) {
	const { t } = useTranslation();
	const saving = goal.state === "active" || goal.state === "paused";
	const history = useGoalHistory(goal.id, saving);

	if (!saving) {
		return null;
	}

	return (
		<Section title={t("goals.chart.title")}>
			<Suspense
				fallback={
					<div className="p-4">
						<Skeleton className={`${CHART_HEIGHTS[256]} w-full`} aria-hidden="true" />
					</div>
				}
			>
				<GoalChart goal={goal} history={history} />
			</Suspense>
		</Section>
	);
}

/**
 * One goal, as Sure's page: a banner when it is not active, its progress,
 * its chart, the share each account backs and its notes; for an
 * administrator, « Modifier » and the « … » menu of its events and
 * « Supprimer ».
 */
function GoalPage() {
	const { t } = useTranslation();
	const { goalId } = Route.useParams();
	const admin = useIsAdmin();
	const goal = useGoal(goalId);
	const fundable = useFundableAccounts();
	const deleteGoal = useDeleteGoal(goalId);
	const goalEvent = useGoalEvent(goalId);
	const [edit, setEdit] = useState({ open: false, session: 0 });
	const [confirming, setConfirming] = useState<Confirmation | null>(null);
	const data = goal.data;
	const code = goal.isError ? errorCodeOf(goal.error) : null;
	const title = data?.name ?? t("goals.title");

	const run = async (event: GoalEvent, current: GoalData) => {
		try {
			const saved = await goalEvent.mutateAsync(event);
			toast.success(t(`goals.events.${event}.done`, { name: saved.name }));
		} catch (error) {
			if (error instanceof ApiError && error.code === "GOAL_ACCOUNT_TAKEN") {
				// The server names the account by id only (AD-14); the goal knows its name.
				const account = current.accounts.find(
					(candidate) => candidate.accountId === error.params["accountId"],
				);
				toast.error(t("errors.GOAL_ACCOUNT_TAKEN", { account: account?.name ?? "" }));
			} else {
				showErrorToast(errorCodeOf(error));
			}
		} finally {
			setConfirming(null);
		}
	};

	const request = (event: GoalEvent) => {
		if (data === undefined) {
			return;
		}

		if (event === "complete" || event === "archive") {
			setConfirming(event);
		} else {
			void run(event, data);
		}
	};

	// Awaited rather than through `mutate`'s callbacks: the page unmounts as
	// the deletion lands on `/goals`, and those would never run.
	const remove = async (name: string) => {
		try {
			await deleteGoal.mutateAsync();
			toast.success(t("goals.deleteDialog.deleted", { name }));
		} catch (error) {
			showErrorToast(errorCodeOf(error));
		}
	};

	useEffect(() => {
		document.title = t("app.pageTitle", { page: title, app: t("app.name") });
	}, [t, title]);

	return (
		<Page
			title={title}
			{...(data === undefined
				? {}
				: {
						icon: (
							<TintedIcon
								subject={{ kind: "goal", color: data.color, icon: data.icon, name: data.name }}
								size="lg"
							/>
						),
					})}
			actions={
				admin && data !== undefined ? (
					<>
						<Button
							variant="outline"
							onClick={() => setEdit(({ session }) => ({ open: true, session: session + 1 }))}
						>
							<PencilIcon aria-hidden="true" />
							{t("goals.edit")}
						</Button>
						<GoalMenu
							goal={data}
							pending={goalEvent.isPending}
							onEvent={request}
							onDelete={() => setConfirming("delete")}
						/>
					</>
				) : undefined
			}
		>
			{goal.isPending && <Skeleton aria-hidden="true" className="h-48 w-full rounded-xl" />}

			{data === undefined && code === "NOT_FOUND" && (
				<EmptyState
					level={2}
					labelled
					icon={{ kind: "transfer", icon: GoalIcon }}
					title={t("goals.notFound.title")}
					description={t("goals.notFound.description")}
					action={
						<Button variant="outline" asChild>
							<Link to="/goals">{t("goals.notFound.back")}</Link>
						</Button>
					}
				/>
			)}

			{data === undefined && code !== null && code !== "NOT_FOUND" && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-xl border bg-card p-4">
					<p className="text-muted-foreground">{t(`errors.${code}`)}</p>
					<Button variant="outline" onClick={() => void goal.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{data !== undefined && (
				<>
					<GoalStateBanner
						goal={data}
						pending={goalEvent.isPending}
						onEvent={admin ? request : null}
					/>
					<div className="grid grid-cols-1 gap-6 xl:grid-cols-2 xl:items-start">
						<Progress goal={data} />
						<Projection goal={data} />
						<Accounts goal={data} />
					</div>
					{data.notes !== null && (
						<Section title={t("goals.notes")}>
							<p className="p-4 whitespace-pre-line">{data.notes}</p>
						</Section>
					)}
				</>
			)}

			{admin && data !== undefined && fundable.data !== undefined && edit.session > 0 && (
				<GoalDialog
					key={edit.session}
					open={edit.open}
					onOpenChange={(open) => setEdit((current) => ({ ...current, open }))}
					goal={data}
					accounts={fundable.data.accounts}
					reportingCurrency={fundable.data.reportingCurrency}
				/>
			)}
			{admin && data !== undefined && (
				<>
					<ConfirmDialog
						open={confirming === "delete"}
						onOpenChange={(open) => setConfirming(open ? "delete" : null)}
						title={t("goals.deleteDialog.title", { name: data.name })}
						description={t("goals.deleteDialog.description")}
						confirmLabel={t("goals.deleteDialog.action")}
						destructive
						pending={deleteGoal.isPending}
						onConfirm={() => void remove(data.name)}
					/>
					<ConfirmDialog
						open={confirming === "complete"}
						onOpenChange={(open) => setConfirming(open ? "complete" : null)}
						title={t("goals.completeDialog.title")}
						description={completeDescription(data, t)}
						confirmLabel={t("goals.completeDialog.action")}
						pending={goalEvent.isPending}
						onConfirm={() => void run("complete", data)}
					/>
					<ConfirmDialog
						open={confirming === "archive"}
						onOpenChange={(open) => setConfirming(open ? "archive" : null)}
						title={t("goals.archiveDialog.title")}
						description={t(
							// A completed goal has its amount frozen already.
							data.state === "completed"
								? "goals.archiveDialog.descriptionCompleted"
								: "goals.archiveDialog.description",
						)}
						confirmLabel={t("goals.archiveDialog.action")}
						pending={goalEvent.isPending}
						onConfirm={() => void run("archive", data)}
					/>
				</>
			)}
		</Page>
	);
}
