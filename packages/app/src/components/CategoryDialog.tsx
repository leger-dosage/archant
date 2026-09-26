import type { CategoryData } from "@/hooks/useCategories";
import type { FieldError } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef } from "react";
import { useController, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { CreateCategoryInput } from "@archant/api/schemas/categories";
import { createCategorySchema } from "@archant/api/schemas/categories";
import type { CategoryColor } from "@archant/data/category-presets";
import { CATEGORY_COLORS, CATEGORY_ICONS } from "@archant/data/category-presets";
import { CATEGORY_KINDS } from "@archant/data/schema/categories";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateCategory, useUpdateCategory } from "@/hooks/useCategories";
import { ApiError } from "@/lib/api";
import { CATEGORY_ICON_COMPONENTS } from "@/lib/category-icons";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors, fieldErrorCode } from "@/lib/form-errors";

const FIELD_NAMES = ["name", "kind", "color", "icon", "parentId"] as const;

// Radix Select refuses an empty value, so « no parent » needs a token of its own.
const NO_PARENT = "none";

const defaults = (): CreateCategoryInput => ({
	name: "",
	kind: "expense",
	color: CATEGORY_COLORS[0],
	icon: "tag",
	parentId: null,
});

const valuesOf = (category: CategoryData): CreateCategoryInput => ({
	name: category.name,
	kind: category.kind,
	color: category.color,
	icon: category.icon,
	parentId: category.parentId,
});

function isSwatch(color: string): color is CategoryColor {
	return CATEGORY_COLORS.some((swatch) => swatch === color);
}

function FieldMessage({ id, error }: { id: string; error: FieldError | undefined }) {
	const { t } = useTranslation();

	if (error === undefined) {
		return null;
	}

	return (
		<p id={id} className="text-xs text-destructive">
			{t(`errors.fields.${fieldErrorCode(error)}`)}
		</p>
	);
}

type CategoryDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The category to edit; absent to create one. */
	category?: CategoryData | undefined;
	/** Every category, for the parent choice. */
	categories: readonly CategoryData[];
};

/**
 * Creates or edits a category. Once a parent is chosen, the type and colour
 * disappear: the child takes its parent's, as the API enforces.
 */
export function CategoryDialog({ open, onOpenChange, category, categories }: CategoryDialogProps) {
	const { t } = useTranslation();
	const createCategory = useCreateCategory();
	const updateCategory = useUpdateCategory();
	const form = useForm<CreateCategoryInput>({
		resolver: zodResolver(createCategorySchema),
		defaultValues: category === undefined ? defaults() : valuesOf(category),
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
	// A default carries one of Sure's own colours, outside the swatches; it
	// stays offered so an edit does not force a new one.
	const colors: string[] = isSwatch(color.field.value)
		? [...CATEGORY_COLORS]
		: [color.field.value, ...CATEGORY_COLORS];

	// Keyed on the id: the page hands over the category from the current list,
	// a new object on every refetch, which must not wipe what is being typed.
	const categoryId = category?.id;
	const latest = useRef(category);
	latest.current = category;

	useEffect(() => {
		if (open) {
			form.reset(latest.current === undefined ? defaults() : valuesOf(latest.current));
		}
	}, [open, categoryId, form]);

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
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="category-name">{t("categories.form.name")}</Label>
						<Input
							id="category-name"
							autoComplete="off"
							aria-invalid={errors.name !== undefined}
							{...describedBy("name")}
							{...form.register("name")}
						/>
						<FieldMessage id="category-name-error" error={errors.name} />
					</div>

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

							<fieldset className="flex flex-col gap-1.5" {...describedBy("color")}>
								<legend className="mb-1.5 text-sm font-medium">{t("categories.form.color")}</legend>
								<div className="flex flex-wrap gap-2">
									{colors.map((swatch) => (
										<label key={swatch} className="relative cursor-pointer">
											<input
												type="radio"
												name="category-color"
												value={swatch}
												checked={color.field.value === swatch}
												onChange={() => color.field.onChange(swatch)}
												className="peer sr-only"
											/>
											<span
												aria-hidden="true"
												className="block size-7 rounded-full ring-offset-2 ring-offset-background peer-checked:ring-2 peer-checked:ring-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring"
												style={{ backgroundColor: swatch }}
											/>
											<span className="sr-only">
												{isSwatch(swatch)
													? t(`categories.colors.${swatch}`)
													: t("categories.form.currentColor")}
											</span>
										</label>
									))}
								</div>
								<FieldMessage id="category-color-error" error={errors.color} />
							</fieldset>
						</>
					)}

					<fieldset className="flex flex-col gap-1.5" {...describedBy("icon")}>
						<legend className="mb-1.5 text-sm font-medium">{t("categories.form.icon")}</legend>
						<div className="flex flex-wrap gap-1">
							{CATEGORY_ICONS.map((name) => {
								const Icon = CATEGORY_ICON_COMPONENTS[name];

								return (
									<label
										key={name}
										className="relative cursor-pointer"
										title={t(`categories.icons.${name}`)}
									>
										<input
											type="radio"
											name="category-icon"
											value={name}
											checked={icon.field.value === name}
											onChange={() => icon.field.onChange(name)}
											className="peer sr-only"
										/>
										<span
											aria-hidden="true"
											className="flex size-8 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:bg-accent peer-checked:border-foreground peer-checked:text-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-ring"
										>
											<Icon className="size-4" />
										</span>
										<span className="sr-only">{t(`categories.icons.${name}`)}</span>
									</label>
								);
							})}
						</div>
						<FieldMessage id="category-icon-error" error={errors.icon} />
					</fieldset>
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
