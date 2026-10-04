import type { HeldChoice } from "@/components/TradeFields";
import type { TransactionData } from "@/hooks/useTransactions";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useController, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { ConvertTradeFormInput, TradeType } from "@archant/api/schemas/trades";
import {
	SECURITY_NAME_MAX_LENGTH,
	TRADE_TYPES,
	conversionFeeOf,
	convertTradeSchema,
	isIncomeSide,
} from "@archant/api/schemas/trades";
import type { CurrencyCode } from "@archant/data/money";
import { formatMoney } from "@archant/data/money";

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
import { useConvertTransaction } from "@/hooks/useTrades";
import { ApiError } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors, errorAt } from "@/lib/form-errors";

const FIELD_NAMES = [
	"side",
	"security",
	"security.isin",
	"security.name",
	"quantity",
	"price",
] as const;

const described = (name: string, error: Parameters<typeof describedBy>[1]) =>
	describedBy(`convert-${name}-error`, error);

function heldChoice(choice: ConvertTradeFormInput["security"]): HeldChoice | null {
	return choice !== null && choice.source === "known" ? choice : null;
}

type ConvertTradeDialogProps = {
	transaction: TransactionData;
	currency: CurrencyCode;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** After the conversion: the line has left the list, so the sheet closes too. */
	onConverted: () => void;
};

/**
 * The form, mounted only while the dialog is open, so each opening starts
 * from the line as it stands.
 */
function ConvertForm({
	transaction,
	currency,
	onOpenChange,
	onConverted,
}: Omit<ConvertTradeDialogProps, "open">) {
	const { t } = useTranslation();
	const convert = useConvertTransaction(transaction.accountId);
	const [picked, setPicked] = useState<string | null>(null);
	const schema = useMemo(
		() => convertTradeSchema(currency, transaction.amount),
		[currency, transaction.amount],
	);
	const form = useForm<ConvertTradeFormInput>({
		// `raw` hands the typed text to the API as is: the same schema parses it there.
		resolver: zodResolver(schema, undefined, { raw: true }),
		// Money out is most often a buy, money in a sale, as Sure infers it.
		defaultValues: {
			side: transaction.amount <= 0 ? "buy" : "sell",
			security: null,
			quantity: "",
			price: "",
		},
	});
	const { errors, isSubmitting } = form.formState;
	const side = useController({ control: form.control, name: "side" });
	const security = useController({ control: form.control, name: "security" });
	const [quantity = "", price = ""] = useWatch({
		control: form.control,
		name: ["quantity", "price"],
	});
	const income = isIncomeSide(side.field.value);
	const manual = security.field.value?.source === "manual";
	const securityError = errorAt(errors, "security");
	const isinError = errorAt(errors, "security.isin");
	const nameError = errorAt(errors, "security.name");
	const type = side.field.value;
	const fee = isIncomeSide(type)
		? null
		: conversionFeeOf(type, { quantity, price }, transaction.amount, currency);

	const changeType = (next: TradeType) => {
		if (isIncomeSide(next) !== income) {
			security.field.onChange(null);
			setPicked(null);
		}

		form.clearErrors();
		side.field.onChange(next);
	};

	const submit = form.handleSubmit(async (values) => {
		const { side: chosen, security: choice } = values;

		try {
			if (isIncomeSide(chosen)) {
				await convert.mutateAsync({
					id: transaction.id,
					input: { side: chosen, security: heldChoice(choice) },
				});
			} else if (choice !== null) {
				await convert.mutateAsync({
					id: transaction.id,
					input: {
						side: chosen,
						security: choice,
						quantity: values.quantity ?? "",
						price: values.price ?? "",
					},
				});
			}

			toast.success(t("trades.convert.done"));
			onConverted();
		} catch (error) {
			const apiError = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR");

			if (apiError.code === "QUANTITY_UNAVAILABLE") {
				form.setError("quantity", { type: "quantity_unavailable" });

				return;
			}

			const unplaced = applyFieldErrors(apiError.fields, FIELD_NAMES, form.setError);

			if (unplaced.length > 0 || apiError.fields.length === 0) {
				showErrorToast(apiError.code);
			}
		}
	});

	return (
		<>
			<DialogHeader>
				<DialogTitle>{t("trades.convert.title")}</DialogTitle>
				<DialogDescription>
					{t("trades.convert.description", {
						amount: formatMoney({ amount: transaction.amount, currency }),
					})}
				</DialogDescription>
			</DialogHeader>
			<form
				id="convert-form"
				noValidate
				className="flex flex-col gap-4"
				onSubmit={(event) => void submit(event)}
			>
				<div className="flex flex-col gap-1.5">
					<span id="convert-side-label" className="text-sm font-medium">
						{t("trades.form.side")}
					</span>
					<TradeTypeToggle
						labelId="convert-side-label"
						value={side.field.value}
						options={TRADE_TYPES}
						onChange={changeType}
					/>
					<TradeFieldMessage id="convert-side-error" error={errors.side} />
				</div>

				<div className="flex flex-col gap-1.5">
					<Label htmlFor="convert-security">{t("trades.form.security")}</Label>
					{income ? (
						<IncomeSecuritySelect
							id="convert-security"
							accountId={transaction.accountId}
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
							id="convert-security"
							picked={picked}
							error={securityError}
							onPick={({ choice, label }) => {
								security.field.onChange(choice);
								form.clearErrors("security");
								setPicked(label);
							}}
						/>
					)}
					<TradeFieldMessage id="convert-security-error" error={securityError} />
				</div>

				{manual && !income && (
					<>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="convert-isin">{t("trades.form.isin")}</Label>
							<Input
								id="convert-isin"
								autoComplete="off"
								className="uppercase"
								{...described("isin", isinError)}
								{...form.register("security.isin")}
							/>
							<TradeFieldMessage id="convert-isin-error" error={isinError} />
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="convert-name">{t("trades.form.name")}</Label>
							<Input
								id="convert-name"
								autoComplete="off"
								maxLength={SECURITY_NAME_MAX_LENGTH}
								{...described("name", nameError)}
								{...form.register("security.name")}
							/>
							<TradeFieldMessage id="convert-name-error" error={nameError} />
						</div>
					</>
				)}

				{!income && (
					<>
						<div className="grid grid-cols-2 gap-3">
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="convert-quantity">{t("trades.form.quantity")}</Label>
								<Input
									id="convert-quantity"
									inputMode="decimal"
									autoComplete="off"
									className="text-right tabular-nums"
									{...described("quantity", errors.quantity)}
									{...form.register("quantity")}
								/>
								<TradeFieldMessage id="convert-quantity-error" error={errors.quantity} />
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="convert-price">{t("trades.form.price")}</Label>
								<Input
									id="convert-price"
									inputMode="decimal"
									autoComplete="off"
									className="text-right tabular-nums"
									{...described("price", errors.price)}
									{...form.register("price")}
								/>
								<TradeFieldMessage id="convert-price-error" error={errors.price} />
							</div>
						</div>
						<dl className="flex items-center justify-between gap-4 text-sm">
							<dt className="text-muted-foreground">{t("trades.convert.fees")}</dt>
							<dd className="font-medium tabular-nums" aria-live="polite">
								{fee === null
									? t("trades.convert.feesUnknown")
									: formatMoney({ amount: fee, currency })}
							</dd>
						</dl>
					</>
				)}
			</form>

			<DialogFooter>
				<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
					{t("common.cancel")}
				</Button>
				<Button type="submit" form="convert-form" disabled={isSubmitting}>
					{t("trades.convert.save")}
				</Button>
			</DialogFooter>
		</>
	);
}

/**
 * « Convertir en ordre », as Sure's convert to trade: the type, the security,
 * and for a buy or a sale the quantity and unit price, the fees being what
 * the line's amount leaves. The line stays as the trade's origin, excluded.
 */
function ConvertTradeDialog({ open, onOpenChange, ...props }: ConvertTradeDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent showCloseButton={false} className="max-h-[90vh] overflow-y-auto">
				{open && <ConvertForm {...props} onOpenChange={onOpenChange} />}
			</DialogContent>
		</Dialog>
	);
}

/**
 * The sheet's « Ordre » block on an investment account: « Convertir en
 * ordre » for a line the ledger can convert, to an administrator, saving
 * apart from the form, so it waits while the form holds unsaved edits, as
 * the split block does. A viewer sees nothing.
 */
export function ConvertBlock({
	transaction,
	currency,
	dirty,
	onConverted,
}: {
	transaction: TransactionData;
	currency: CurrencyCode;
	dirty: boolean;
	onConverted: () => void;
}) {
	const { t } = useTranslation();
	const [converting, setConverting] = useState(false);

	return (
		<section aria-labelledby="transaction-convert-title" className="flex flex-col gap-1.5">
			<h3 id="transaction-convert-title" className="text-sm font-medium">
				{t("trades.convert.section")}
			</h3>
			<div className="flex flex-col items-start gap-2">
				<p className="text-sm text-muted-foreground">{t("trades.convert.offer")}</p>
				<Button
					type="button"
					variant="outline"
					disabled={dirty}
					onClick={() => setConverting(true)}
				>
					{t("trades.convert.action")}
				</Button>
				<ConvertTradeDialog
					transaction={transaction}
					currency={currency}
					open={converting}
					onOpenChange={setConverting}
					onConverted={() => {
						setConverting(false);
						onConverted();
					}}
				/>
			</div>
		</section>
	);
}
