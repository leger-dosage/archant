import type { CategoryData } from "@/hooks/useCategories";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useMergeCategory } from "@/hooks/useCategories";
import { errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";

type MergeCategoryDialogProps = {
	category: CategoryData;
	categories: readonly CategoryData[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

/**
 * Merges a category into another. A category with children is not offered
 * any child as target, its own or another's: they would land on a third level.
 */
export function MergeCategoryDialog({
	category,
	categories,
	open,
	onOpenChange,
}: MergeCategoryDialogProps) {
	const { t } = useTranslation();
	const mergeCategory = useMergeCategory();
	const [targetId, setTargetId] = useState<string | undefined>();
	const count = category.transactionCount;
	const hasChildren = categories.some((other) => other.parentId === category.id);
	const targets = categories.filter(
		(other) => other.id !== category.id && !(hasChildren && other.parentId !== null),
	);

	useEffect(() => {
		if (open) {
			setTargetId(undefined);
		}
	}, [open]);

	const confirm = () => {
		const target = targets.find((other) => other.id === targetId);

		if (target === undefined) {
			return;
		}

		mergeCategory.mutate(
			{ id: category.id, targetId: target.id },
			{
				onSuccess: () => {
					toast.success(
						t("categories.mergeDialog.merged", { name: category.name, target: target.name }),
					);
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
					<DialogTitle>{t("categories.mergeDialog.title", { name: category.name })}</DialogTitle>
					<DialogDescription>
						{count === 0
							? t("categories.mergeDialog.descriptionNone", { name: category.name })
							: t("categories.mergeDialog.description", { count, name: category.name })}
						{hasChildren && ` ${t("categories.mergeDialog.children")}`}
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="merge-category-target">{t("categories.mergeDialog.target")}</Label>
					<Select value={targetId ?? ""} onValueChange={setTargetId}>
						<SelectTrigger id="merge-category-target" className="w-full">
							<SelectValue placeholder={t("categories.mergeDialog.placeholder")} />
						</SelectTrigger>
						<SelectContent>
							{targets.map((target) => (
								<SelectItem key={target.id} value={target.id}>
									{target.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
						{t("common.cancel")}
					</Button>
					<Button
						type="button"
						disabled={targetId === undefined || mergeCategory.isPending}
						onClick={confirm}
					>
						{t("categories.mergeDialog.action")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
