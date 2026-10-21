import type { TransactionType } from "@/components/TransactionTypeTabs";
import type { AccountListData } from "@/hooks/useAccounts";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronRightIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useController, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import type { NewTransferFormInput } from "@archant/api/schemas/transfers";
import { newTransferSchema } from "@archant/api/schemas/transfers";
import type { CurrencyCode } from "@archant/data/money";
import { DEFAULT_CURRENCY, isCurrencyCode } from "@archant/data/money";

import { DateField } from "@/components/DateField";
import { FieldMessage } from "@/components/FieldMessage";
import { TagsField } from "@/components/TransactionFields";
import { TransactionTypeTabs } from "@/components/TransactionTypeTabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { SheetFooter } from "@/components/ui/sheet";
import { useAccounts } from "@/hooks/useAccounts";
import { useCreateTransferBetween } from "@/hooks/useTransfers";
import { ApiError } from "@/lib/api";
import { toIsoDate } from "@/lib/dates";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors } from "@/lib/form-errors";

const FIELD_NAMES = [
	"fromAccountId",
	"toAccountId",
	"date",
	"amount",
	"sourceFee",
	"destinationFee",
	"tagIds",
] as const;

type FieldName = (typeof FIELD_NAMES)[number];

const byName = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

/** Every active account, by name, as Sure's `set_accounts`: a bank-linked one included. */
const activeAccounts = (list: AccountListData) =>
	list.groups
		.flatMap((group) => group.accounts)
		.filter((account) => account.active)
		.toSorted((a, b) => byName.compare(a.name, b.name));

type TransferFormProps = {
	/** The account the sheet was opened from, « De » to start with. */
	fromAccountId: string | null;
	onTypeChange: (type: TransactionType) => void;
	/** After the transfer is created. */
	onClose: () => void;
	onCancel: () => void;
	onDirtyChange: (dirty: boolean) => void;
};

/**
 * A transfer between two of the household's accounts, as Sure's
 * `transfers/_form.html.erb`: « De », « Vers », « Date », « Montant », the
 * tags, and the fees folded under « Frais bancaires ». One key per form, so
 * a second submit returns the first transfer.
 */
export function TransferForm({
	fromAccountId,
	onTypeChange,
	onClose,
	onCancel,
	onDirtyChange,
}: TransferFormProps) {
	const { t } = useTranslation();
	const accounts = useAccounts({ select: activeAccounts });
	const createTransfer = useCreateTransferBetween();
	const [idempotencyKey] = useState(() => crypto.randomUUID());
	const [currency, setCurrency] = useState<CurrencyCode>(DEFAULT_CURRENCY);
	// Rebuilt with the source account's currency, in which the API parses the amounts.
	const schema = useMemo(() => newTransferSchema(currency), [currency]);
	const form = useForm<NewTransferFormInput>({
		// `raw` sends the typed text as is: the same schema parses it on the server.
		resolver: zodResolver(schema, undefined, { raw: true }),
		defaultValues: {
			fromAccountId: fromAccountId ?? "",
			toAccountId: "",
			date: toIsoDate(),
			amount: "",
			sourceFee: "",
			destinationFee: "",
			tagIds: [],
		},
	});
	const from = useController({ control: form.control, name: "fromAccountId" });
	const to = useController({ control: form.control, name: "toAccountId" });
	const date = useController({ control: form.control, name: "date" });
	const tagIds = useController({ control: form.control, name: "tagIds" });
	const source = accounts.data?.find((account) => account.id === from.field.value);
	const sourceCurrency =
		source !== undefined && isCurrencyCode(source.currency) ? source.currency : DEFAULT_CURRENCY;

	if (sourceCurrency !== currency) {
		setCurrency(sourceCurrency);
	}
	const { errors, isSubmitting, isDirty } = form.formState;
	const [feesOpen, setFeesOpen] = useState(false);
	const feesRefused = errors.sourceFee !== undefined || errors.destinationFee !== undefined;

	useEffect(() => {
		onDirtyChange(isDirty);
	}, [isDirty, onDirtyChange]);

	const submit = form.handleSubmit(async (values) => {
		try {
			await createTransfer.mutateAsync({ ...values, idempotencyKey });
			onClose();
		} catch (error) {
			const apiError = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR");
			const unplaced = applyFieldErrors(apiError.fields, FIELD_NAMES, form.setError);

			if (
				apiError.code !== "VALIDATION_ERROR" ||
				unplaced.length > 0 ||
				apiError.fields.length === 0
			) {
				showErrorToast(apiError.code);
			}
		}
	});

	const describedBy = (name: FieldName) =>
		errors[name] === undefined ? {} : { "aria-describedby": `transfer-${name}-error` };

	const accountSelect = (
		name: "fromAccountId" | "toAccountId",
		field: { value: string; onChange: (value: string) => void },
		label: string,
	) => (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={`transfer-${name}`}>{label}</Label>
			<Select value={field.value} onValueChange={field.onChange}>
				<SelectTrigger
					id={`transfer-${name}`}
					className="w-full"
					aria-invalid={errors[name] !== undefined}
					{...describedBy(name)}
				>
					<SelectValue placeholder={t("transfers.form.selectAccount")} />
				</SelectTrigger>
				<SelectContent>
					{(accounts.data ?? []).map((account) => (
						<SelectItem key={account.id} value={account.id}>
							{account.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<FieldMessage id={`transfer-${name}-error`} error={errors[name]} />
		</div>
	);

	const amountInput = (name: "amount" | "sourceFee" | "destinationFee", label: string) => (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={`transfer-${name}`}>{label}</Label>
			<Input
				id={`transfer-${name}`}
				inputMode="decimal"
				autoComplete="off"
				className="text-right tabular-nums"
				placeholder={name === "amount" ? "100" : "0,00"}
				aria-invalid={errors[name] !== undefined}
				{...describedBy(name)}
				{...form.register(name)}
			/>
			<FieldMessage id={`transfer-${name}-error`} error={errors[name]} />
		</div>
	);

	return (
		<>
			<form
				id="transfer-form"
				noValidate
				className="flex flex-1 flex-col gap-4 overflow-y-auto px-4"
				onSubmit={(event) => void submit(event)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();

						if (!form.formState.isSubmitting) {
							void submit();
						}
					}
				}}
			>
				<TransactionTypeTabs value="transfer" onChange={onTypeChange} />

				{accountSelect("fromAccountId", from.field, t("transfers.form.from"))}
				{accountSelect("toAccountId", to.field, t("transfers.form.to"))}

				<div className="flex flex-col gap-1.5">
					<Label htmlFor="transfer-date">{t("transactions.form.date")}</Label>
					<DateField
						id="transfer-date"
						value={date.field.value}
						onChange={date.field.onChange}
						onBlur={date.field.onBlur}
						max={toIsoDate()}
						invalid={errors.date !== undefined}
						{...(errors.date === undefined ? {} : { describedBy: "transfer-date-error" })}
					/>
					<FieldMessage id="transfer-date-error" error={errors.date} />
				</div>

				{amountInput("amount", t("transactions.form.amount"))}

				<div className="flex flex-col gap-1.5">
					<Label htmlFor="transfer-tags">{t("transactions.form.tags")}</Label>
					<TagsField
						id="transfer-tags"
						value={tagIds.field.value ?? []}
						onChange={tagIds.field.onChange}
						invalid={errors.tagIds !== undefined}
						describedBy={errors.tagIds === undefined ? undefined : "transfer-tagIds-error"}
					/>
					<FieldMessage
						id="transfer-tagIds-error"
						error={errors.tagIds?.type === undefined ? undefined : { type: errors.tagIds.type }}
					/>
				</div>

				{/* Folded, as Sure's `DS::Disclosure` « Frais bancaires »; a refused fee opens it. */}
				<details
					className="group"
					open={feesOpen || feesRefused}
					onToggle={(event) => setFeesOpen(event.currentTarget.open)}
				>
					<summary className="flex cursor-pointer items-center gap-1 py-2 text-sm text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
						<ChevronRightIcon
							aria-hidden="true"
							className="size-4 transition-transform group-open:rotate-90"
						/>
						{t("transfers.form.bankCharges")}
					</summary>
					<div className="mt-2 flex flex-col gap-4 border-l pl-4">
						{amountInput("sourceFee", t("transfers.form.outgoingFee"))}
						{amountInput("destinationFee", t("transfers.form.incomingFee"))}
					</div>
				</details>
			</form>

			<SheetFooter className="flex-row items-center justify-end gap-2 border-t">
				<Button type="button" variant="outline" onClick={onCancel}>
					{t("common.cancel")}
				</Button>
				<Button
					type="submit"
					form="transfer-form"
					disabled={isSubmitting}
					title={t("transactions.form.saveShortcut")}
					aria-keyshortcuts="Meta+Enter Control+Enter"
				>
					{t("transfers.form.submit")}
				</Button>
			</SheetFooter>
		</>
	);
}
