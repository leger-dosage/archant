import type { ImportGroupsData, ImportPreviewData } from "@/hooks/useImports";
import type { ImportGroup } from "@/lib/import-preview";
import type { DragEvent } from "react";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { CurrencyCode } from "@archant/data/money";
import { formatMoney } from "@archant/data/money";

import { Money } from "@/components/Money";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConfirmImport, usePreviewImport, useUploadImport } from "@/hooks/useImports";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { ApiError, errorCodeOf } from "@/lib/api";
import { formatShortDate, formatSignedMoney, formatTableDate } from "@/lib/balance-change";
import {
	IMPORT_GROUPS,
	canConfirm,
	countsOf,
	firstTab,
	importedCount,
	isBalanceOnly,
	isNothingNew,
} from "@/lib/import-preview";
import { cn } from "@/lib/utils";

// Below this width the preview's five tabs and three columns do not fit
// (EXPERIENCE.md): the dialog says so instead.
const DESKTOP_QUERY = "(min-width: 768px)";

export type ImportAccount = { id: string; currency: CurrencyCode; openingDate: string };

type LineGroup = Exclude<ImportGroup, "rejected">;

function Steps({ current }: { current: "file" | "preview" }) {
	const { t } = useTranslation();

	return (
		<ol aria-label={t("imports.steps.label")} className="flex gap-4 text-sm">
			{(["file", "preview"] as const).map((step, index) => (
				<li
					key={step}
					aria-current={step === current ? "step" : undefined}
					className={cn(
						"flex items-center gap-2 text-muted-foreground",
						step === current && "font-medium text-foreground",
					)}
				>
					<span className="flex size-5 items-center justify-center rounded-full border text-xs tabular-nums">
						{index + 1}
					</span>
					{t(`imports.steps.${step}`)}
				</li>
			))}
		</ol>
	);
}

function LinesTable({ lines, currency }: { lines: ImportGroupsData[LineGroup]; currency: string }) {
	const { t } = useTranslation();

	if (lines.length === 0) {
		return <p className="py-6 text-muted-foreground">{t("imports.empty")}</p>;
	}

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead scope="col">{t("imports.columns.date")}</TableHead>
					<TableHead scope="col">{t("imports.columns.label")}</TableHead>
					<TableHead scope="col" className="text-right">
						{t("imports.columns.amount")}
					</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{lines.map((line) => (
					<TableRow key={line.ref}>
						<TableCell className="whitespace-nowrap">{formatShortDate(line.date)}</TableCell>
						<TableCell className="max-w-[28ch] truncate" title={line.label}>
							{line.label}
						</TableCell>
						<TableCell className="text-right">
							<Money amount={line.amount} currency={currency} signed />
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

function RejectedTable({
	lines,
	currency,
}: {
	lines: ImportGroupsData["rejected"];
	currency: string;
}) {
	const { t } = useTranslation();

	if (lines.length === 0) {
		return <p className="py-6 text-muted-foreground">{t("imports.empty")}</p>;
	}

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead scope="col">{t("imports.columns.line")}</TableHead>
					<TableHead scope="col" className="text-right">
						{t("imports.columns.amount")}
					</TableHead>
					<TableHead scope="col">{t("imports.columns.reason")}</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{lines.map((item) => (
					<TableRow key={`${item.line === null ? "source" : "ledger"}-${item.ref}`}>
						<TableCell className="max-w-[28ch] truncate">
							{item.line === null
								? t("imports.fileLine", { number: Number(item.ref) + 1 })
								: `${formatShortDate(item.line.date)} · ${item.line.label}`}
						</TableCell>
						<TableCell className="text-right">
							{item.line !== null && <Money amount={item.line.amount} currency={currency} signed />}
						</TableCell>
						<TableCell>{t(`imports.reasons.${item.reason}`)}</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

type StatementBalanceData = NonNullable<ImportPreviewData["statementBalance"]>;

/**
 * What confirming does with the file's closing balance. Amounts are stored
 * balances (AD-5): a card shows its debt as positive.
 */
function StatementBalanceNote({
	outcome,
	currency,
}: {
	outcome: StatementBalanceData;
	currency: string;
}) {
	const { t } = useTranslation();
	const date = formatTableDate(outcome.date);
	const amount = formatMoney({ amount: outcome.balance, currency });
	let text: string;

	if (outcome.status === "recorded") {
		text = t("imports.balance.recorded", { amount, date });
	} else if (outcome.status === "present") {
		text = t("imports.balance.present", { amount, date });
	} else if (outcome.status === "kept") {
		text = t("imports.balance.kept", {
			amount,
			date,
			recorded: formatMoney({ amount: outcome.recorded, currency }),
			// Signed, as the Soldes tab shows a gap.
			gap: formatSignedMoney(outcome.gap, currency),
		});
	} else {
		text = t("imports.balance.skipped", {
			date,
			reason: t(`imports.balance.reasons.${outcome.reason}`),
		});
	}

	return <p className="rounded-md border p-3">{text}</p>;
}

type PreviewProps = {
	preview: ImportPreviewData;
	currency: string;
	/** The account's opening date today, whose end-of-day balance a move keeps. */
	openingDate: string;
	stale: boolean;
	moving: boolean;
	onMoveOpening: (date: string) => void;
};

function Preview({ preview, currency, openingDate, stale, moving, onMoveOpening }: PreviewProps) {
	const { t } = useTranslation();
	const counts = countsOf(preview.groups);
	const [tab, setTab] = useState<string>(() => firstTab(counts));

	return (
		<div className="flex min-w-0 flex-col gap-3">
			<p className="truncate text-muted-foreground">{preview.fileName}</p>

			{stale && (
				<p role="alert" className="rounded-md border border-destructive/50 p-3 text-destructive">
					{t("errors.IMPORT_PREVIEW_STALE")}
				</p>
			)}

			{preview.opening !== null && (
				<p className="rounded-md border p-3">
					{t("imports.openingMoved", {
						date: formatTableDate(preview.opening.date),
						amount: formatMoney({ amount: preview.opening.balance, currency }),
						previous: formatTableDate(openingDate),
					})}
				</p>
			)}

			{preview.statementBalance !== null && (
				<StatementBalanceNote outcome={preview.statementBalance} currency={currency} />
			)}

			<Tabs value={tab} onValueChange={setTab} className="gap-3">
				<TabsList aria-label={t("imports.groups.label")} className="w-full">
					{IMPORT_GROUPS.map((group) => (
						<TabsTrigger key={group} value={group}>
							{t(`imports.groups.${group}`)}{" "}
							<span className="text-muted-foreground tabular-nums">{counts[group]}</span>
						</TabsTrigger>
					))}
				</TabsList>
				<div className="max-h-[50vh] overflow-y-auto">
					{(["created", "present", "matched", "duplicates"] as const).map((group) => (
						<TabsContent key={group} value={group} className="flex flex-col gap-2">
							{(group === "matched" || group === "duplicates") && counts[group] > 0 && (
								<p className="text-muted-foreground">{t(`imports.hints.${group}`)}</p>
							)}
							<LinesTable lines={preview.groups[group]} currency={currency} />
						</TabsContent>
					))}
					<TabsContent value="rejected" className="flex flex-col items-start gap-2">
						{preview.openingSuggestion !== null && preview.opening === null && (
							<Button
								variant="outline"
								disabled={moving}
								onClick={() => {
									if (preview.openingSuggestion !== null) {
										onMoveOpening(preview.openingSuggestion);
									}
								}}
							>
								{t("imports.moveOpening", { date: formatTableDate(preview.openingSuggestion) })}
							</Button>
						)}
						<RejectedTable lines={preview.groups.rejected} currency={currency} />
					</TabsContent>
				</div>
			</Tabs>
		</div>
	);
}

type ImportFlowProps = { account: ImportAccount; onClose: () => void };

function ImportFlow({ account, onClose }: ImportFlowProps) {
	const { t } = useTranslation();
	const upload = useUploadImport(account.id);
	const previewAgain = usePreviewImport();
	const confirm = useConfirmImport(account.id);
	const [preview, setPreview] = useState<ImportPreviewData | null>(null);
	const [stale, setStale] = useState(false);
	const [unreadable, setUnreadable] = useState(false);
	const [dragging, setDragging] = useState(false);
	// A fresh tab choice for each new preview.
	const [version, setVersion] = useState(0);

	const show = (next: ImportPreviewData, isStale: boolean) => {
		setPreview(next);
		setStale(isStale);
		setVersion((current) => current + 1);
	};

	const read = async (file: File | undefined) => {
		// A second file while the first uploads would race it for the preview.
		if (file === undefined || upload.isPending) {
			return;
		}

		setUnreadable(false);

		try {
			show(await upload.mutateAsync(file), false);
		} catch (error) {
			if (errorCodeOf(error) === "INVALID_IMPORT_FILE") {
				setUnreadable(true);
			} else {
				toast.error(t(`errors.${errorCodeOf(error)}`));
			}
		}
	};

	const moveOpening = async (date: string) => {
		if (preview === null) {
			return;
		}

		try {
			show(
				await previewAgain.mutateAsync({ id: preview.id, input: { moveOpeningDate: date } }),
				false,
			);
		} catch (error) {
			toast.error(t(`errors.${errorCodeOf(error)}`));
		}
	};

	const submit = async () => {
		if (preview === null) {
			return;
		}

		// Confirm writes what the preview showed, or answers stale.
		const balanceOnly = isBalanceOnly(
			countsOf(preview.groups),
			preview.statementBalance?.status ?? null,
		);

		try {
			const { counts } = await confirm.mutateAsync(preview.id);
			const imported = t("imports.imported", { count: importedCount(counts) });

			toast.success(
				balanceOnly
					? t("imports.toastBalance")
					: counts.present === 0
						? t("imports.toastImported", { imported })
						: t("imports.toast", {
								imported,
								present: t("imports.present", { count: counts.present }),
							}),
			);
			onClose();
		} catch (error) {
			if (error instanceof ApiError && error.code === "IMPORT_PREVIEW_STALE") {
				// The account changed under the preview: show what confirming would
				// now do, and let the user decide again.
				try {
					show(
						await previewAgain.mutateAsync({
							id: preview.id,
							input: { moveOpeningDate: preview.opening?.date ?? null },
						}),
						true,
					);
				} catch (again) {
					toast.error(t(`errors.${errorCodeOf(again)}`));
				}
			} else {
				toast.error(t(`errors.${errorCodeOf(error)}`));
			}
		}
	};

	const onDrop = (event: DragEvent<HTMLDivElement>) => {
		event.preventDefault();
		setDragging(false);
		void read(event.dataTransfer.files[0]);
	};

	const counts = preview === null ? null : countsOf(preview.groups);
	const count = counts === null ? 0 : importedCount(counts);
	const balanceStatus = preview?.statementBalance?.status ?? null;

	return (
		<>
			<Steps current={preview === null ? "file" : "preview"} />

			{/* Outside the preview, which remounts with each new one: a live region
			    must exist before its text changes for screen readers to announce it. */}
			<p role="status" className="sr-only">
				{upload.isPending
					? t("imports.reading")
					: preview === null
						? ""
						: t("imports.summary", countsOf(preview.groups))}
			</p>

			{preview === null ? (
				<div
					onDragOver={(event) => {
						event.preventDefault();
						setDragging(true);
					}}
					onDragLeave={() => setDragging(false)}
					onDrop={onDrop}
					className={cn(
						"flex flex-col gap-3 rounded-lg border border-dashed p-6",
						dragging && "border-primary bg-muted",
					)}
				>
					<p className="text-muted-foreground">{t("imports.drop")}</p>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="import-file">{t("imports.file")}</Label>
						<Input
							id="import-file"
							type="file"
							accept=".ofx,.qfx"
							disabled={upload.isPending}
							aria-invalid={unreadable}
							{...(unreadable ? { "aria-describedby": "import-file-error" } : {})}
							onChange={(event) => {
								void read(event.target.files?.[0]);
								// The same file chosen again must fire a change.
								event.target.value = "";
							}}
						/>
					</div>
					{upload.isPending && <p>{t("imports.reading")}</p>}
					{unreadable && (
						<p id="import-file-error" role="alert" className="text-destructive">
							{t("errors.INVALID_IMPORT_FILE")}
						</p>
					)}
				</div>
			) : (
				<Preview
					key={version}
					preview={preview}
					currency={account.currency}
					openingDate={account.openingDate}
					stale={stale}
					moving={previewAgain.isPending}
					onMoveOpening={(date) => void moveOpening(date)}
				/>
			)}

			<DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
				<p className="text-muted-foreground">
					{counts !== null && isNothingNew(counts, balanceStatus) ? t("imports.nothingNew") : ""}
				</p>
				<div className="flex justify-end gap-2">
					<Button type="button" variant="outline" onClick={onClose}>
						{t("common.cancel")}
					</Button>
					{preview !== null && (
						<Button
							type="button"
							disabled={
								counts === null ||
								!canConfirm(counts, balanceStatus) ||
								confirm.isPending ||
								previewAgain.isPending
							}
							onClick={() => void submit()}
						>
							{counts !== null && isBalanceOnly(counts, balanceStatus)
								? t("imports.confirmBalance")
								: t("imports.confirm", { count })}
						</Button>
					)}
				</div>
			</DialogFooter>
		</>
	);
}

type ImportDialogProps = {
	account: ImportAccount;
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

/**
 * Imports a bank file into the account: Fichier, then Aperçu (EXPERIENCE.md).
 * Nothing is written before « Importer N opérations ».
 */
export function ImportDialog({ account, open, onOpenChange }: ImportDialogProps) {
	const { t } = useTranslation();
	const desktop = useMediaQuery(DESKTOP_QUERY);
	const [session, setSession] = useState(0);
	const [wasOpen, setWasOpen] = useState(open);

	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) {
			setSession((current) => current + 1);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className={cn(desktop && "sm:max-w-3xl")}>
				<DialogHeader>
					<DialogTitle>{t("imports.title")}</DialogTitle>
					<DialogDescription>
						{desktop ? t("imports.description") : t("imports.mobile")}
					</DialogDescription>
				</DialogHeader>
				{desktop ? (
					// A fresh flow each time the dialog opens.
					<ImportFlow key={session} account={account} onClose={() => onOpenChange(false)} />
				) : (
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("common.close")}
						</Button>
					</DialogFooter>
				)}
			</DialogContent>
		</Dialog>
	);
}
