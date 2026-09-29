import type { Status } from "@/components/StatusBadge";
import type { RecurringData, RecurringMove } from "@/hooks/useRecurring";

import { createFileRoute } from "@tanstack/react-router";
import { EllipsisIcon, RepeatIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { InsetGroup } from "@/components/InsetGroup";
import { GROUP_TABLE_INSET, ListCard } from "@/components/ListCard";
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
import { useDetectRecurring, useRecurring, useSetRecurringStatus } from "@/hooks/useRecurring";
import { errorCodeOf } from "@/lib/api";
import { formatTableDate } from "@/lib/balance-change";
import { showErrorToast } from "@/lib/error-toast";

export const Route = createFileRoute("/_authed/recurring")({
	component: RecurringPage,
});

const nameOf = (item: RecurringData) => item.merchantName ?? item.label;

// `dismissed` never reaches the list, so it has no badge.
const BADGES = {
	detected: "recurringDetected",
	confirmed: "recurringConfirmed",
	inactive: "recurringInactive",
} as const satisfies Record<Exclude<RecurringData["status"], "dismissed">, Status>;

/** The row's menu, one entry per move its status allows. */
function RecurringActions({
	item,
	onSet,
	onDismiss,
	disabled,
}: {
	item: RecurringData;
	onSet: (status: Exclude<RecurringMove, "dismissed">) => void;
	onDismiss: () => void;
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
				{item.status === "confirmed" ? (
					<DropdownMenuItem disabled={disabled} onSelect={() => onSet("inactive")}>
						{t("recurring.deactivate")}
					</DropdownMenuItem>
				) : (
					<DropdownMenuItem disabled={disabled} onSelect={() => onSet("confirmed")}>
						{t("recurring.confirm")}
					</DropdownMenuItem>
				)}
				<DropdownMenuItem variant="destructive" disabled={disabled} onSelect={onDismiss}>
					{t("recurring.dismiss")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * The detected, confirmed and inactive patterns, current ones first, each by
 * next expected date. Dismissed ones are gone from here and from detection.
 */
function RecurringPage() {
	const { t } = useTranslation();
	const recurring = useRecurring();
	const detect = useDetectRecurring();
	const setStatus = useSetRecurringStatus();
	// Kept while the dialog closes, so its title does not vanish mid-animation.
	const [dismissing, setDismissing] = useState<RecurringData | null>(null);
	const [dismissOpen, setDismissOpen] = useState(false);
	const list = recurring.data ?? [];

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("recurring.title"), app: t("app.name") });
	}, [t]);

	const runDetection = () =>
		detect.mutate(undefined, {
			onSuccess: ({ detected }) => toast.success(t("recurring.detected", { count: detected })),
			onError: (error) => showErrorToast(errorCodeOf(error)),
		});

	const move = (item: RecurringData, status: Exclude<RecurringMove, "dismissed">) =>
		setStatus.mutate(
			{ id: item.id, status },
			{
				onSuccess: () =>
					toast.success(
						t(status === "confirmed" ? "recurring.confirmed" : "recurring.deactivated"),
					),
				onError: (error) => showErrorToast(errorCodeOf(error)),
			},
		);

	return (
		<Page
			title={t("recurring.title")}
			description={t("recurring.description")}
			actions={
				// An empty list offers its own, the one way forward.
				recurring.data !== undefined && list.length === 0 ? undefined : (
					<Button variant="outline" disabled={detect.isPending} onClick={runDetection}>
						{t("recurring.detect")}
					</Button>
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

			{recurring.data !== undefined &&
				(list.length === 0 ? (
					<EmptyState
						level={2}
						icon={{ kind: "transfer", icon: RepeatIcon }}
						title={t("recurring.empty.title")}
						description={t("recurring.empty.description")}
						action={
							<Button disabled={detect.isPending} onClick={runDetection}>
								{t("recurring.empty.action")}
							</Button>
						}
					/>
				) : (
					<ListCard>
						<InsetGroup level={2} title={t("recurring.list")} count={list.length}>
							<Table aria-label={t("recurring.title")} className={GROUP_TABLE_INSET}>
								<TableHeader>
									<TableRow className="border-line hover:bg-transparent">
										<TableHead scope="col" className="overline text-muted-foreground">
											{t("recurring.columns.name")}
										</TableHead>
										<TableHead scope="col" className="overline text-muted-foreground">
											{t("recurring.columns.account")}
										</TableHead>
										<TableHead scope="col" className="overline text-right text-muted-foreground">
											{t("recurring.columns.amount")}
										</TableHead>
										<TableHead scope="col" className="overline text-muted-foreground">
											{t("recurring.columns.next")}
										</TableHead>
										<TableHead scope="col" className="overline text-muted-foreground">
											{t("recurring.columns.status")}
										</TableHead>
										<TableHead scope="col">
											<span className="sr-only">{t("recurring.columns.actions")}</span>
										</TableHead>
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
												<Money amount={item.amount} currency={item.currency} signed />
											</TableCell>
											<TableCell className="whitespace-nowrap">
												{formatTableDate(item.nextExpectedDate)}
											</TableCell>
											<TableCell>
												<span className="flex items-center gap-1.5">
													{item.status !== "dismissed" && (
														<StatusBadge status={BADGES[item.status]} />
													)}
													{item.manual && <StatusBadge status="recurringManual" />}
												</span>
											</TableCell>
											<TableCell className="w-10 text-right">
												<RecurringActions
													item={item}
													disabled={setStatus.isPending}
													onSet={(status) => move(item, status)}
													onDismiss={() => {
														setDismissing(item);
														setDismissOpen(true);
													}}
												/>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</InsetGroup>
					</ListCard>
				))}

			{dismissing !== null && (
				<ConfirmDialog
					open={dismissOpen}
					onOpenChange={setDismissOpen}
					title={t("recurring.dismissDialog.title", { name: nameOf(dismissing) })}
					description={t("recurring.dismissDialog.description")}
					confirmLabel={t("recurring.dismissDialog.action")}
					destructive
					pending={setStatus.isPending}
					onConfirm={() =>
						setStatus.mutate(
							{ id: dismissing.id, status: "dismissed" },
							{
								onSuccess: () => {
									toast.success(t("recurring.dismissDialog.dismissed"));
									setDismissOpen(false);
								},
								onError: (error) => {
									showErrorToast(errorCodeOf(error));
									setDismissOpen(false);
								},
							},
						)
					}
				/>
			)}
		</Page>
	);
}
