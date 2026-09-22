import type { ImportHistoryItemData } from "@/hooks/useImports";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useRevertImport } from "@/hooks/useImports";
import { errorCodeOf } from "@/lib/api";
import { formatShortDate } from "@/lib/balance-change";
import { toIsoDate } from "@/lib/dates";
import { showErrorToast } from "@/lib/error-toast";

type TFunction = ReturnType<typeof useTranslation>["t"];

// The API stores instants; the user reads the day they did it, in their zone.
const dayOf = (epochMs: number) => formatShortDate(toIsoDate(new Date(epochMs)));

type Removable = NonNullable<ImportHistoryItemData["removable"]>;

/** What the confirmation states will go, from what a revert would delete now. */
function describeRemoval(removable: Removable, t: TFunction) {
	const transactions = t("imports.history.confirm.transactions", {
		count: removable.transactions,
	});
	const snapshot = t("imports.history.confirm.snapshot", { count: removable.snapshot });

	if (removable.transactions > 0 && removable.snapshot > 0) {
		return {
			description: t("imports.history.confirm.both", { transactions, snapshot }),
			confirmLabel: t("imports.history.confirm.deleteTransactions", {
				count: removable.transactions,
			}),
			destructive: true,
		};
	}

	if (removable.transactions > 0) {
		return {
			description: t("imports.history.confirm.onlyTransactions", {
				transactions,
				count: removable.transactions,
			}),
			confirmLabel: t("imports.history.confirm.deleteTransactions", {
				count: removable.transactions,
			}),
			destructive: true,
		};
	}

	if (removable.snapshot > 0) {
		return {
			description: t("imports.history.confirm.onlySnapshot", {
				snapshot,
				count: removable.snapshot,
			}),
			confirmLabel: t("imports.history.confirm.deleteSnapshot"),
			destructive: true,
		};
	}

	return {
		description: t("imports.history.confirm.nothing"),
		confirmLabel: t("imports.history.revert"),
		destructive: false,
	};
}

type ImportHistoryProps = {
	accountId: string;
	items: readonly ImportHistoryItemData[];
};

/**
 * One account's confirmed and reverted imports, latest first, with the counts
 * confirm stored. A confirmed one can be reverted, after a confirmation that
 * states what goes.
 */
export function ImportHistory({ accountId, items }: ImportHistoryProps) {
	const { t } = useTranslation();
	const revertImport = useRevertImport(accountId);
	const [target, setTarget] = useState<ImportHistoryItemData | null>(null);
	// Kept while the dialog closes, so its text does not blank out mid-animation.
	const [shown, setShown] = useState<ImportHistoryItemData | null>(null);
	const removal =
		shown?.removable === null || shown === null ? null : describeRemoval(shown.removable, t);

	const open = (item: ImportHistoryItemData) => {
		setShown(item);
		setTarget(item);
	};

	const revert = async (item: ImportHistoryItemData) => {
		try {
			const { removed } = await revertImport.mutateAsync(item.id);
			toast.success(
				removed.transactions === 0
					? t("imports.history.revertedNothing")
					: t("imports.history.reverted", { count: removed.transactions }),
			);
			setTarget(null);
		} catch (error) {
			showErrorToast(errorCodeOf(error));
			setTarget(null);
		}
	};

	return (
		<>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead scope="col">{t("imports.history.columns.date")}</TableHead>
						<TableHead scope="col">{t("imports.history.columns.file")}</TableHead>
						<TableHead scope="col">{t("imports.history.columns.format")}</TableHead>
						<TableHead scope="col" className="text-right">
							{t("imports.history.columns.created")}
						</TableHead>
						<TableHead scope="col" className="text-right">
							{t("imports.history.columns.matched")}
						</TableHead>
						<TableHead scope="col" className="text-right">
							{t("imports.history.columns.present")}
						</TableHead>
						<TableHead scope="col" className="text-right">
							{t("imports.history.columns.rejected")}
						</TableHead>
						<TableHead scope="col">
							<span className="sr-only">{t("imports.history.columns.action")}</span>
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{items.map((item) => {
						const date = dayOf(item.confirmedAt);

						return (
							<TableRow key={item.id} className="h-9">
								<TableCell className="whitespace-nowrap">{date}</TableCell>
								<TableCell className="max-w-64 truncate">{item.fileName}</TableCell>
								<TableCell>{item.source.toUpperCase()}</TableCell>
								<TableCell className="text-right tabular-nums">
									{item.counts.created + item.counts.duplicates}
								</TableCell>
								<TableCell className="text-right tabular-nums">{item.counts.matched}</TableCell>
								<TableCell className="text-right tabular-nums">{item.counts.present}</TableCell>
								<TableCell className="text-right tabular-nums">{item.counts.rejected}</TableCell>
								<TableCell className="text-right whitespace-nowrap">
									{item.revertedAt === null ? (
										<Button
											variant="outline"
											size="sm"
											aria-label={t("imports.history.revertLabel", {
												fileName: item.fileName,
												date,
											})}
											onClick={() => open(item)}
										>
											{t("imports.history.revert")}
										</Button>
									) : (
										<span className="text-sm text-muted-foreground">
											{t("imports.history.revertedOn", { date: dayOf(item.revertedAt) })}
										</span>
									)}
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>

			<ConfirmDialog
				open={target !== null}
				onOpenChange={(next) => {
					// The revert commits whatever the dialog does; it closes once it has.
					if (!next && !revertImport.isPending) {
						setTarget(null);
					}
				}}
				title={t("imports.history.confirm.title", { fileName: shown?.fileName ?? "" })}
				description={removal?.description ?? ""}
				confirmLabel={removal?.confirmLabel ?? t("imports.history.revert")}
				destructive={removal?.destructive ?? false}
				pending={revertImport.isPending}
				onConfirm={() => {
					if (target !== null) {
						void revert(target);
					}
				}}
			/>
		</>
	);
}

export function ImportHistorySkeleton() {
	return (
		<div className="flex flex-col gap-2" aria-hidden="true">
			{[0, 1, 2].map((row) => (
				<Skeleton key={row} className="h-9 w-full" />
			))}
		</div>
	);
}
