import type { SecurityPick } from "@/components/SecurityCombobox";
import type { ShownError } from "@/lib/form-errors";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { TradeType } from "@archant/api/schemas/trades";

import { FieldMessage } from "@/components/FieldMessage";
import { SecurityCombobox, securityLabel } from "@/components/SecurityCombobox";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAccountHoldings } from "@/hooks/useHoldings";
import { fieldErrorCode } from "@/lib/form-errors";

/** A field's ARIA state, pointing at its message `id` when it has an error. */
export function describedBy(id: string, error: ShownError | undefined) {
	return {
		"aria-invalid": error !== undefined,
		...(error === undefined ? {} : { "aria-describedby": id }),
	};
}

/**
 * A field's error, with the trade forms' own sentence where the shared one
 * would mislead: `too_big` is an amount here, not a text, and a currency
 * mismatch is the security's, not a goal's.
 */
export function TradeFieldMessage({ id, error }: { id: string; error: ShownError | undefined }) {
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

/**
 * « Achat », « Vente », « Dividende », « Intérêts », as Sure's form offers
 * them; `options` narrows them, as an edit never changes a trade's kind.
 */
export function TradeTypeToggle({
	labelId,
	value,
	options,
	disabled = false,
	onChange,
}: {
	labelId: string;
	value: TradeType;
	options: readonly TradeType[];
	disabled?: boolean;
	onChange: (type: TradeType) => void;
}) {
	const { t } = useTranslation();

	return (
		<ToggleGroup
			type="single"
			variant="outline"
			spacing={0}
			aria-labelledby={labelId}
			disabled={disabled}
			value={value}
			// Radix reports an empty value when the pressed item is pressed again;
			// a trade always has a type.
			onValueChange={(next) => {
				const type = options.find((option) => option === next);

				if (type !== undefined) {
					onChange(type);
				}
			}}
		>
			{options.map((option) => (
				<ToggleGroupItem key={option} value={option} className="flex-1">
					{t(`trades.sides.${option}`)}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}

/** The search a buy or a sale picks its security from, in a popover under the field. */
export function SecurityPicker({
	id,
	picked,
	error,
	onPick,
}: {
	id: string;
	/** What the field shows, `null` until a security is picked. */
	picked: string | null;
	error: ShownError | undefined;
	onPick: (pick: SecurityPick) => void;
}) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					id={id}
					type="button"
					variant="outline"
					className="w-full justify-start font-normal"
					{...describedBy(`${id}-error`, error)}
				>
					<span className={picked === null ? "text-muted-foreground" : "truncate"}>
						{picked ?? t("trades.form.securityPlaceholder")}
					</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
				<SecurityCombobox
					onSelect={(pick) => {
						onPick(pick);
						setOpen(false);
					}}
				/>
			</PopoverContent>
		</Popover>
	);
}

/** A security the account holds, as an income names it. */
export type HeldChoice = { source: "known"; id: string };

const CASH = "cash";

/**
 * What an income is paid on: one of the account's positions, as Sure's form
 * offers its holdings only, or, for interest, « Liquidités » first, the
 * account's cash, which a dividend never is.
 */
export function IncomeSecuritySelect({
	id,
	accountId,
	side,
	value,
	error,
	onChange,
}: {
	id: string;
	accountId: string;
	side: "dividend" | "interest";
	/** `null` is the cash for interest, nothing picked yet for a dividend. */
	value: HeldChoice | null;
	error: ShownError | undefined;
	onChange: (choice: HeldChoice | null) => void;
}) {
	const { t } = useTranslation();
	const holdings = useAccountHoldings(accountId, true);
	const positions = holdings.data?.positions ?? [];
	const selected = value === null ? (side === "interest" ? CASH : "") : value.id;

	return (
		<Select
			value={selected}
			onValueChange={(next) => onChange(next === CASH ? null : { source: "known", id: next })}
		>
			<SelectTrigger id={id} className="w-full" {...describedBy(`${id}-error`, error)}>
				<SelectValue placeholder={t("trades.form.positionPlaceholder")} />
			</SelectTrigger>
			<SelectContent>
				{side === "interest" && <SelectItem value={CASH}>{t("trades.cash")}</SelectItem>}
				{positions.map((position) => (
					<SelectItem key={position.security.id} value={position.security.id}>
						{securityLabel(position.security)}
					</SelectItem>
				))}
				{positions.length === 0 && (holdings.isPending || holdings.isError) && (
					<p className="px-2 py-1.5 text-sm text-muted-foreground">
						{t(holdings.isPending ? "trades.form.positionsLoading" : "trades.form.positionsFailed")}
					</p>
				)}
				{side === "dividend" && holdings.isSuccess && positions.length === 0 && (
					<p className="px-2 py-1.5 text-sm text-muted-foreground">
						{t("trades.form.noPositions")}
					</p>
				)}
			</SelectContent>
		</Select>
	);
}
