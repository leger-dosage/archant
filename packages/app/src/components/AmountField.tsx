import type { Nature } from "@/lib/amount-sign";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialNature, joinAmount, splitAmount } from "@/lib/amount-sign";

type AmountFieldProps = {
	id: string;
	/** Signed text, as the schema reads it: `-42,90` is an expense. */
	value: string;
	onChange: (value: string) => void;
	onBlur?: () => void;
	invalid?: boolean;
	describedBy?: string;
	disabled?: boolean;
	/** The toggle's position for an empty field: a split's new line takes its parent's. */
	defaultNature?: Nature;
	/** The toggle's name, when a form holds several amounts. */
	natureLabel?: string;
};

const NATURES: readonly Nature[] = ["expense", "income"];

/**
 * An amount with a Dépense / Revenu toggle instead of a minus sign
 * (EXPERIENCE.md). Dépense by default; typing a leading minus switches to it.
 * Mount a fresh one per transaction: the toggle is local state.
 */
export function AmountField({
	id,
	value,
	onChange,
	onBlur,
	invalid = false,
	describedBy,
	disabled = false,
	defaultNature = "expense",
	natureLabel,
}: AmountFieldProps) {
	const { t } = useTranslation();
	const [nature, setNature] = useState<Nature>(() =>
		value.trim() === "" ? defaultNature : initialNature(value),
	);
	const { magnitude } = splitAmount(value, nature);

	return (
		<div className="flex gap-2">
			<div
				role="group"
				aria-label={natureLabel ?? t("transactions.form.nature")}
				className="flex shrink-0 rounded-md border p-0.5"
			>
				{NATURES.map((option) => (
					<Button
						key={option}
						type="button"
						size="sm"
						variant={nature === option ? "secondary" : "ghost"}
						aria-pressed={nature === option}
						disabled={disabled}
						onClick={() => {
							setNature(option);
							onChange(joinAmount({ nature: option, magnitude }));
						}}
					>
						{t(`transactions.form.${option}`)}
					</Button>
				))}
			</div>
			<Input
				id={id}
				value={magnitude}
				inputMode="decimal"
				autoComplete="off"
				className="text-right tabular-nums"
				aria-invalid={invalid}
				disabled={disabled}
				{...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
				onChange={(event) => {
					const next = splitAmount(event.target.value, nature);
					setNature(next.nature);
					onChange(joinAmount(next));
				}}
				{...(onBlur === undefined ? {} : { onBlur })}
			/>
		</div>
	);
}
