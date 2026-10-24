import type { CategoryData } from "@/hooks/useCategories";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useMergeCategories } from "@/hooks/useCategories";
import { ApiError } from "@/lib/api";
import { categoryTree } from "@/lib/category-tree";
import { fieldErrorCode } from "@/lib/form-errors";

type MergeCategoryDialogProps = {
	categories: readonly CategoryData[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

/** Sure's `display_name_with_parent`: « Logement > Loyer » for a child. */
function nameWithParent(category: CategoryData, categories: readonly CategoryData[]): string {
	const parent = categories.find((candidate) => candidate.id === category.parentId);

	return parent === undefined ? category.name : `${parent.name} > ${category.name}`;
}

/**
 * Sure's `categories/merge.html.erb`: a target, then the categories to merge
 * into it. The target's own box is disabled, where Sure's hint asks not to
 * tick it; a merge the server refuses, a parent into its own child for one,
 * shows its reason above the button.
 */
export function MergeCategoryDialog({ categories, open, onOpenChange }: MergeCategoryDialogProps) {
	const { t } = useTranslation();
	const mergeCategories = useMergeCategories();
	const [targetId, setTargetId] = useState<string | undefined>();
	const [sourceIds, setSourceIds] = useState<readonly string[]>([]);
	const [refusal, setRefusal] = useState<string | null>(null);
	const ordered = categoryTree(categories).flatMap(({ parent, children }) => [parent, ...children]);
	const target = categories.find((category) => category.id === targetId);
	const sources = sourceIds.filter((id) => id !== targetId);

	useEffect(() => {
		if (open) {
			setTargetId(undefined);
			setSourceIds([]);
			setRefusal(null);
		}
	}, [open]);

	const toggle = (id: string, checked: boolean) => {
		setRefusal(null);
		setSourceIds((current) =>
			checked ? [...current, id] : current.filter((sourceId) => sourceId !== id),
		);
	};

	const confirm = () => {
		if (target === undefined || sources.length === 0) {
			return;
		}

		mergeCategories.mutate(
			{ targetId: target.id, sourceIds: sources },
			{
				onSuccess: () => {
					toast.success(
						t("categories.mergeDialog.merged", { count: sources.length, target: target.name }),
					);
					onOpenChange(false);
				},
				onError: (error) => {
					const apiError = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR");
					const [field] = apiError.fields;

					setRefusal(
						field === undefined
							? t(`errors.${apiError.code}`)
							: t(`errors.fields.${fieldErrorCode({ type: field.code })}`),
					);
				},
			},
		);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>{t("categories.mergeDialog.title")}</DialogTitle>
					<DialogDescription>{t("categories.mergeDialog.description")}</DialogDescription>
				</DialogHeader>
				<div className="flex min-h-0 flex-col gap-4">
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="merge-category-target">{t("categories.mergeDialog.target")}</Label>
						<Select
							value={targetId ?? ""}
							onValueChange={(next) => {
								setRefusal(null);
								setTargetId(next);
							}}
						>
							<SelectTrigger id="merge-category-target" className="w-full">
								<SelectValue placeholder={t("categories.mergeDialog.placeholder")} />
							</SelectTrigger>
							<SelectContent>
								{ordered.map((category) => (
									<SelectItem key={category.id} value={category.id}>
										{nameWithParent(category, categories)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<fieldset className="flex min-h-0 flex-col gap-1.5">
						<legend className="mb-1.5 text-sm font-medium">
							{t("categories.mergeDialog.sources")}
						</legend>
						<ul className="max-h-64 overflow-y-auto rounded-lg border p-1">
							{ordered.map((category) => {
								const id = `merge-category-source-${category.id}`;

								return (
									<li key={category.id} className="flex items-center gap-2 rounded-md px-2 py-1.5">
										<Checkbox
											id={id}
											checked={category.id !== targetId && sourceIds.includes(category.id)}
											disabled={category.id === targetId}
											onCheckedChange={(checked) => toggle(category.id, checked === true)}
										/>
										<Label htmlFor={id} className="min-w-0 flex-1 font-normal">
											<span className="truncate">{nameWithParent(category, categories)}</span>
										</Label>
									</li>
								);
							})}
						</ul>
						<p className="text-xs text-muted-foreground">{t("categories.mergeDialog.hint")}</p>
					</fieldset>
					{refusal !== null && (
						<p role="alert" className="text-sm text-destructive">
							{refusal}
						</p>
					)}
				</div>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
						{t("common.cancel")}
					</Button>
					<Button
						type="button"
						disabled={target === undefined || sources.length === 0 || mergeCategories.isPending}
						onClick={confirm}
					>
						{t("categories.mergeDialog.action")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
