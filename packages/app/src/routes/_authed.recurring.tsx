import type { BillDialogSubject } from "@/components/BillDialog";
import type { Status } from "@/components/StatusBadge";
import type { RecurringData } from "@/hooks/useRecurring";

import { createFileRoute } from "@tanstack/react-router";
import { EllipsisIcon, RepeatIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { BillDialog } from "@/components/BillDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { GROUP_TABLE_INSET, InsetGroup } from "@/components/InsetGroup";
import { ListCard } from "@/components/ListCard";
import { Page } from "@/components/Page";
import { RecurringAmount, RecurringSuggestions } from "@/components/RecurringSuggestions";
import { StatusBadge } from "@/components/StatusBadge";
import { TintedIcon } from "@/components/TintedIcon";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useAccounts } from "@/hooks/useAccounts";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import {
	recurringName,
	useCleanupRecurring,
	useDeleteRecurring,
	useDetectRecurring,
	useRecurring,
	useSetRecurringStatus,
} from "@/hooks/useRecurring";
import { errorCodeOf } from "@/lib/api";
import { formatTableDate } from "@/lib/balance-change";
import { dayAndMonth } from "@/lib/dates";
import { showErrorToast } from "@/lib/error-toast";

export const Route = createFileRoute("/_authed/recurring")({
	component: RecurringPage,
});

const nameOf = recurringName;

// Suggestions sit in their own strip and ended series never reach the page,
// so only the two statuses the list shows have a badge.
const BADGES = {
	active: "recurringActive",
	inactive: "recurringInactive",
} as const satisfies Partial<Record<RecurringData["status"], Status>>;

type Listed = RecurringData & { status: keyof typeof BADGES };

const isListed = (item: RecurringData): item is Listed => item.status in BADGES;

/**
 * A series' current occurrence: « Payée » once closed, « 3 jours de retard »
 * past its grace days, else « À payer le 5 novembre ».
 */
function CurrentOccurrence({
	occurrence,
}: {
	occurrence: NonNullable<RecurringData["currentOccurrence"]>;
}) {
	const { t } = useTranslation();

	if (occurrence.status !== "scheduled") {
		return <span>{t(`recurring.occurrence.${occurrence.status}`)}</span>;
	}

	return occurrence.state === "overdue" ? (
		<span className="text-destructive">
			{t("recurring.occurrence.overdue", { count: occurrence.daysLate ?? 0 })}
		</span>
	) : (
		<span>{t("recurring.occurrence.due", { date: dayAndMonth(occurrence.effectiveDueOn) })}</span>
	);
}

/** An active or inactive row's menu: edit, pause or resume, and delete. */
function RecurringActions({
	item,
	onEdit,
	onToggle,
	onDelete,
	disabled,
}: {
	item: Listed;
	onEdit: () => void;
	onToggle: () => void;
	onDelete: () => void;
	disabled: boolean;
}) {
	const { t } = useTranslation();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					aria-label={t("recurring.actions", { name: nameOf(item) })}
				>
					<EllipsisIcon />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onSelect={onEdit}>{t("recurring.edit")}</DropdownMenuItem>
				<DropdownMenuItem disabled={disabled} onSelect={onToggle}>
					{t(item.status === "active" ? "recurring.pause" : "recurring.resume")}
				</DropdownMenuItem>
				<DropdownMenuItem variant="destructive" disabled={disabled} onSelect={onDelete}>
					{t("recurring.delete")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * Sure's recurring page: the suggestions detection found above the active
 * and inactive series, each by next expected date. Ended series are gone from
 * here and from detection. The owner declares a bill or an income Archant has
 * not found, and edits a series from its menu. A viewer reads them, without
 * « Ajouter une facture », « Ajouter un revenu », « Détecter », « Nettoyer les
 * obsolètes », a suggestion's buttons or a row's menu.
 */
function RecurringPage() {
	const { t } = useTranslation();
	const admin = useIsAdmin();
	const recurring = useRecurring();
	const detect = useDetectRecurring();
	const cleanup = useCleanupRecurring();
	const setStatus = useSetRecurringStatus();
	const remove = useDeleteRecurring();
	// Kept while the dialog closes, so its title does not vanish mid-animation.
	const [deleting, setDeleting] = useState<RecurringData | null>(null);
	const [deleteOpen, setDeleteOpen] = useState(false);
	// Kept while the dialog closes, as `deleting`; the key mounts a fresh form per opening.
	const [subject, setSubject] = useState<{ key: number; of: BillDialogSubject } | null>(null);
	const [billOpen, setBillOpen] = useState(false);
	const accounts = useAccounts({
		select: (data) => data.groups.flatMap((group) => group.accounts),
	});
	// A series may sit on an account deactivated since: it stays offered for it.
	const offered = useMemo(() => {
		const own = subject?.of.mode === "edit" ? subject.of.series.accountId : null;

		return (accounts.data ?? []).filter((account) => account.active || account.id === own);
	}, [accounts.data, subject]);
	const openBill = (of: BillDialogSubject) => {
		setSubject((current) => ({ key: (current?.key ?? 0) + 1, of }));
		setBillOpen(true);
	};
	const all = recurring.data ?? [];
	const suggestions = all.filter((item) => item.status === "suggested");
	const list = all.filter(isListed);

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("recurring.title"), app: t("app.name") });
	}, [t]);

	const runDetection = () =>
		detect.mutate(undefined, {
			onSuccess: ({ detected }) => toast.success(t("recurring.detected", { count: detected })),
			onError: (error) => showErrorToast(errorCodeOf(error)),
		});

	const runCleanup = () =>
		cleanup.mutate(undefined, {
			onSuccess: ({ inactive }) => toast.success(t("recurring.cleaned", { count: inactive })),
			onError: (error) => showErrorToast(errorCodeOf(error)),
		});

	const toggle = (item: Listed) => {
		const status = item.status === "active" ? "inactive" : "active";

		setStatus.mutate(
			{ id: item.id, status },
			{
				onSuccess: () =>
					toast.success(t(status === "active" ? "recurring.resumed" : "recurring.paused")),
				onError: (error) => showErrorToast(errorCodeOf(error)),
			},
		);
	};

	return (
		<Page
			title={t("recurring.title")}
			description={t("recurring.description")}
			actions={
				!admin ? undefined : (
					<>
						{/* An empty page offers its own « Détecter », the one way forward. */}
						{(recurring.data === undefined || all.length > 0) && (
							<>
								<Button variant="outline" disabled={cleanup.isPending} onClick={runCleanup}>
									{t("recurring.cleanup")}
								</Button>
								<Button variant="outline" disabled={detect.isPending} onClick={runDetection}>
									{t("recurring.detect")}
								</Button>
							</>
						)}
						<Button
							variant="outline"
							onClick={() => openBill({ mode: "declare", kind: "income", prefill: null })}
						>
							{t("recurring.addIncome")}
						</Button>
						<Button onClick={() => openBill({ mode: "declare", kind: "bill", prefill: null })}>
							{t("recurring.addBill")}
						</Button>
					</>
				)
			}
		>
			{recurring.isPending && (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-14 w-full" />
					<Skeleton className="h-14 w-full" />
					<Skeleton className="h-14 w-full" />
				</div>
			)}

			{recurring.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border bg-card p-4">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(recurring.error)}`)}</p>
					<Button variant="outline" onClick={() => void recurring.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{suggestions.length > 0 && <RecurringSuggestions items={suggestions} admin={admin} />}

			{recurring.data !== undefined &&
				(all.length === 0 ? (
					<EmptyState
						level={2}
						icon={{ kind: "transfer", icon: RepeatIcon }}
						title={t("recurring.empty.title")}
						description={t("recurring.empty.description")}
						action={
							admin ? (
								<Button disabled={detect.isPending} onClick={runDetection}>
									{t("recurring.empty.action")}
								</Button>
							) : null
						}
					/>
				) : list.length === 0 ? null : (
					<ListCard>
						<InsetGroup level={2} title={t("recurring.list")} count={list.length}>
							<Table aria-label={t("recurring.title")} className={GROUP_TABLE_INSET}>
								<TableHeader>
									<TableRow className="border-line hover:bg-transparent">
										<TableHead scope="col" className="type-overline text-muted-foreground">
											{t("recurring.columns.name")}
										</TableHead>
										<TableHead scope="col" className="type-overline text-muted-foreground">
											{t("recurring.columns.account")}
										</TableHead>
										<TableHead
											scope="col"
											className="type-overline text-right text-muted-foreground"
										>
											{t("recurring.columns.amount")}
										</TableHead>
										<TableHead scope="col" className="type-overline text-muted-foreground">
											{t("recurring.columns.next")}
										</TableHead>
										<TableHead scope="col" className="type-overline text-muted-foreground">
											{t("recurring.columns.status")}
										</TableHead>
										{admin && (
											<TableHead scope="col">
												<span className="sr-only">{t("recurring.columns.actions")}</span>
											</TableHead>
										)}
									</TableRow>
								</TableHeader>
								<TableBody>
									{list.map((item) => (
										<TableRow key={item.id} className="h-14 border-line hover:bg-hover">
											<TableCell className="max-w-72">
												<span className="flex min-w-0 items-center gap-3">
													<TintedIcon
														subject={{ kind: "merchant", name: nameOf(item) }}
														size="md"
													/>
													<span className="truncate font-medium">{nameOf(item)}</span>
												</span>
											</TableCell>
											<TableCell className="max-w-56">
												<span className="flex min-w-0 items-center gap-2">
													<TintedIcon
														subject={{ kind: "account", type: item.accountType }}
														size="sm"
													/>
													<span className="truncate">{item.accountName}</span>
												</span>
											</TableCell>
											<TableCell className="text-right">
												<RecurringAmount item={item} />
											</TableCell>
											<TableCell className="whitespace-nowrap">
												{item.currentOccurrence === null ? (
													formatTableDate(item.nextExpectedDate)
												) : (
													<CurrentOccurrence occurrence={item.currentOccurrence} />
												)}
											</TableCell>
											<TableCell>
												<span className="flex items-center gap-1.5">
													<StatusBadge status={BADGES[item.status]} />
													{item.manual && <StatusBadge status="recurringManual" />}
												</span>
											</TableCell>
											{admin && (
												<TableCell className="w-10 text-right">
													<RecurringActions
														item={item}
														onEdit={() => openBill({ mode: "edit", series: item })}
														disabled={setStatus.isPending || remove.isPending}
														onToggle={() => toggle(item)}
														onDelete={() => {
															setDeleting(item);
															setDeleteOpen(true);
														}}
													/>
												</TableCell>
											)}
										</TableRow>
									))}
								</TableBody>
							</Table>
						</InsetGroup>
					</ListCard>
				))}

			{subject !== null && (
				<BillDialog
					key={subject.key}
					open={billOpen}
					onOpenChange={setBillOpen}
					subject={subject.of}
					accounts={offered}
				/>
			)}

			{deleting !== null && (
				<ConfirmDialog
					open={deleteOpen}
					onOpenChange={setDeleteOpen}
					title={t("recurring.deleteDialog.title", { name: nameOf(deleting) })}
					// A manual series is deleted, so detection may find its pattern again;
					// a detected one is ended and never offered again.
					description={t(
						deleting.manual
							? "recurring.deleteDialog.descriptionManual"
							: "recurring.deleteDialog.description",
					)}
					confirmLabel={t("recurring.deleteDialog.action")}
					destructive
					pending={remove.isPending}
					onConfirm={() =>
						remove.mutate(deleting.id, {
							onSuccess: () => {
								toast.success(t("recurring.deleteDialog.deleted"));
								setDeleteOpen(false);
							},
							onError: (error) => {
								showErrorToast(errorCodeOf(error));
								setDeleteOpen(false);
							},
						})
					}
				/>
			)}
		</Page>
	);
}
