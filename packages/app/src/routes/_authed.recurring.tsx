import type { Status } from "@/components/StatusBadge";
import type { RecurringData } from "@/hooks/useRecurring";

import { createFileRoute } from "@tanstack/react-router";
import { EllipsisIcon, RepeatIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { formatMoney, toMinorUnits } from "@archant/data/money";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { GROUP_TABLE_INSET, InsetGroup } from "@/components/InsetGroup";
import { ListCard } from "@/components/ListCard";
import { Money } from "@/components/Money";
import { Page } from "@/components/Page";
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
import { useIsAdmin } from "@/hooks/useIsAdmin";
import {
	useCleanupRecurring,
	useDeleteRecurring,
	useDetectRecurring,
	useRecurring,
	useSetRecurringStatus,
} from "@/hooks/useRecurring";
import { errorCodeOf } from "@/lib/api";
import { formatTableDate } from "@/lib/balance-change";
import { showErrorToast } from "@/lib/error-toast";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/recurring")({
	component: RecurringPage,
});

const nameOf = (item: RecurringData) => item.merchantName ?? item.label;

// Suggestions sit in their own strip and ended series never reach the page,
// so only the two statuses the list shows have a badge.
const BADGES = {
	active: "recurringActive",
	inactive: "recurringInactive",
} as const satisfies Partial<Record<RecurringData["status"], Status>>;

type Listed = RecurringData & { status: keyof typeof BADGES };

const isListed = (item: RecurringData): item is Listed => item.status in BADGES;

/**
 * The amount, or the band it moved within once it varies, magnitudes
 * ascending: Sure's « varie de 571,22 € à 571,36 € ».
 */
function RecurringAmount({ item }: { item: RecurringData }) {
	const { t } = useTranslation();
	const { expectedAmountMin: min, expectedAmountMax: max } = item;

	if (min === null || max === null || min === max) {
		return <Money amount={item.amount} currency={item.currency} signed />;
	}

	const [low, high] = [Math.abs(min), Math.abs(max)].toSorted((a, b) => a - b);
	// The single amount's convention: an inflow takes a plus sign and the income colour.
	const inflow = item.amount > 0;
	const format = (amount: number) =>
		`${inflow ? "+" : ""}${formatMoney({ amount: toMinorUnits(amount), currency: item.currency })}`;

	return (
		<span
			className={cn(
				"font-medium whitespace-nowrap tabular-nums",
				inflow ? "text-money-income" : "text-money-expense",
			)}
		>
			{t("recurring.amountRange", { min: format(low!), max: format(high!) })}
		</span>
	);
}

/** An active or inactive row's menu: pause or resume, and delete. */
function RecurringActions({
	item,
	onToggle,
	onDelete,
	disabled,
}: {
	item: Listed;
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
 * Sure's « Nouvelles factures possibles »: what detection found and the owner
 * has not settled, each with how often it was seen. A viewer reads it without
 * its two buttons.
 */
function Suggestions({ items, admin }: { items: readonly RecurringData[]; admin: boolean }) {
	const { t } = useTranslation();
	const setStatus = useSetRecurringStatus();

	const settle = (item: RecurringData, status: "active" | "ended") =>
		setStatus.mutate(
			{ id: item.id, status },
			{
				onSuccess: () =>
					toast.success(
						t(status === "active" ? "recurring.suggested.added" : "recurring.suggested.dismissed"),
					),
				onError: (error) => showErrorToast(errorCodeOf(error)),
			},
		);

	return (
		<ListCard>
			<InsetGroup level={2} title={t("recurring.suggested.title")} count={items.length}>
				<Table aria-label={t("recurring.suggested.title")} className={GROUP_TABLE_INSET}>
					<TableHeader>
						<TableRow className="border-line hover:bg-transparent">
							<TableHead scope="col" className="type-overline text-muted-foreground">
								{t("recurring.columns.name")}
							</TableHead>
							<TableHead scope="col" className="type-overline text-right text-muted-foreground">
								{t("recurring.columns.amount")}
							</TableHead>
							{admin && (
								<TableHead scope="col">
									<span className="sr-only">{t("recurring.columns.actions")}</span>
								</TableHead>
							)}
						</TableRow>
					</TableHeader>
					<TableBody>
						{items.map((item) => (
							<TableRow key={item.id} className="h-14 border-line hover:bg-hover">
								<TableCell className="w-full max-w-0">
									<span className="flex min-w-0 items-center gap-3">
										<TintedIcon subject={{ kind: "merchant", name: nameOf(item) }} size="md" />
										{/* Under the name, as Sure's `_suggested_series`: a column of its own
										    pushed « Ajouter la facture » out of the card at 1280 px. */}
										<span className="flex min-w-0 flex-col">
											<span className="truncate font-medium">{nameOf(item)}</span>
											<span className="truncate text-xs text-muted-foreground">
												{t("recurring.suggested.seen", { count: item.occurrenceCount })}
											</span>
										</span>
									</span>
								</TableCell>
								<TableCell className="text-right">
									<RecurringAmount item={item} />
								</TableCell>
								{admin && (
									<TableCell className="text-right">
										<span className="flex justify-end gap-2">
											<Button
												variant="outline"
												size="sm"
												disabled={setStatus.isPending}
												onClick={() => settle(item, "ended")}
											>
												{t("recurring.suggested.dismiss")}
											</Button>
											<Button
												size="sm"
												disabled={setStatus.isPending}
												onClick={() => settle(item, "active")}
											>
												{t("recurring.suggested.confirm")}
											</Button>
										</span>
									</TableCell>
								)}
							</TableRow>
						))}
					</TableBody>
				</Table>
			</InsetGroup>
		</ListCard>
	);
}

/**
 * Sure's recurring page: the suggestions detection found above the active
 * and inactive series, each by next expected date. Ended series are gone from
 * here and from detection. A viewer reads them, without « Détecter »,
 * « Nettoyer les obsolètes », a suggestion's buttons or a row's menu.
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
				// An empty page offers its own « Détecter », the one way forward.
				!admin || (recurring.data !== undefined && all.length === 0) ? undefined : (
					<>
						<Button variant="outline" disabled={cleanup.isPending} onClick={runCleanup}>
							{t("recurring.cleanup")}
						</Button>
						<Button variant="outline" disabled={detect.isPending} onClick={runDetection}>
							{t("recurring.detect")}
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

			{suggestions.length > 0 && <Suggestions items={suggestions} admin={admin} />}

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
												{formatTableDate(item.nextExpectedDate)}
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
