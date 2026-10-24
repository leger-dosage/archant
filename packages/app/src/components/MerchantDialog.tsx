import type { MerchantData } from "@/hooks/useMerchants";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef } from "react";
import { useController, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { MerchantInput } from "@archant/api/schemas/merchants";
import { MERCHANT_WEBSITE_MAX_LENGTH, merchantSchema } from "@archant/api/schemas/merchants";
import { sampleCategoryColor } from "@archant/data/category-presets";

import { FieldMessage } from "@/components/FieldMessage";
import { TintedIcon } from "@/components/TintedIcon";
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
import { useCreateMerchant, useUpdateMerchant } from "@/hooks/useMerchants";
import { ApiError } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors, fieldErrorCode } from "@/lib/form-errors";

const FIELD_NAMES = ["name", "color", "websiteUrl"] as const;

/** A new merchant draws one of Sure's ten, as `set_default_color`. */
function valuesOf(merchant: MerchantData | undefined): MerchantInput {
	return merchant === undefined
		? { name: "", color: sampleCategoryColor(), websiteUrl: "" }
		: { name: merchant.name, color: merchant.color, websiteUrl: merchant.websiteUrl ?? "" };
}

type MerchantDialogProps = {
	/** The merchant to edit; absent to create one. */
	merchant?: MerchantData | undefined;
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

/**
 * Creates or edits a merchant, as Sure's `family_merchants/_form.html.erb`:
 * its avatar, Sure's ten colours, its name and its website. Sure's hint about
 * the logo is left out: Archant shows none.
 */
export function MerchantDialog({ merchant, open, onOpenChange }: MerchantDialogProps) {
	const { t } = useTranslation();
	const createMerchant = useCreateMerchant();
	const updateMerchant = useUpdateMerchant();
	const form = useForm<MerchantInput>({
		resolver: zodResolver(merchantSchema),
		defaultValues: valuesOf(merchant),
	});
	const color = useController({ control: form.control, name: "color" });
	const { errors, isSubmitting } = form.formState;
	const error = errors.name;
	// Keyed on the id: the page hands over the merchant from the current list,
	// a new object on every refetch, which must not wipe what is being typed.
	const merchantId = merchant?.id;
	const latest = useRef(merchant);
	latest.current = merchant;

	useEffect(() => {
		if (open) {
			form.reset(valuesOf(latest.current));
		}
	}, [open, merchantId, form]);

	const submit = form.handleSubmit(async (values) => {
		try {
			if (merchant === undefined) {
				const created = await createMerchant.mutateAsync(values);
				toast.success(t("merchants.dialog.created", { name: created.name }));
			} else {
				const saved = await updateMerchant.mutateAsync({ id: merchant.id, ...values });
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
							: t("merchants.dialog.editTitle", { name: merchant.name })}
					</DialogTitle>
					<DialogDescription>
						{t(
							merchant === undefined
								? "merchants.dialog.addDescription"
								: "merchants.dialog.editDescription",
						)}
					</DialogDescription>
				</DialogHeader>
				<form
					id="merchant-form"
					noValidate
					className="flex flex-col gap-4"
					onSubmit={(event) => void submit(event)}
				>
					<TintedIcon
						size="lg"
						className="self-center"
						subject={{
							kind: "merchant",
							name: form.watch("name"),
							color: color.field.value ?? "",
						}}
					/>
					<ColorPicker
						key={merchantId ?? "new"}
						form="merchant"
						legend={t("merchants.dialog.color")}
						value={color.field.value ?? ""}
						onChange={color.field.onChange}
						error={errors.color}
					/>
					<div className="flex flex-col gap-1.5">
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
								{code === "name_taken"
									? t("merchants.dialog.nameTaken")
									: t(`errors.fields.${code}`)}
							</p>
						)}
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="merchant-website">{t("merchants.dialog.website")}</Label>
						<Input
							id="merchant-website"
							autoComplete="off"
							spellCheck={false}
							maxLength={MERCHANT_WEBSITE_MAX_LENGTH}
							placeholder={t("merchants.dialog.websitePlaceholder")}
							aria-invalid={errors.websiteUrl !== undefined}
							{...form.register("websiteUrl")}
						/>
						<FieldMessage id="merchant-websiteUrl-error" error={errors.websiteUrl} />
					</div>
				</form>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
						{t("common.cancel")}
					</Button>
					<Button type="submit" form="merchant-form" disabled={isSubmitting}>
						{t(merchant === undefined ? "merchants.add" : "merchants.dialog.save")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
