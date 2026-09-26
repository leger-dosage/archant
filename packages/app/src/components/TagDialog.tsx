import type { TagData } from "@/hooks/useTags";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { TagInput } from "@archant/api/schemas/tags";
import { tagSchema } from "@archant/api/schemas/tags";

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
import { useCreateTag, useRenameTag } from "@/hooks/useTags";
import { ApiError } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors, fieldErrorCode } from "@/lib/form-errors";

const FIELD_NAMES = ["name"] as const;

type TagDialogProps = {
	/** The tag to rename; absent to create one. */
	tag?: TagData | undefined;
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

/**
 * Creates a tag by name, or renames one: every transaction carrying it
 * shows the new name.
 */
export function TagDialog({ tag, open, onOpenChange }: TagDialogProps) {
	const { t } = useTranslation();
	const createTag = useCreateTag();
	const renameTag = useRenameTag();
	const form = useForm<TagInput>({
		resolver: zodResolver(tagSchema),
		defaultValues: { name: tag?.name ?? "" },
	});
	const { errors, isSubmitting } = form.formState;
	const error = errors.name;
	// Keyed on the id: the page hands over the tag from the current list,
	// a new object on every refetch, which must not wipe what is being typed.
	const tagId = tag?.id;
	const latest = useRef(tag);
	latest.current = tag;

	useEffect(() => {
		if (open) {
			form.reset({ name: latest.current?.name ?? "" });
		}
	}, [open, tagId, form]);

	const submit = form.handleSubmit(async (values) => {
		try {
			if (tag === undefined) {
				const created = await createTag.mutateAsync(values);
				toast.success(t("tags.dialog.created", { name: created.name }));
			} else {
				const saved = await renameTag.mutateAsync({ id: tag.id, name: values.name });
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
							: t("tags.dialog.renameTitle", { name: tag.name })}
					</DialogTitle>
					<DialogDescription>
						{t(tag === undefined ? "tags.dialog.addDescription" : "tags.dialog.renameDescription")}
					</DialogDescription>
				</DialogHeader>
				<form
					id="tag-form"
					noValidate
					className="flex flex-col gap-1.5"
					onSubmit={(event) => void submit(event)}
				>
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
				</form>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
						{t("common.cancel")}
					</Button>
					<Button type="submit" form="tag-form" disabled={isSubmitting}>
						{t(tag === undefined ? "tags.add" : "tags.dialog.rename")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
