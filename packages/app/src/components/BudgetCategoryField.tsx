import type { BudgetCategoryData } from "@/hooks/useBudget";
import type { ShownError } from "@/lib/form-errors";

import { ArrowRightLeftIcon, CornerDownRightIcon } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { budgetCategorySchema } from "@archant/api/schemas/budgets";
import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { formatMoney } from "@archant/data/money";

import { BudgetMoveDialog } from "@/components/BudgetMoveDialog";
import { FieldMessage } from "@/components/FieldMessage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useSaveCategoryBudget, useSetCategoryRollover } from "@/hooks/useBudget";
import { amountToText } from "@/lib/amount-sign";
import { ApiError, errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { cn } from "@/lib/utils";

/** A blank field is 0: a subcategory left blank shares its parent's amount. */
const textOf = (amount: MinorUnits, currency: string) =>
	amount === 0 ? "" : amountToText(amount, currency);

function currencySymbol(currency: string): string {
	return (
		new Intl.NumberFormat("fr-FR", { style: "currency", currency })
			.formatToParts(0)
			.find((part) => part.type === "currency")?.value ?? currency
	);
}

/**
 * One row of the categories step: a colour mark, the name, the median, the
 * « Report » switch, the amount, then « Déplacer de l'argent » where the
 * category can give some.
 */
function CategoryAmountRow({
	color,
	label,
	median,
	currency,
	indented,
	fieldId,
	rollover,
	action,
	children,
}: {
	color: string;
	label: string;
	median: MinorUnits | null;
	currency: string;
	indented: boolean;
	fieldId: string;
	/** The « Report » switch; its place stays empty without one, so the amounts line up. */
	rollover?: React.ReactNode;
	/** The move button; its place stays empty without one, so the amounts line up. */
	action?: React.ReactNode;
	children: React.ReactNode;
}) {
	const { t } = useTranslation();

	return (
		// Below `sm` the controls take their own line: beside them, the QA capture
		// at 360 px showed each category's name cut to two letters.
		<div className="flex w-full flex-wrap items-start gap-x-3 gap-y-2 sm:flex-nowrap">
			{indented && (
				<CornerDownRightIcon
					aria-hidden="true"
					className="mt-2 ml-4 size-4 shrink-0 text-muted-foreground"
				/>
			)}
			<span
				aria-hidden="true"
				className="mt-1.5 h-3 w-1 shrink-0 rounded-xl"
				style={{ backgroundColor: color }}
			/>
			<div className="flex min-w-0 flex-1 flex-col text-sm">
				<label htmlFor={fieldId} className="truncate font-medium">
					{label}
				</label>
				<p id={`${fieldId}-median`} className="text-muted-foreground tabular-nums">
					{median === null
						? t("budgets.allocation.noMedian")
						: t("budgets.allocation.median", { amount: formatMoney({ amount: median, currency }) })}
				</p>
			</div>
			<div className="flex shrink-0 items-start justify-end gap-3 max-sm:w-full">
				<div className="flex h-9 shrink-0 items-center justify-end gap-1.5">
					{/* The switch's own width, so the amounts line up on a row without one. */}
					{rollover ?? <span aria-hidden="true" className="w-8" />}
				</div>
				{children}
				{action ?? <span aria-hidden="true" className="size-9 shrink-0" />}
			</div>
		</div>
	);
}

/** The amount box, the currency's symbol before it, as Sure's 120 px field. */
function AmountBox({ currency, children }: { currency: string; children: React.ReactNode }) {
	return (
		<div className="flex w-36 shrink-0 items-center gap-2">
			<span aria-hidden="true" className="text-sm text-muted-foreground">
				{currencySymbol(currency)}
			</span>
			{children}
		</div>
	);
}

/**
 * Sure's rollover toggle: what the category leaves this month carries into
 * the next month set up, and the choice holds for the later months too. Saved
 * on change, after the month's other writes.
 */
function RolloverSwitch({ month, line }: { month: string; line: BudgetCategoryData }) {
	const { t } = useTranslation();
	const switchId = useId();
	const save = useSetCategoryRollover(month);
	// The choice sent shows at once; the answer, or a failure, settles it. Never
	// disabled meanwhile, which would drop keyboard focus: the month's scope
	// already sends its writes one after the other.
	const checked = save.isPending ? save.variables.input.rolloverEnabled : line.rolloverEnabled;

	return (
		<span className="flex items-center gap-1.5">
			{/* Hidden on a narrow screen, where the name needs the room; the switch keeps its name. */}
			<label
				htmlFor={switchId}
				className="hidden cursor-pointer text-xs text-muted-foreground sm:inline"
			>
				{t("budgets.rollover.label")}
			</label>
			<Switch
				id={switchId}
				checked={checked}
				aria-label={t("budgets.rollover.toggle", { name: line.name })}
				title={t("budgets.rollover.title")}
				onCheckedChange={(rolloverEnabled) =>
					save.mutate(
						{ categoryId: line.categoryId, input: { rolloverEnabled } },
						{ onError: (error) => showErrorToast(errorCodeOf(error)) },
					)
				}
			/>
		</span>
	);
}

/**
 * An expense category's amount for the month, saved when it changes, on
 * leaving the field or on `Enter`, as Sure's auto-submitted field. A blank
 * subcategory reads « Partagé ». The field follows the month as the server
 * answers it, the parent's new total included, unless it holds unsaved text.
 */
export function BudgetCategoryField({
	month,
	currency,
	line,
	parentName,
	categories,
}: {
	month: string;
	currency: CurrencyCode;
	line: BudgetCategoryData;
	/** The parent's name, for a subcategory's hint. */
	parentName: string | null;
	/** Every expense category of the month, where a move can send money. */
	categories: readonly BudgetCategoryData[];
}) {
	const { t } = useTranslation();
	const fieldId = useId();
	const [moving, setMoving] = useState(false);
	const save = useSaveCategoryBudget(month);
	const saved = textOf(line.budgetedSpending, currency);
	const [text, setText] = useState(saved);
	const [shown, setShown] = useState(saved);
	const [error, setError] = useState<ShownError | undefined>(undefined);

	// A save elsewhere, a child's moving its parent, reaches an untouched field.
	if (saved !== shown) {
		setShown(saved);

		if (text === shown) {
			setText(saved);
		}
	}

	const commit = async () => {
		if (text.trim() === shown) {
			setError(undefined);

			return;
		}

		const parsed = budgetCategorySchema(currency).shape.budgetedSpending.safeParse(text);

		if (!parsed.success) {
			setError({ type: "custom", message: parsed.error.issues[0]?.message ?? "unknown" });

			return;
		}

		setError(undefined);

		if (parsed.data === line.budgetedSpending) {
			setText(saved);

			return;
		}

		const sent = text;

		try {
			const budget = await save.mutateAsync({
				categoryId: line.categoryId,
				input: { budgetedSpending: sent },
			});
			const next = budget.categories.find((item) => item.categoryId === line.categoryId);
			const nextText = next === undefined ? "" : textOf(next.budgetedSpending, currency);

			// Text typed while the save ran, after `Enter`, is the owner's, not the answer's.
			setText((current) => (current === sent ? nextText : current));
			setShown(nextText);
		} catch (caught) {
			const apiError = caught instanceof ApiError ? caught : new ApiError("INTERNAL_ERROR");
			const field = apiError.fields.find((item) => item.path === "budgetedSpending");

			if (field === undefined) {
				showErrorToast(apiError.code);
			} else {
				setError({ type: "custom", message: field.code });
			}
		}
	};

	const describedBy = [
		`${fieldId}-median`,
		parentName === null ? null : `${fieldId}-hint`,
		error === undefined ? null : `${fieldId}-error`,
	]
		.filter((id) => id !== null)
		.join(" ");

	return (
		<div className="flex flex-col gap-1">
			<CategoryAmountRow
				color={line.color}
				label={line.name}
				median={line.median}
				currency={currency}
				indented={line.parentId !== null}
				fieldId={fieldId}
				rollover={<RolloverSwitch month={month} line={line} />}
				action={
					// Sure offers a move from any amount; Archant from what can be
					// given, so a shared child or a parent its children hold has none.
					line.movable > 0 ? (
						<Button
							type="button"
							variant="ghost"
							size="icon"
							aria-label={t("budgets.move.open", { name: line.name })}
							title={t("budgets.move.open", { name: line.name })}
							onClick={() => setMoving(true)}
						>
							<ArrowRightLeftIcon aria-hidden="true" />
						</Button>
					) : undefined
				}
			>
				<AmountBox currency={currency}>
					<Input
						id={fieldId}
						inputMode="decimal"
						autoComplete="off"
						className="text-right tabular-nums"
						placeholder={line.parentId === null ? "0" : t("budgets.allocation.shared")}
						value={text}
						aria-invalid={error !== undefined}
						aria-describedby={describedBy}
						onChange={(event) => setText(event.target.value)}
						onBlur={() => void commit()}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								void commit();
							}
						}}
					/>
				</AmountBox>
			</CategoryAmountRow>
			{parentName !== null && (
				<p id={`${fieldId}-hint`} className="sr-only">
					{t("budgets.allocation.sharedHint", { parent: parentName })}
				</p>
			)}
			{/* Under the amount it is about, not under the move button. */}
			<div className={cn("flex justify-end pr-12", error === undefined && "hidden")}>
				<FieldMessage id={`${fieldId}-error`} error={error} />
			</div>
			<BudgetMoveDialog
				month={month}
				currency={currency}
				source={line}
				categories={categories}
				open={moving}
				onOpenChange={setMoving}
			/>
		</div>
	);
}

/** « Sans catégorie »: what the total leaves unallocated, shown, never typed. */
export function UncategorisedField({
	currency,
	amount,
	median,
	name,
	color,
}: {
	currency: string;
	amount: MinorUnits;
	median: MinorUnits | null;
	name: string;
	color: string;
}) {
	const { t } = useTranslation();
	const fieldId = useId();

	return (
		<CategoryAmountRow
			color={color}
			label={name}
			median={median}
			currency={currency}
			indented={false}
			fieldId={fieldId}
		>
			<AmountBox currency={currency}>
				<Input
					id={fieldId}
					readOnly
					className="text-right text-muted-foreground tabular-nums"
					value={amountToText(amount, currency)}
					aria-describedby={`${fieldId}-median ${fieldId}-hint`}
				/>
				<span id={`${fieldId}-hint`} className="sr-only">
					{t("budgets.allocation.uncategorisedHint")}
				</span>
			</AmountBox>
		</CategoryAmountRow>
	);
}
