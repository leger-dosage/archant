import type { SecurityPick } from "@/components/SecurityCombobox";
import type { TradeData } from "@/hooks/useTrades";
import type { ShownError } from "@/lib/form-errors";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useRef, useState } from "react";
import { useController, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import type { TradeFormInput } from "@archant/api/schemas/trades";
import {
	SECURITY_NAME_MAX_LENGTH,
	TRADE_SIDES,
	createTradeSchema,
} from "@archant/api/schemas/trades";
import type { CurrencyCode } from "@archant/data/money";
import { formatMoney } from "@archant/data/money";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DateField } from "@/components/DateField";
import { FieldMessage } from "@/components/FieldMessage";
import { SecurityCombobox, securityLabel } from "@/components/SecurityCombobox";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCreateTrade, useDeleteTrade, useUpdateTrade } from "@/hooks/useTrades";
import { amountToText } from "@/lib/amount-sign";
import { ApiError } from "@/lib/api";
import { formatTableDate } from "@/lib/balance-change";
import { toIsoDate } from "@/lib/dates";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors, errorAt, fieldErrorCode } from "@/lib/form-errors";
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
] as const;

type TradeAccount = { id: string; currency: CurrencyCode };

function valuesOf(trade: TradeData | null): TradeFormInput {
	return trade === null
		? { side: "buy", security: null, date: toIsoDate(), quantity: "", price: "", fee: "0" }
		: {
				side: trade.side,
				// An edit never changes the security; the schema still checks one is there.
				security: { source: "known", id: trade.security.id },
				date: trade.date,
				quantity: decimalToText(trade.quantity),
				price: decimalToText(trade.price),
				fee: amountToText(trade.fee, trade.currency),
			};
}

/**
 * A field's error, with the trade form's own sentence where the shared one
 * would mislead: `too_big` is an amount here, not a text, and a currency
 * mismatch is the security's, not a goal's.
 */
function TradeFieldMessage({ id, error }: { id: string; error: ShownError | undefined }) {
	const { t } = useTranslation();
	const code = error === undefined ? null : fieldErrorCode(error);

	if (code === "too_big" || code === "currency_mismatch") {
		return (
			<p id={id} className="text-xs text-destructive">
				{t(`trades.form.errors.${code}`)}
			</p>
		);
	}

	return <FieldMessage id={id} error={error} />;
}

/** A field's ARIA state, pointing at its message when it has an error. */
function described(name: string, error: ShownError | undefined) {
	return {
		"aria-invalid": error !== undefined,
		...(error === undefined ? {} : { "aria-describedby": `trade-${name}-error` }),
	};
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
	const [picking, setPicking] = useState(false);
	const [picked, setPicked] = useState<string | null>(
		trade === null ? null : securityLabel(trade.security),
	);
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

	const pick = ({ choice, label }: SecurityPick) => {
		security.field.onChange(choice);
		form.clearErrors("security");
		setPicked(label);
		setPicking(false);
	};

	const submit = form.handleSubmit(async ({ security: choice, ...values }) => {
		try {
			if (trade !== null) {
				await updateTrade.mutateAsync({ id: trade.id, input: values });
			} else if (choice !== null) {
				await createTrade.mutateAsync({ ...values, security: choice });
			}
			// No success toast: the row and the balance changing say it.
			onClose();
		} catch (error) {
			showError(error);
		}
	});

	const remove = async () => {
		if (trade === null) {
			return;
		}

		try {
			await deleteTrade.mutateAsync(trade.id);
			setConfirmingDelete(false);
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
				<div className="flex flex-col gap-1.5">
					<span id="trade-side-label" className="text-sm font-medium">
						{t("trades.form.side")}
					</span>
					<ToggleGroup
						type="single"
						variant="outline"
						spacing={0}
						aria-labelledby="trade-side-label"
						value={side.field.value}
						// Radix reports an empty value when the pressed item is pressed
						// again; a trade is always a buy or a sale.
						onValueChange={(value) => {
							const next = TRADE_SIDES.find((candidate) => candidate === value);

							if (next !== undefined) {
								side.field.onChange(next);
							}
						}}
					>
						{TRADE_SIDES.map((option) => (
							<ToggleGroupItem key={option} value={option} className="flex-1">
								{t(`trades.sides.${option}`)}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				</div>

				<div className="flex flex-col gap-1.5">
					<Label htmlFor="trade-security">{t("trades.form.security")}</Label>
					{trade === null ? (
						<Popover open={picking} onOpenChange={setPicking}>
							<PopoverTrigger asChild>
								<Button
									id="trade-security"
									type="button"
									variant="outline"
									className="w-full justify-start font-normal"
									{...described("security", securityError)}
								>
									<span className={picked === null ? "text-muted-foreground" : "truncate"}>
										{picked ?? t("trades.form.securityPlaceholder")}
									</span>
								</Button>
							</PopoverTrigger>
							<PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
								<SecurityCombobox onSelect={pick} />
							</PopoverContent>
						</Popover>
					) : (
						// The security of a recorded trade never changes, as Sure's drawer.
						<Input id="trade-security" value={picked ?? ""} readOnly disabled />
					)}
					<TradeFieldMessage id="trade-security-error" error={securityError} />
				</div>

				{manual && (
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
			</form>

			<DialogFooter className="flex-row items-center justify-between sm:justify-between">
				{trade === null ? (
					<span />
				) : (
					<Button type="button" variant="destructive" onClick={() => setConfirmingDelete(true)}>
						{t("trades.delete.action")}
					</Button>
				)}
				<div className="flex gap-2">
					<Button type="button" variant="outline" onClick={onClose}>
						{t("common.cancel")}
					</Button>
					<Button type="submit" form="trade-form" disabled={isSubmitting}>
						{t("trades.form.save")}
					</Button>
				</div>
			</DialogFooter>

			{trade !== null && (
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
			)}
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
 * Records or edits a buy or a sale. Focus goes back to what opened it, even
 * when the edit moved its row.
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
