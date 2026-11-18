import type { BudgetCategoryData } from "@/hooks/useBudget";

import { useController, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { BudgetMoveInput } from "@archant/api/schemas/budgets";
import type { CurrencyCode } from "@archant/data/money";

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
import { showFailureToast } from "@/lib/error-toast";
import { formatMoney } from "@/lib/format-money";

type BudgetMoveDialogProps = {
	month: string;
	currency: CurrencyCode;
	/** The category the money leaves. */
	source: BudgetCategoryData;
	/** Every category of the month, parents with their children under them. */
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
	const form = useForm<BudgetMoveInput>({
		defaultValues: { fromCategoryId: source.categoryId, toCategoryId: "", amount: "" },
	});
	const { isSubmitting } = form.formState;
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
			const invalidAmount =
				error instanceof ApiError &&
				error.fields.some((field) => field.path === "amount" && field.code === "invalid_amount");

			if (invalidAmount) {
				toast.error(t("errors.fields.invalid_amount"));
			} else {
				showFailureToast(error);
			}
		}
	});

	return (
		<>
			<DialogHeader>
				<DialogTitle>{t("budgets.move.title", { name: source.name })}</DialogTitle>
				<DialogDescription>
					{t("budgets.move.description", {
						name: source.name,
						amount: formatMoney({ amount: source.budgetedSpending, currency }),
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
						{...form.register("amount")}
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="budget-move-target">{t("budgets.move.target")}</Label>
					<Select value={target.field.value} onValueChange={target.field.onChange}>
						<SelectTrigger id="budget-move-target" className="w-full">
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
					{stuck && <p className="text-sm text-muted-foreground">{t("budgets.move.noTarget")}</p>}
				</div>
			</form>
			<DialogFooter>
				<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
					{t("common.cancel")}
				</Button>
				<Button
					type="submit"
					form="budget-move-form"
					disabled={isSubmitting || stuck || target.field.value === ""}
				>
					{t("budgets.move.action")}
				</Button>
			</DialogFooter>
		</>
	);
}

/**
 * Sure's `_move_dialog`: moves money from one category to another of the
 * same month. The description shows the stored amount, which can include
 * money reserved for the source's children.
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
