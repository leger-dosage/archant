import type { BudgetCategoryData } from "@/hooks/useBudget";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo } from "react";
import { useController, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { BudgetMoveFormInput } from "@archant/api/schemas/budgets";
import { budgetMoveSchema } from "@archant/api/schemas/budgets";
import type { CurrencyCode } from "@archant/data/money";
import { formatMoney } from "@archant/data/money";

import { FieldMessage } from "@/components/FieldMessage";
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
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useMoveBudget } from "@/hooks/useBudget";
import { ApiError } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors } from "@/lib/form-errors";

const FIELD_NAMES = ["amount", "toCategoryId"] as const;

type BudgetMoveDialogProps = {
	month: string;
	currency: CurrencyCode;
	/** The category the money leaves. */
	source: BudgetCategoryData;
	/** Every expense category of the month, parents with their children under them. */
	categories: readonly BudgetCategoryData[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

/**
 * The form, mounted only while the dialog is open, so each opening starts
 * blank: a refused move's text does not outlive its dialog.
 */
function MoveForm({
	month,
	currency,
	source,
	categories,
	onOpenChange,
}: Omit<BudgetMoveDialogProps, "open">) {
	const { t } = useTranslation();
	const move = useMoveBudget(month);
	const schema = useMemo(() => budgetMoveSchema(currency), [currency]);
	const form = useForm<BudgetMoveFormInput>({
		// `raw` hands the typed text to the API as is: the same schema parses it there.
		resolver: zodResolver(schema, undefined, { raw: true }),
		defaultValues: { fromCategoryId: source.categoryId, toCategoryId: "", amount: "" },
	});
	const { errors, isSubmitting } = form.formState;
	const target = useController({ control: form.control, name: "toCategoryId" });
	// Sure's `move_allocation!` refuses the source itself, and a parent and its
	// own child either way. They stay listed, disabled, as Sure's
	// `budget_move_controller.js` does: a parent left out would leave its
	// children indented under the category before it.
	const refused = (line: BudgetCategoryData) =>
		line.categoryId === source.categoryId ||
		line.categoryId === source.parentId ||
		line.parentId === source.categoryId;
	// With nowhere to send the money, say why.
	const stuck = categories.every(refused);

	const submit = form.handleSubmit(async (values) => {
		try {
			await move.mutateAsync(values);
			toast.success(t("budgets.move.moved"));
			onOpenChange(false);
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

	const describedBy = (name: (typeof FIELD_NAMES)[number]) =>
		errors[name] === undefined ? {} : { "aria-describedby": `budget-move-${name}-error` };

	return (
		<>
			<DialogHeader>
				<DialogTitle>{t("budgets.move.title", { name: source.name })}</DialogTitle>
				<DialogDescription>
					{t("budgets.move.description", {
						name: source.name,
						amount: formatMoney({ amount: source.movable, currency }),
					})}
				</DialogDescription>
			</DialogHeader>
			<form
				id="budget-move-form"
				noValidate
				className="flex flex-col gap-4"
				onSubmit={(event) => void submit(event)}
			>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="budget-move-amount">{t("budgets.move.amount")}</Label>
					<Input
						id="budget-move-amount"
						inputMode="decimal"
						autoComplete="off"
						className="text-right tabular-nums"
						aria-invalid={errors.amount !== undefined}
						{...describedBy("amount")}
						{...form.register("amount")}
					/>
					<FieldMessage id="budget-move-amount-error" error={errors.amount} />
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="budget-move-target">{t("budgets.move.target")}</Label>
					<Select
						value={target.field.value}
						onValueChange={(value) => {
							target.field.onChange(value);
							form.clearErrors("toCategoryId");
						}}
					>
						<SelectTrigger
							id="budget-move-target"
							className="w-full"
							aria-invalid={errors.toCategoryId !== undefined}
							{...describedBy("toCategoryId")}
						>
							<SelectValue placeholder={t("budgets.move.placeholder")} />
						</SelectTrigger>
						<SelectContent>
							{categories.map((line) => (
								<SelectItem
									key={line.categoryId}
									value={line.categoryId}
									disabled={refused(line)}
									className={line.parentId === null ? undefined : "pl-5"}
								>
									{line.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<FieldMessage id="budget-move-toCategoryId-error" error={errors.toCategoryId} />
					{stuck && <p className="text-sm text-muted-foreground">{t("budgets.move.noTarget")}</p>}
				</div>
			</form>
			<DialogFooter>
				<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
					{t("common.cancel")}
				</Button>
				<Button type="submit" form="budget-move-form" disabled={isSubmitting || stuck}>
					{t("budgets.move.action")}
				</Button>
			</DialogFooter>
		</>
	);
}

/**
 * Sure's `_move_dialog`: moves money from one category to another of the
 * same month. It states what the source can give, its `movable`, where Sure
 * shows its gross amount: a parent's includes money only its children hold.
 */
export function BudgetMoveDialog({ open, onOpenChange, ...props }: BudgetMoveDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent showCloseButton={false}>
				{open && <MoveForm {...props} onOpenChange={onOpenChange} />}
			</DialogContent>
		</Dialog>
	);
}
