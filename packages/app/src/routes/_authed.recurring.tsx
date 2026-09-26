import type { RecurringData, RecurringMove } from "@/hooks/useRecurring";

import { createFileRoute } from "@tanstack/react-router";
import { EllipsisIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Money } from "@/components/Money";
import { Badge } from "@/components/ui/badge";
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

// `dismissed` never reaches the list; mapped so every status the API types has a badge.
const BADGES = {
	detected: { variant: "outline", className: "" },
	confirmed: { variant: "secondary", className: "" },
	inactive: { variant: "outline", className: "text-muted-foreground" },
	dismissed: { variant: "outline", className: "text-muted-foreground" },
} as const satisfies Record<RecurringData["status"], { variant: string; className: string }>;

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
		<div className="flex w-full max-w-[1200px] flex-col gap-6 p-6">
			<div className="flex items-center justify-between gap-4">
				<h1 className="text-3xl font-semibold tracking-tight">{t("recurring.title")}</h1>
				<Button variant="outline" disabled={detect.isPending} onClick={runDetection}>
					{t("recurring.detect")}
				</Button>
			</div>
			<p className="max-w-2xl text-sm text-muted-foreground">{t("recurring.description")}</p>

			{recurring.isPending && (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-9 w-full" />
				</div>
			)}

			{recurring.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-8">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(recurring.error)}`)}</p>
					<Button variant="outline" onClick={() => void recurring.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{recurring.data !== undefined && list.length === 0 && (
				<p className="text-sm text-muted-foreground">{t("recurring.empty")}</p>
			)}

			{list.length > 0 && (
				<Table aria-label={t("recurring.title")}>
					<TableHeader>
						<TableRow>
							<TableHead scope="col">{t("recurring.columns.name")}</TableHead>
							<TableHead scope="col">{t("recurring.columns.account")}</TableHead>
							<TableHead scope="col" className="text-right">
								{t("recurring.columns.amount")}
							</TableHead>
							<TableHead scope="col">{t("recurring.columns.next")}</TableHead>
							<TableHead scope="col">{t("recurring.columns.status")}</TableHead>
							<TableHead scope="col">
								<span className="sr-only">{t("recurring.columns.actions")}</span>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{list.map((item) => (
							<TableRow key={item.id} className="h-9">
								<TableCell className="max-w-72 truncate">{nameOf(item)}</TableCell>
								<TableCell className="max-w-56 truncate">{item.accountName}</TableCell>
								<TableCell className="text-right">
									<Money amount={item.amount} currency={item.currency} signed />
								</TableCell>
								<TableCell className="whitespace-nowrap">
									{formatTableDate(item.nextExpectedDate)}
								</TableCell>
								<TableCell>
									<span className="flex items-center gap-1.5">
										<Badge
											variant={BADGES[item.status].variant}
											className={BADGES[item.status].className}
										>
											{t(`recurring.statuses.${item.status}`)}
										</Badge>
										{item.manual && <Badge variant="outline">{t("recurring.manual")}</Badge>}
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
			)}

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
		</div>
	);
}
