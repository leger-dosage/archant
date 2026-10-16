import type { ShownError } from "@/lib/form-errors";

import { useTranslation } from "react-i18next";

import type { AccountSubtype, AccountType } from "@archant/data/account-types";
import { allowsNullSubtype } from "@archant/data/account-types";

import { FieldMessage } from "@/components/FieldMessage";
import { InvestmentKindGroups } from "@/components/InvestmentKindGroups";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { ACCOUNT_KINDS, CRYPTO_KINDS, kindOf } from "@/lib/account-kinds";

type AccountSubtypeSelectProps = {
	id: string;
	type: AccountType;
	value: AccountSubtype | null;
	onChange: (subtype: AccountSubtype | null) => void;
	error: ShownError | undefined;
	label: string;
	/** Sure's `prompt`, shown while a type that requires a subtype has none. */
	prompt?: string | undefined;
};

/**
 * The subtype select of Sure's per-type forms: « Aucun » first where the type
 * takes none, Sure's `include_blank`, else Sure's prompt until one is chosen.
 * Investments are grouped by region and crypto subtypes read by their long
 * label, as Sure's selects.
 */
export function AccountSubtypeSelect({
	id,
	type,
	value,
	onChange,
	error,
	label,
	prompt,
}: AccountSubtypeSelectProps) {
	const { t } = useTranslation();
	const kinds = ACCOUNT_KINDS.filter((kind) => kind.type === type);
	const errorId = `${id}-error`;
	// An empty value shows the prompt: `kindOf` would name another kind.
	const selected = value === null && !allowsNullSubtype(type) ? "" : kindOf(type, value);

	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={id}>{label}</Label>
			<Select
				value={selected}
				onValueChange={(next) => {
					const kind = kinds.find((candidate) => candidate.id === next);

					if (kind !== undefined) {
						onChange(kind.subtype);
					}
				}}
			>
				<SelectTrigger
					id={id}
					className="w-full"
					aria-invalid={error !== undefined}
					{...(error === undefined ? {} : { "aria-describedby": errorId })}
				>
					<SelectValue placeholder={prompt} />
				</SelectTrigger>
				<SelectContent>
					{type === "investment" ? (
						<InvestmentKindGroups blankLabel={t("accountActions.form.noSubtype")} />
					) : type === "crypto" ? (
						// Sure's `cryptos/_form`: « Aucun », then each subtype's long label.
						<>
							<SelectItem value={kindOf("crypto", null)}>
								{t("accountActions.form.noSubtype")}
							</SelectItem>
							{CRYPTO_KINDS.map((kind) => (
								<SelectItem key={kind} value={kind}>
									{t(`accounts.subtypeLongs.${kind}`)}
								</SelectItem>
							))}
						</>
					) : (
						kinds.map((kind) => (
							<SelectItem key={kind.id} value={kind.id}>
								{/* Sure's `include_blank`: the empty choice reads « Aucun » here. */}
								{kind.subtype === null
									? t("accountActions.form.noSubtype")
									: t(`accounts.subtypes.${kind.id}`)}
							</SelectItem>
						))
					)}
				</SelectContent>
			</Select>
			<FieldMessage
				id={errorId}
				error={error}
				// Nothing chosen where a subtype is required reads as Sure's presence check.
				{...(value === null ? { messages: { invalid_subtype: t("errors.fields.too_small") } } : {})}
			/>
		</div>
	);
}
