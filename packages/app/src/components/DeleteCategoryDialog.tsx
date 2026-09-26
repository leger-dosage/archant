import type { CategoryData } from "@/hooks/useCategories";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ChoiceField } from "@/components/ChoiceField";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useDeleteCategory } from "@/hooks/useCategories";
import { errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";

// Radix Select refuses an empty value, so « leave uncategorised » needs a token.
const UNCATEGORISED = "none";

type DeleteCategoryDialogProps = {
	category: CategoryData;
	categories: readonly CategoryData[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

/**
 * Deletes a category after saying how many transactions it holds, and lets
 * the user send them to another category or leave them uncategorised.
 */
export function DeleteCategoryDialog({
	category,
	categories,
	open,
	onOpenChange,
}: DeleteCategoryDialogProps) {
	const { t } = useTranslation();
	const deleteCategory = useDeleteCategory();
	const [destination, setDestination] = useState(UNCATEGORISED);
	const count = category.transactionCount;
	const hasChildren = categories.some((other) => other.parentId === category.id);

	useEffect(() => {
		if (open) {
			setDestination(UNCATEGORISED);
		}
	}, [open]);

	const confirm = () => {
		deleteCategory.mutate(
			{ id: category.id, replacementId: destination === UNCATEGORISED ? null : destination },
			{
				onSuccess: () => {
					toast.success(t("categories.deleteDialog.deleted", { name: category.name }));
					onOpenChange(false);
				},
				onError: (error) => showErrorToast(errorCodeOf(error)),
			},
		);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>{t("categories.deleteDialog.title", { name: category.name })}</DialogTitle>
					<DialogDescription>
						{count === 0
							? t("categories.deleteDialog.none")
							: t("categories.deleteDialog.count", { count })}
						{hasChildren && ` ${t("categories.deleteDialog.children")}`}
					</DialogDescription>
				</DialogHeader>
				{count > 0 && (
					<ChoiceField
						id="delete-category-destination"
						label={t("categories.deleteDialog.destination")}
						value={destination}
						options={[
							{ value: UNCATEGORISED, label: t("categories.deleteDialog.uncategorised") },
							...categories
								.filter((other) => other.id !== category.id)
								.map((other) => ({ value: other.id, label: other.name })),
						]}
						onChange={setDestination}
					/>
				)}
				<DialogFooter>
					<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
						{t("common.cancel")}
					</Button>
					<Button
						type="button"
						variant="destructive"
						disabled={deleteCategory.isPending}
						onClick={confirm}
					>
						{t("categories.deleteDialog.action")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
