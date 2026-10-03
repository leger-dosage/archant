import type { CreatedInvitationData } from "@/hooks/useInvitations";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useController, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import type { CreateInvitationInput } from "@archant/api/schemas/invitations";
import { createInvitationSchema } from "@archant/api/schemas/invitations";
import { USER_ROLES } from "@archant/data/user-roles";

import { ChoiceField } from "@/components/ChoiceField";
import { CopyableAddress } from "@/components/CopyableAddress";
import { FieldMessage } from "@/components/FieldMessage";
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
import { useCreateInvitation } from "@/hooks/useInvitations";
import { ApiError } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors } from "@/lib/form-errors";

const FIELD_NAMES = ["email", "role"] as const;

const EMPTY: CreateInvitationInput = { email: "", role: "viewer" };

/**
 * Invites an email as a viewer, by default, or as an administrator, then
 * shows the link once: only its hash is stored, so nothing can show it
 * again. Archant sends no email, as self-hosted Sure: the owner sends the
 * link themselves.
 */
export function InviteDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { t } = useTranslation();
	const createInvitation = useCreateInvitation();
	const form = useForm<CreateInvitationInput>({
		resolver: zodResolver(createInvitationSchema),
		defaultValues: EMPTY,
	});
	const role = useController({ control: form.control, name: "role" });
	const { errors, isSubmitting } = form.formState;
	const [created, setCreated] = useState<CreatedInvitationData | null>(null);

	// A fresh form each time it opens; the link of the last one is gone for good.
	useEffect(() => {
		if (open) {
			form.reset(EMPTY);
			setCreated(null);
		}
	}, [open, form]);

	const submit = form.handleSubmit(async (values) => {
		try {
			setCreated(await createInvitation.mutateAsync(values));
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

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				showCloseButton={false}
				// Once the link shows, only « Terminé » closes: a stray Escape or
				// click would lose a link nothing can show again.
				{...(created === null
					? {}
					: {
							onEscapeKeyDown: (event: KeyboardEvent) => event.preventDefault(),
							onInteractOutside: (event: Event) => event.preventDefault(),
						})}
			>
				{created === null ? (
					<>
						<DialogHeader>
							<DialogTitle>{t("members.inviteDialog.title")}</DialogTitle>
							<DialogDescription>{t("members.inviteDialog.description")}</DialogDescription>
						</DialogHeader>
						<form
							id="invite-form"
							noValidate
							className="flex flex-col gap-4"
							onSubmit={(event) => void submit(event)}
						>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="invite-email">{t("members.inviteDialog.email")}</Label>
								<Input
									id="invite-email"
									type="email"
									autoComplete="off"
									aria-invalid={errors.email !== undefined}
									{...(errors.email === undefined
										? {}
										: { "aria-describedby": "invite-email-error" })}
									{...form.register("email")}
								/>
								<FieldMessage id="invite-email-error" error={errors.email} />
							</div>
							<div className="flex flex-col gap-1.5">
								<ChoiceField
									id="invite-role"
									label={t("members.inviteDialog.role")}
									value={role.field.value}
									options={USER_ROLES.map((value) => ({
										value,
										label: t(`members.roles.${value}`),
									}))}
									onChange={role.field.onChange}
								/>
								<FieldMessage id="invite-role-error" error={errors.role} />
							</div>
						</form>
						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
								{t("common.cancel")}
							</Button>
							<Button type="submit" form="invite-form" disabled={isSubmitting}>
								{t("members.inviteDialog.submit")}
							</Button>
						</DialogFooter>
					</>
				) : (
					<>
						<DialogHeader>
							<DialogTitle>
								{t("members.inviteDialog.linkTitle", { email: created.email })}
							</DialogTitle>
							<DialogDescription>{t("members.inviteDialog.linkOnce")}</DialogDescription>
						</DialogHeader>
						<CopyableAddress value={created.url} copyLabel={t("members.inviteDialog.copy")} />
						<DialogFooter>
							<Button type="button" onClick={() => onOpenChange(false)}>
								{t("members.inviteDialog.done")}
							</Button>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
