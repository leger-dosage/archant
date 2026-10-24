import type { TagData } from "@/hooks/useTags";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef } from "react";
import { useController, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { TagInput } from "@archant/api/schemas/tags";
import { tagSchema } from "@archant/api/schemas/tags";
import { sampleCategoryColor } from "@archant/data/category-presets";

import { TagBadge } from "@/components/TagBadge";
import { ColorPicker } from "@/components/TintPickers";
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
import { useCreateTag, useUpdateTag } from "@/hooks/useTags";
import { ApiError } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors, fieldErrorCode } from "@/lib/form-errors";

const FIELD_NAMES = ["name", "color"] as const;

/** A new tag draws one of Sure's ten, as `Tag::COLORS.sample`. */
function valuesOf(tag: TagData | undefined): TagInput {
	return tag === undefined
		? { name: "", color: sampleCategoryColor() }
		: { name: tag.name, color: tag.color };
}

type TagDialogProps = {
	/** The tag to edit; absent to create one. */
	tag?: TagData | undefined;
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

/**
 * Creates or edits a tag, as Sure's `tags/_form.html.erb`: its badge, Sure's
 * ten colours and its name; every transaction carrying it shows both.
 */
export function TagDialog({ tag, open, onOpenChange }: TagDialogProps) {
	const { t } = useTranslation();
	const createTag = useCreateTag();
	const updateTag = useUpdateTag();
	const form = useForm<TagInput>({
		resolver: zodResolver(tagSchema),
		defaultValues: valuesOf(tag),
	});
	const color = useController({ control: form.control, name: "color" });
	const { errors, isSubmitting } = form.formState;
	const error = errors.name;
	// Keyed on the id: the page hands over the tag from the current list,
	// a new object on every refetch, which must not wipe what is being typed.
	const tagId = tag?.id;
	const latest = useRef(tag);
	latest.current = tag;

	useEffect(() => {
		if (open) {
			form.reset(valuesOf(latest.current));
		}
	}, [open, tagId, form]);

	const submit = form.handleSubmit(async (values) => {
		try {
			if (tag === undefined) {
				const created = await createTag.mutateAsync(values);
				toast.success(t("tags.dialog.created", { name: created.name }));
			} else {
				const saved = await updateTag.mutateAsync({ id: tag.id, ...values });
				toast.success(t("tags.dialog.saved", { name: saved.name }));
			}

			onOpenChange(false);
		} catch (caught) {
			const apiError = caught instanceof ApiError ? caught : new ApiError("INTERNAL_ERROR");
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

	const code = error === undefined ? null : fieldErrorCode(error);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>
						{tag === undefined
							? t("tags.dialog.addTitle")
							: t("tags.dialog.editTitle", { name: tag.name })}
					</DialogTitle>
					<DialogDescription>
						{t(tag === undefined ? "tags.dialog.addDescription" : "tags.dialog.editDescription")}
					</DialogDescription>
				</DialogHeader>
				<form
					id="tag-form"
					noValidate
					className="flex flex-col gap-4"
					onSubmit={(event) => void submit(event)}
				>
					<TagBadge
						className="self-center"
						tag={{
							name: form.watch("name") || t("tags.dialog.name"),
							color: color.field.value ?? "",
						}}
					/>
					<ColorPicker
						key={tagId ?? "new"}
						form="tag"
						legend={t("tags.dialog.color")}
						value={color.field.value ?? ""}
						onChange={color.field.onChange}
						error={errors.color}
					/>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="tag-name">{t("tags.dialog.name")}</Label>
						<Input
							id="tag-name"
							autoComplete="off"
							aria-invalid={error !== undefined}
							{...(error === undefined ? {} : { "aria-describedby": "tag-name-error" })}
							{...form.register("name")}
						/>
						{code !== null && (
							<p id="tag-name-error" className="text-xs text-destructive">
								{/* The shared message names a category. */}
								{code === "name_taken" ? t("tags.dialog.nameTaken") : t(`errors.fields.${code}`)}
							</p>
						)}
					</div>
				</form>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
						{t("common.cancel")}
					</Button>
					<Button type="submit" form="tag-form" disabled={isSubmitting}>
						{t(tag === undefined ? "tags.add" : "tags.dialog.save")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
