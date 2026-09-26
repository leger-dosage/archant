import type { MerchantData } from "@/hooks/useMerchants";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { MerchantInput } from "@archant/api/schemas/merchants";
import { merchantSchema } from "@archant/api/schemas/merchants";

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
import { useCreateMerchant, useRenameMerchant } from "@/hooks/useMerchants";
import { ApiError } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors, fieldErrorCode } from "@/lib/form-errors";

const FIELD_NAMES = ["name"] as const;

type MerchantDialogProps = {
	/** The merchant to rename; absent to create one. */
	merchant?: MerchantData | undefined;
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

/**
 * Creates a merchant by name, or renames one: every transaction linked to it
 * shows the new name.
 */
export function MerchantDialog({ merchant, open, onOpenChange }: MerchantDialogProps) {
	const { t } = useTranslation();
	const createMerchant = useCreateMerchant();
	const renameMerchant = useRenameMerchant();
	const form = useForm<MerchantInput>({
		resolver: zodResolver(merchantSchema),
		defaultValues: { name: merchant?.name ?? "" },
	});
	const { errors, isSubmitting } = form.formState;
	const error = errors.name;
	// Keyed on the id: the page hands over the merchant from the current list,
	// a new object on every refetch, which must not wipe what is being typed.
	const merchantId = merchant?.id;
	const latest = useRef(merchant);
	latest.current = merchant;

	useEffect(() => {
		if (open) {
			form.reset({ name: latest.current?.name ?? "" });
		}
	}, [open, merchantId, form]);

	const submit = form.handleSubmit(async (values) => {
		try {
			if (merchant === undefined) {
				const created = await createMerchant.mutateAsync(values);
				toast.success(t("merchants.dialog.created", { name: created.name }));
			} else {
				const saved = await renameMerchant.mutateAsync({ id: merchant.id, name: values.name });
				toast.success(t("merchants.dialog.saved", { name: saved.name }));
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
						{merchant === undefined
							? t("merchants.dialog.addTitle")
							: t("merchants.dialog.renameTitle", { name: merchant.name })}
					</DialogTitle>
					<DialogDescription>
						{t(
							merchant === undefined
								? "merchants.dialog.addDescription"
								: "merchants.dialog.renameDescription",
						)}
					</DialogDescription>
				</DialogHeader>
				<form
					id="merchant-form"
					noValidate
					className="flex flex-col gap-1.5"
					onSubmit={(event) => void submit(event)}
				>
					<Label htmlFor="merchant-name">{t("merchants.dialog.name")}</Label>
					<Input
						id="merchant-name"
						autoComplete="off"
						aria-invalid={error !== undefined}
						{...(error === undefined ? {} : { "aria-describedby": "merchant-name-error" })}
						{...form.register("name")}
					/>
					{code !== null && (
						<p id="merchant-name-error" className="text-xs text-destructive">
							{/* The shared message names a category. */}
							{code === "name_taken" ? t("merchants.dialog.nameTaken") : t(`errors.fields.${code}`)}
						</p>
					)}
				</form>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
						{t("common.cancel")}
					</Button>
					<Button type="submit" form="merchant-form" disabled={isSubmitting}>
						{t(merchant === undefined ? "merchants.add" : "merchants.dialog.rename")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
