import type { TransferDetailsData } from "@/hooks/useTransfers";
import type { ReactNode } from "react";

import { Link } from "@tanstack/react-router";
import { ArrowLeftRightIcon, ChevronRightIcon, Repeat } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { NOTES_MAX_LENGTH } from "@archant/api/schemas/transactions";
import { classificationOf } from "@archant/data/account-types";
import { toMinorUnits } from "@archant/data/money";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Money } from "@/components/Money";
import { TintedIcon } from "@/components/TintedIcon";
import { CategoryField, TagsField } from "@/components/TransactionFields";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useMarkTransferRecurring, useRecurringEnabled } from "@/hooks/useRecurring";
import {
	useSetTransferTags,
	useTransfer,
	useUnmatchTransfer,
	useUpdateTransfer,
} from "@/hooks/useTransfers";
import { errorCodeOf } from "@/lib/api";
import { formatTableDate } from "@/lib/balance-change";
import { showErrorToast } from "@/lib/error-toast";

type Side = TransferDetailsData["outflow"];

/**
 * A transfer's own drawer, Sure's `transfers/show.html.erb`, shown in the
 * transaction sheet for a transfer row: the amount and the name, « Aperçu »
 * with each side and its fee, « Détails » saving at once, and « Paramètres »
 * with « Marquer comme récurrent » and the deletion. A viewer reads it, every
 * field disabled and « Paramètres » left out (AD-21).
 */
export function TransferDetails({
	transferId,
	onClose,
}: {
	transferId: string;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const transfer = useTransfer(transferId);

	// Read again on each opening: « Détails » keeps what it starts from, and a
	// cached copy would have it save over a change made since.
	if (transfer.data === undefined || !transfer.isFetchedAfterMount) {
		return (
			<SheetHeader className="border-b">
				<SheetTitle>{t("transactions.transfer.title")}</SheetTitle>
				<SheetDescription>
					{!transfer.isError
						? t("transfers.show.loading")
						: errorCodeOf(transfer.error) === "NOT_FOUND"
							? t("transfers.show.unavailable")
							: t("errors.INTERNAL_ERROR")}
				</SheetDescription>
			</SheetHeader>
		);
	}

	return <TransferDrawer transfer={transfer.data} onClose={onClose} />;
}

function TransferDrawer({
	transfer,
	onClose,
}: {
	transfer: TransferDetailsData;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const admin = useIsAdmin();
	const { outflow, inflow } = transfer;
	// Sure's `Transfer#name`: a payment into a liability, a transfer elsewhere.
	const name = t(
		classificationOf(inflow.accountType) === "liability"
			? "transfers.show.paymentTo"
			: "transfers.show.transferTo",
		{ account: inflow.accountName },
	);

	return (
		<>
			<SheetHeader className="border-b">
				<p className="flex items-center gap-2 pr-8">
					<Money amount={inflow.amount} currency={inflow.currency} className="text-2xl" />
					<span className="text-lg text-muted-foreground">{inflow.currency}</span>
					<ArrowLeftRightIcon aria-hidden="true" className="size-4 text-muted-foreground" />
				</p>
				<SheetTitle className="text-sm font-normal text-muted-foreground">{name}</SheetTitle>
				<SheetDescription className="sr-only">
					{t(`transactions.transfer.kinds.${transfer.kind}`)}
				</SheetDescription>
			</SheetHeader>
			<div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
				<Disclosure title={t("transfers.show.overview")} defaultOpen>
					<div className="flex flex-col gap-3 text-sm">
						<SideRows
							label={t("transfers.show.from")}
							side={outflow}
							feeLabel={t("transfers.show.sourceFee")}
							onClose={onClose}
						/>
						<hr />
						<SideRows
							label={t("transfers.show.to")}
							side={inflow}
							feeLabel={t("transfers.show.destinationFee")}
							onClose={onClose}
						/>
					</div>
				</Disclosure>
				<Disclosure title={t("transfers.show.details")}>
					<fieldset disabled={!admin} className="flex min-w-0 flex-col gap-4">
						<DetailsFields transfer={transfer} />
					</fieldset>
				</Disclosure>
				{admin && (
					<Disclosure title={t("transfers.show.settings")}>
						<Settings transferId={transfer.id} onClose={onClose} />
					</Disclosure>
				)}
			</div>
		</>
	);
}

/** Sure's `DS::Disclosure`: a section folded under its title. */
function Disclosure({
	title,
	defaultOpen = false,
	children,
}: {
	title: string;
	defaultOpen?: boolean;
	children: ReactNode;
}) {
	// Kept in state: a refetch re-rendering an uncontrolled `open` folded it again.
	const [open, setOpen] = useState(defaultOpen);

	return (
		<details
			className="group rounded-lg bg-muted/50"
			open={open}
			onToggle={(event) => setOpen(event.currentTarget.open)}
		>
			<summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
				{title}
				<ChevronRightIcon
					aria-hidden="true"
					className="size-4 text-muted-foreground transition-transform group-open:rotate-90"
				/>
			</summary>
			<div className="px-3 pt-2 pb-4">{children}</div>
		</details>
	);
}

function Row({ term, children }: { term: ReactNode; children: ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-2">
			<dt className="text-muted-foreground">{term}</dt>
			<dd className="flex min-w-0 items-center gap-2">{children}</dd>
		</div>
	);
}

/** One side of « Aperçu »: the account, the date, the amount, and its fee and total when it has one. */
function SideRows({
	label,
	side,
	feeLabel,
	onClose,
}: {
	label: string;
	side: Side;
	feeLabel: string;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const { amount, fee } = side;
	// Sure's « Total »: the outflow and its fee leave « De »; the inflow less its fee reaches « À ».
	const total = toMinorUnits(amount - fee);

	return (
		<dl className="flex flex-col gap-3">
			<Row term={label}>
				<TintedIcon subject={{ kind: "account", type: side.accountType }} size="sm" />
				<Link
					to="/accounts/$accountId"
					params={{ accountId: side.accountId }}
					className="truncate font-medium hover:underline"
					onClick={onClose}
				>
					{side.accountName}
				</Link>
			</Row>
			<Row term={t("transfers.show.date")}>
				<span className="font-medium">{formatTableDate(side.date)}</span>
			</Row>
			<Row term={t("transfers.show.transferAmount")}>
				<Money amount={amount} currency={side.currency} signed />
			</Row>
			{fee > 0 && (
				<>
					<Row term={feeLabel}>
						<Money amount={toMinorUnits(0 - fee)} currency={side.currency} signed />
					</Row>
					<div className="border-t pt-1">
						<Row term={<span className="font-medium">{t("transfers.show.total")}</span>}>
							<Money amount={total} currency={side.currency} signed />
						</Row>
					</div>
				</>
			)}
		</dl>
	);
}

const failed = (error: unknown) => showErrorToast(errorCodeOf(error));

/**
 * « Détails », each field saved on change as Sure's `auto-submit-form`, the
 * notes when they lose focus. Kept in local state, so a second choice made
 * before the first one's answer builds on it.
 */
function DetailsFields({ transfer }: { transfer: TransferDetailsData }) {
	const { t } = useTranslation();
	const update = useUpdateTransfer(transfer.id);
	const setTags = useSetTransferTags(transfer.id);
	const [categoryId, setCategoryId] = useState(transfer.categoryId);
	const [tagIds, setTagIds] = useState(transfer.tagIds);
	const [notes, setNotes] = useState(transfer.notes ?? "");
	const [savedNotes, setSavedNotes] = useState(transfer.notes ?? "");
	// Closing the drawer unmounts the notes without a blur: what they hold
	// then is saved on the way out, as the blur would have.
	const pending = useRef({ notes, savedNotes, save: update.mutate });
	pending.current = { notes, savedNotes, save: update.mutate };
	useEffect(
		() => () => {
			const last = pending.current;

			if (last.notes.trim() !== last.savedNotes.trim()) {
				last.save({ notes: last.notes });
			}
		},
		[],
	);

	return (
		<>
			{transfer.categorizable && (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="transfer-category">{t("transfers.show.category")}</Label>
					<CategoryField
						id="transfer-category"
						value={categoryId}
						onChange={(next) => {
							const previous = categoryId;
							setCategoryId(next);
							update.mutate(
								{ categoryId: next },
								{
									onError: (error) => {
										setCategoryId(previous);
										failed(error);
									},
								},
							);
						}}
						invalid={false}
						describedBy={undefined}
					/>
				</div>
			)}
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="transfer-tags">{t("transactions.form.tags")}</Label>
				<TagsField
					id="transfer-tags"
					value={tagIds}
					onChange={(next) => {
						const previous = tagIds;
						setTagIds(next);
						setTags.mutate(next, {
							onError: (error) => {
								setTagIds(previous);
								failed(error);
							},
						});
					}}
					invalid={false}
					describedBy={undefined}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="transfer-notes">{t("transfers.show.notes")}</Label>
				<Textarea
					id="transfer-notes"
					rows={5}
					maxLength={NOTES_MAX_LENGTH}
					placeholder={t("transfers.show.notesPlaceholder")}
					value={notes}
					onChange={(event) => setNotes(event.target.value)}
					onBlur={() => {
						if (notes.trim() !== savedNotes.trim()) {
							update.mutate(
								{ notes },
								{
									onSuccess: (saved) => setSavedNotes(saved.notes ?? ""),
									onError: failed,
								},
							);
						}
					}}
				/>
			</div>
		</>
	);
}

/** « Paramètres »: Sure's « Marquer comme récurrent », then the deletion it confirms. */
function Settings({ transferId, onClose }: { transferId: string; onClose: () => void }) {
	const { t } = useTranslation();
	const markRecurring = useMarkTransferRecurring();
	const remove = useUnmatchTransfer();
	const [confirming, setConfirming] = useState(false);
	// Sure's `@can_mark_as_recurring_transfer`: not while recurring transactions are off.
	const recurring = useRecurringEnabled();

	return (
		<div className="flex flex-col gap-4">
			{recurring && (
				<div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
					<div className="flex flex-col gap-1 text-sm">
						<h3>{t("transfers.show.markRecurringTitle")}</h3>
						<p className="text-muted-foreground">{t("transfers.show.markRecurringDescription")}</p>
					</div>
					{/* Shown even once a series follows it, as Sure's: the API answers a second one. */}
					<Button
						type="button"
						variant="outline"
						className="shrink-0"
						disabled={markRecurring.isPending}
						onClick={() =>
							markRecurring.mutate(transferId, {
								onSuccess: () => toast.success(t("transactions.transfer.markedRecurring")),
								onError: (error) => showErrorToast(errorCodeOf(error)),
							})
						}
					>
						<Repeat aria-hidden="true" />
						{t("transactions.transfer.markRecurring")}
					</Button>
				</div>
			)}
			<div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex flex-col gap-1 text-sm">
					<h3>{t("transfers.show.deleteTitle")}</h3>
					<p className="text-muted-foreground">{t("transfers.show.deleteDescription")}</p>
				</div>
				<Button
					type="button"
					variant="outline"
					className="shrink-0 text-destructive"
					onClick={() => setConfirming(true)}
				>
					{t("transfers.show.delete")}
				</Button>
			</div>
			<ConfirmDialog
				open={confirming}
				onOpenChange={setConfirming}
				title={t("transfers.show.deleteTitle")}
				description={t("transfers.show.deleteDescription")}
				confirmLabel={t("transfers.show.delete")}
				destructive
				pending={remove.isPending}
				onConfirm={() =>
					remove.mutate(transferId, {
						onSuccess: () => {
							setConfirming(false);
							toast.success(t("transfers.show.deleted"));
							onClose();
						},
						onError: (error) => showErrorToast(errorCodeOf(error)),
					})
				}
			/>
		</div>
	);
}
