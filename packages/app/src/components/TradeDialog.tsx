import type { HeldChoice } from "@/components/TradeFields";
import type { TradeData } from "@/hooks/useTrades";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useRef, useState } from "react";
import { useController, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { TradeFormInput, TradeType } from "@archant/api/schemas/trades";
import {
	SECURITY_NAME_MAX_LENGTH,
	TRADE_SIDES,
	TRADE_TYPES,
	createTradeSchema,
	isIncomeSide,
} from "@archant/api/schemas/trades";
import type { CurrencyCode } from "@archant/data/money";
import { formatMoney } from "@archant/data/money";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DateField } from "@/components/DateField";
import { securityLabel } from "@/components/SecurityCombobox";
import {
	IncomeSecuritySelect,
	SecurityPicker,
	TradeFieldMessage,
	TradeTypeToggle,
	describedBy,
} from "@/components/TradeFields";
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
import { useCreateTrade, useDeleteTrade, useUpdateTrade } from "@/hooks/useTrades";
import { amountToText } from "@/lib/amount-sign";
import { ApiError } from "@/lib/api";
import { formatTableDate } from "@/lib/balance-change";
import { toIsoDate } from "@/lib/dates";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors, errorAt } from "@/lib/form-errors";
import { decimalToText } from "@/lib/trade-format";

const FIELD_NAMES = [
	"side",
	"security",
	"security.isin",
	"security.name",
	"date",
	"quantity",
	"price",
	"fee",
	"amount",
] as const;

type TradeAccount = { id: string; currency: CurrencyCode };

const described = (name: string, error: Parameters<typeof describedBy>[1]) =>
	describedBy(`trade-${name}-error`, error);

function valuesOf(trade: TradeData | null): TradeFormInput {
	if (trade === null) {
		return {
			side: "buy",
			security: null,
			date: toIsoDate(),
			quantity: "",
			price: "",
			fee: "0",
			amount: "",
		};
	}

	// An edit never changes the security; the schema still checks one is there.
	const security =
		trade.security === null ? null : { source: "known" as const, id: trade.security.id };

	return isIncomeSide(trade.side)
		? {
				side: trade.side,
				security,
				date: trade.date,
				quantity: "",
				price: "",
				fee: "0",
				amount: amountToText(trade.amount, trade.currency),
			}
		: {
				side: trade.side,
				security,
				date: trade.date,
				quantity: decimalToText(trade.quantity),
				price: decimalToText(trade.price),
				fee: amountToText(trade.fee, trade.currency),
				amount: "",
			};
}

/** The types an edit may move between: a buy and a sale, never an income. */
function typesOf(trade: TradeData | null): readonly TradeType[] {
	if (trade === null) {
		return TRADE_TYPES;
	}

	return isIncomeSide(trade.side) ? [trade.side] : TRADE_SIDES;
}

/** The security an income names: one already known, or the cash. */
function heldChoice(choice: TradeFormInput["security"]): HeldChoice | null {
	return choice !== null && choice.source === "known" ? choice : null;
}

type TradeFormProps = {
	account: TradeAccount;
	trade: TradeData | null;
	/** After a save or a delete, and on Annuler. */
	onClose: () => void;
};

function TradeForm({ account, trade, onClose }: TradeFormProps) {
	const { t } = useTranslation();
	const createTrade = useCreateTrade(account.id);
	const updateTrade = useUpdateTrade(account.id);
	const deleteTrade = useDeleteTrade(account.id);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [picked, setPicked] = useState<string | null>(
		trade?.security === null || trade === null ? null : securityLabel(trade.security),
	);
	// A converted trade keeps its transaction's date and amount: it is read
	// only, and undoing the conversion is the one thing it offers.
	const convertedFrom = trade?.convertedFrom ?? null;
	const schema = useMemo(() => createTradeSchema(account.currency), [account.currency]);
	const form = useForm<TradeFormInput>({
		// `raw` hands the typed text to the API as is: the same schema parses it
		// there, with the account's currency.
		resolver: zodResolver(schema, undefined, { raw: true }),
		defaultValues: valuesOf(trade),
	});
	const { errors, isSubmitting } = form.formState;
	const side = useController({ control: form.control, name: "side" });
	const security = useController({ control: form.control, name: "security" });
	const date = useController({ control: form.control, name: "date" });
	const income = isIncomeSide(side.field.value);
	const manual = security.field.value?.source === "manual";
	const securityError = errorAt(errors, "security");
	const isinError = errorAt(errors, "security.isin");
	const nameError = errorAt(errors, "security.name");

	const showError = (error: unknown) => {
		const apiError = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR");

		// The API names no field for it: the quantity is what the owner changes.
		if (apiError.code === "QUANTITY_UNAVAILABLE") {
			form.setError("quantity", { type: "quantity_unavailable" });

			return;
		}

		const unplaced = applyFieldErrors(apiError.fields, FIELD_NAMES, form.setError);

		if (unplaced.length > 0 || apiError.fields.length === 0) {
			showErrorToast(apiError.code);
		}
	};

	const changeType = (next: TradeType) => {
		// A buy's security comes from the search, an income's from the
		// account's positions: switching between them starts the pick over.
		if (isIncomeSide(next) !== income) {
			security.field.onChange(null);
			setPicked(null);
		}

		form.clearErrors();
		side.field.onChange(next);
	};

	const submit = form.handleSubmit(
		async ({
			side: type,
			security: choice,
			date: day,
			quantity = "",
			price = "",
			fee = "",
			amount = "",
		}) => {
			try {
				if (trade !== null) {
					await updateTrade.mutateAsync({
						id: trade.id,
						input: isIncomeSide(type)
							? { date: day, amount }
							: { side: type, date: day, quantity, price, fee },
					});
				} else if (isIncomeSide(type)) {
					await createTrade.mutateAsync({
						side: type,
						security: heldChoice(choice),
						date: day,
						amount,
					});
				} else if (choice !== null) {
					await createTrade.mutateAsync({
						side: type,
						security: choice,
						date: day,
						quantity,
						price,
						fee,
					});
				}
				// No success toast: the row and the balance changing say it.
				onClose();
			} catch (error) {
				showError(error);
			}
		},
	);

	const remove = async () => {
		if (trade === null) {
			return;
		}

		try {
			await deleteTrade.mutateAsync(trade.id);
			setConfirmingDelete(false);

			if (convertedFrom !== null) {
				toast.success(t("trades.undoConversion.done"));
			}

			onClose();
		} catch (error) {
			setConfirmingDelete(false);
			// A deletion has no field to point at: a later sale would be short.
			showErrorToast(error instanceof ApiError ? error.code : "INTERNAL_ERROR");
		}
	};

	return (
		<>
			<form
				id="trade-form"
				noValidate
				className="flex flex-col gap-4"
				onSubmit={(event) => void submit(event)}
			>
				{convertedFrom !== null && (
					<section aria-labelledby="trade-converted-title" className="flex flex-col gap-1.5">
						<h3 id="trade-converted-title" className="text-sm font-medium">
							{t("trades.form.convertedTitle")}
						</h3>
						<p className="text-sm text-muted-foreground">
							{t("trades.form.convertedFrom", { label: convertedFrom.label })}
						</p>
					</section>
				)}

				<fieldset disabled={convertedFrom !== null} className="flex min-w-0 flex-col gap-4">
					<div className="flex flex-col gap-1.5">
						<span id="trade-side-label" className="text-sm font-medium">
							{t("trades.form.side")}
						</span>
						<TradeTypeToggle
							labelId="trade-side-label"
							value={side.field.value}
							options={typesOf(trade)}
							disabled={convertedFrom !== null}
							onChange={changeType}
						/>
					</div>

					<div className="flex flex-col gap-1.5">
						<Label htmlFor="trade-security">{t("trades.form.security")}</Label>
						{trade !== null ? (
							// The security of a recorded trade never changes, as Sure's drawer.
							<Input id="trade-security" value={picked ?? t("trades.cash")} readOnly disabled />
						) : income ? (
							<IncomeSecuritySelect
								id="trade-security"
								accountId={account.id}
								side={side.field.value === "dividend" ? "dividend" : "interest"}
								value={heldChoice(security.field.value)}
								error={securityError}
								onChange={(choice) => {
									security.field.onChange(choice);
									form.clearErrors("security");
								}}
							/>
						) : (
							<SecurityPicker
								id="trade-security"
								picked={picked}
								error={securityError}
								onPick={({ choice, label }) => {
									security.field.onChange(choice);
									form.clearErrors("security");
									setPicked(label);
								}}
							/>
						)}
						<TradeFieldMessage id="trade-security-error" error={securityError} />
					</div>

					{manual && !income && (
						<>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="trade-isin">{t("trades.form.isin")}</Label>
								<Input
									id="trade-isin"
									autoComplete="off"
									className="uppercase"
									{...described("isin", isinError)}
									{...form.register("security.isin")}
								/>
								<TradeFieldMessage id="trade-isin-error" error={isinError} />
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="trade-name">{t("trades.form.name")}</Label>
								<Input
									id="trade-name"
									autoComplete="off"
									maxLength={SECURITY_NAME_MAX_LENGTH}
									{...described("name", nameError)}
									{...form.register("security.name")}
								/>
								<TradeFieldMessage id="trade-name-error" error={nameError} />
							</div>
						</>
					)}

					<div className="flex flex-col gap-1.5">
						<Label htmlFor="trade-date">{t("trades.form.date")}</Label>
						<DateField
							id="trade-date"
							value={date.field.value}
							onChange={date.field.onChange}
							onBlur={date.field.onBlur}
							invalid={errors.date !== undefined}
							{...(errors.date === undefined ? {} : { describedBy: "trade-date-error" })}
						/>
						<TradeFieldMessage id="trade-date-error" error={errors.date} />
					</div>

					{income ? (
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="trade-amount">{t("trades.form.amount")}</Label>
							<Input
								id="trade-amount"
								inputMode="decimal"
								autoComplete="off"
								className="text-right tabular-nums"
								{...described("amount", errors.amount)}
								{...form.register("amount")}
							/>
							<TradeFieldMessage id="trade-amount-error" error={errors.amount} />
						</div>
					) : (
						<>
							<div className="grid grid-cols-2 gap-3">
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="trade-quantity">{t("trades.form.quantity")}</Label>
									<Input
										id="trade-quantity"
										inputMode="decimal"
										autoComplete="off"
										className="text-right tabular-nums"
										{...described("quantity", errors.quantity)}
										{...form.register("quantity")}
									/>
									<TradeFieldMessage id="trade-quantity-error" error={errors.quantity} />
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="trade-price">{t("trades.form.price")}</Label>
									<Input
										id="trade-price"
										inputMode="decimal"
										autoComplete="off"
										className="text-right tabular-nums"
										{...described("price", errors.price)}
										{...form.register("price")}
									/>
									<TradeFieldMessage id="trade-price-error" error={errors.price} />
								</div>
							</div>

							<div className="flex flex-col gap-1.5">
								<Label htmlFor="trade-fee">{t("trades.form.fee")}</Label>
								<Input
									id="trade-fee"
									inputMode="decimal"
									autoComplete="off"
									className="text-right tabular-nums"
									{...described("fee", errors.fee)}
									{...form.register("fee")}
								/>
								<TradeFieldMessage id="trade-fee-error" error={errors.fee} />
							</div>
						</>
					)}
				</fieldset>
			</form>

			<DialogFooter className="flex-row items-center justify-between sm:justify-between">
				{trade === null ? (
					<span />
				) : (
					<Button type="button" variant="destructive" onClick={() => setConfirmingDelete(true)}>
						{t(convertedFrom === null ? "trades.delete.action" : "trades.undoConversion.action")}
					</Button>
				)}
				<div className="flex gap-2">
					<Button type="button" variant="outline" onClick={onClose}>
						{t(convertedFrom === null ? "common.cancel" : "common.close")}
					</Button>
					{convertedFrom === null && (
						<Button type="submit" form="trade-form" disabled={isSubmitting}>
							{t("trades.form.save")}
						</Button>
					)}
				</div>
			</DialogFooter>

			{trade !== null &&
				(convertedFrom === null ? (
					<ConfirmDialog
						open={confirmingDelete}
						onOpenChange={setConfirmingDelete}
						title={t("trades.delete.title", { date: formatTableDate(trade.date) })}
						description={t("trades.delete.description", {
							amount: formatMoney({ amount: trade.amount, currency: trade.currency }),
						})}
						confirmLabel={t("trades.delete.confirm")}
						destructive
						pending={deleteTrade.isPending}
						onConfirm={() => void remove()}
					/>
				) : (
					<ConfirmDialog
						open={confirmingDelete}
						onOpenChange={setConfirmingDelete}
						title={t("trades.undoConversion.title")}
						description={t("trades.undoConversion.description", {
							label: convertedFrom.label,
							amount: formatMoney({ amount: trade.amount, currency: trade.currency }),
						})}
						confirmLabel={t("trades.undoConversion.action")}
						cancelLabel={t("trades.undoConversion.keep")}
						destructive
						pending={deleteTrade.isPending}
						onConfirm={() => void remove()}
					/>
				))}
		</>
	);
}

type TradeDialogProps = {
	account: TradeAccount;
	open: boolean;
	/** `null` to record a new trade. */
	trade: TradeData | null;
	onOpenChange: (open: boolean) => void;
};

/**
 * Records or edits a buy, a sale, a dividend or interest; a converted trade
 * opens read only, to undo its conversion. Focus goes back to what opened
 * it, even when the edit moved its row.
 */
export function TradeDialog({ account, open, trade, onOpenChange }: TradeDialogProps) {
	const { t } = useTranslation();
	const [session, setSession] = useState(0);
	const [wasOpen, setWasOpen] = useState(open);

	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) {
			setSession((current) => current + 1);
		}
	}

	// Radix returns focus to a `DialogTrigger`; this dialog is opened from rows
	// and buttons of the page instead, so it remembers which one itself.
	const opener = useRef<HTMLElement | null>(null);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				showCloseButton={false}
				onOpenAutoFocus={() => {
					opener.current =
						document.activeElement instanceof HTMLElement ? document.activeElement : null;
				}}
				onCloseAutoFocus={(event) => {
					const id = opener.current?.dataset["tradeId"];
					const target =
						opener.current?.isConnected === true || id === undefined
							? opener.current
							: document.querySelector<HTMLElement>(`[data-trade-id="${CSS.escape(id)}"]`);

					if (target?.isConnected === true) {
						event.preventDefault();
						target.focus();
					}
				}}
			>
				<DialogHeader>
					<DialogTitle>
						{t(trade === null ? "trades.form.addTitle" : "trades.form.editTitle")}
					</DialogTitle>
					<DialogDescription>{t("trades.form.description")}</DialogDescription>
				</DialogHeader>
				<TradeForm
					// A fresh form each time the dialog opens, with that trade's values.
					key={session}
					account={account}
					trade={trade}
					onClose={() => onOpenChange(false)}
				/>
			</DialogContent>
		</Dialog>
	);
}
