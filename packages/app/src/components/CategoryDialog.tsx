import type { CategoryData } from "@/hooks/useCategories";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef } from "react";
import { useController, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { CreateCategoryInput } from "@archant/api/schemas/categories";
import { createCategorySchema } from "@archant/api/schemas/categories";
import { newCategory } from "@archant/data/category-presets";
import type { CategoryKind } from "@archant/data/category-presets";
import { CATEGORY_KINDS } from "@archant/data/category-presets";

import { ChoiceField } from "@/components/ChoiceField";
import { FieldMessage } from "@/components/FieldMessage";
import { TintedIcon } from "@/components/TintedIcon";
import { ColorPicker, IconPicker } from "@/components/TintPickers";
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
import { useCreateCategory, useUpdateCategory } from "@/hooks/useCategories";
import { ApiError } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors } from "@/lib/form-errors";

const FIELD_NAMES = ["name", "kind", "color", "icon", "parentId"] as const;

// Radix Select refuses an empty value, so « no parent » needs a token of its own.
const NO_PARENT = "none";

const valuesOf = (category: CategoryData): CreateCategoryInput => ({
	name: category.name,
	kind: category.kind,
	color: category.color,
	icon: category.icon,
	parentId: category.parentId,
});

const blank = (kind: CategoryKind | undefined): CreateCategoryInput =>
	kind === undefined ? newCategory() : { ...newCategory(), kind };

type CategoryDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The category to edit; absent to create one. */
	category?: CategoryData | undefined;
	/** Every category, for the parent choice. */
	categories: readonly CategoryData[];
	/** The type a new category starts with, as an empty group's button sets it. */
	kind?: CategoryKind | undefined;
};

/**
 * Creates or edits a category. Once a parent is chosen, the type and colour
 * disappear: the child takes its parent's, as the API enforces.
 */
export function CategoryDialog({
	open,
	onOpenChange,
	category,
	categories,
	kind: presetKind,
}: CategoryDialogProps) {
	const { t } = useTranslation();
	const createCategory = useCreateCategory();
	const updateCategory = useUpdateCategory();
	const form = useForm<CreateCategoryInput>({
		resolver: zodResolver(createCategorySchema),
		defaultValues: category === undefined ? blank(presetKind) : valuesOf(category),
	});
	const { errors, isSubmitting } = form.formState;
	const kind = useController({ control: form.control, name: "kind" });
	const color = useController({ control: form.control, name: "color" });
	const icon = useController({ control: form.control, name: "icon" });
	const parentId = useController({ control: form.control, name: "parentId" });
	const hasParent = parentId.field.value !== null;
	// A category with children stays top-level: the API would refuse a third level.
	const hasChildren =
		category !== undefined && categories.some((other) => other.parentId === category.id);
	const parents = categories.filter(
		(other) => other.parentId === null && other.id !== category?.id,
	);
	// A child shows in its parent's colour, as the API stores it.
	const previewColor =
		parents.find((parent) => parent.id === parentId.field.value)?.color ?? color.field.value;

	// Keyed on the id: the page hands over the category from the current list,
	// a new object on every refetch, which must not wipe what is being typed.
	const categoryId = category?.id;
	const latest = useRef(category);
	latest.current = category;

	useEffect(() => {
		if (open) {
			form.reset(latest.current === undefined ? blank(presetKind) : valuesOf(latest.current));
		}
	}, [open, categoryId, presetKind, form]);

	const submit = form.handleSubmit(async (values) => {
		try {
			if (category === undefined) {
				const created = await createCategory.mutateAsync(values);
				toast.success(t("categories.form.created", { name: created.name }));
			} else {
				const saved = await updateCategory.mutateAsync({ id: category.id, patch: values });
				toast.success(t("categories.form.saved", { name: saved.name }));
			}

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
		errors[name] === undefined ? {} : { "aria-describedby": `category-${name}-error` };

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>
						{t(category === undefined ? "categories.form.addTitle" : "categories.form.editTitle")}
					</DialogTitle>
					<DialogDescription>{t("categories.form.description")}</DialogDescription>
				</DialogHeader>
				<form
					id="category-form"
					noValidate
					className="flex flex-col gap-4"
					onSubmit={(event) => void submit(event)}
				>
					<div className="flex items-end gap-3">
						{/* Sure's form previews the category as the lists will draw it. */}
						<div role="img" aria-label={t("categories.form.preview")} className="py-0.5">
							<TintedIcon
								subject={{ kind: "category", color: previewColor, icon: icon.field.value }}
								size="lg"
							/>
						</div>
						<div className="flex min-w-0 flex-1 flex-col gap-1.5">
							<Label htmlFor="category-name">{t("categories.form.name")}</Label>
							<Input
								id="category-name"
								autoComplete="off"
								aria-invalid={errors.name !== undefined}
								{...describedBy("name")}
								{...form.register("name")}
							/>
						</div>
					</div>
					<FieldMessage id="category-name-error" error={errors.name} />

					<div className="flex flex-col gap-1.5">
						<ChoiceField
							id="category-parent"
							label={t("categories.form.parent")}
							value={parentId.field.value ?? NO_PARENT}
							disabled={hasChildren}
							options={[
								{ value: NO_PARENT, label: t("categories.form.noParent") },
								...parents.map((parent) => ({ value: parent.id, label: parent.name })),
							]}
							onChange={(value) => parentId.field.onChange(value === NO_PARENT ? null : value)}
						/>
						{hasChildren && (
							<p className="text-xs text-muted-foreground">{t("categories.form.parentLocked")}</p>
						)}
						<FieldMessage id="category-parentId-error" error={errors.parentId} />
					</div>

					{!hasParent && (
						<>
							<ChoiceField
								id="category-kind"
								label={t("categories.form.kind")}
								value={kind.field.value}
								options={CATEGORY_KINDS.map((value) => ({
									value,
									label: t(`categories.kinds.${value}`),
								}))}
								onChange={kind.field.onChange}
							/>

							<ColorPicker
								form="category"
								legend={t("categories.form.color")}
								value={color.field.value}
								onChange={color.field.onChange}
								error={errors.color}
							/>
						</>
					)}

					<IconPicker
						form="category"
						legend={t("categories.form.icon")}
						value={icon.field.value}
						onChange={icon.field.onChange}
						error={errors.icon}
					/>
				</form>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
						{t("common.cancel")}
					</Button>
					<Button type="submit" form="category-form" disabled={isSubmitting}>
						{t(category === undefined ? "categories.add" : "categories.form.save")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
