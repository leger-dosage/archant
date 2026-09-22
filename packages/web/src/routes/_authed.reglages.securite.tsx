import type { FieldError } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";

import { setupSchema } from "@archant/api/schemas/setup";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { showErrorToast } from "@/lib/error-toast";
import { fieldErrorCode } from "@/lib/form-errors";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute("/_authed/reglages/securite")({
	component: SecurityPage,
});

// The length rules come from setup, so both forms refuse the same passwords.
// The current one is checked for presence only: a password that no longer
// meets the rules must still reach the server and fail there.
const changePasswordSchema = z
	.object({
		currentPassword: z.string().min(1),
		newPassword: setupSchema.shape.password,
		confirmPassword: z.string(),
	})
	.refine((value) => value.newPassword === value.confirmPassword, {
		path: ["confirmPassword"],
		message: "password_mismatch",
	});

type ChangePasswordValues = z.input<typeof changePasswordSchema>;

const EMPTY = { currentPassword: "", newPassword: "", confirmPassword: "" };

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

function SecurityPage() {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const router = useRouter();
	const form = useForm<ChangePasswordValues>({
		resolver: zodResolver(changePasswordSchema),
		defaultValues: EMPTY,
	});
	const { errors, isSubmitting } = form.formState;

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("security.title"), app: t("app.name") });
	}, [t]);

	const submit = form.handleSubmit(async ({ currentPassword, newPassword }) => {
		// Better Auth revokes every other session and hands this browser a fresh
		// cookie; nothing here touches a session itself (AD-13).
		const { error } = await authClient.changePassword({
			currentPassword,
			newPassword,
			revokeOtherSessions: true,
		});

		if (error === null) {
			await queryClient.invalidateQueries({ queryKey: queryKeys.session });
			form.reset(EMPTY);
			toast.success(t("security.changed"));
			return;
		}

		if (error.code === "INVALID_PASSWORD") {
			form.setError("currentPassword", { type: "custom", message: "invalid_password" });
		} else if (error.status === 401) {
			// The session is gone, a reset from the server for instance. The Better
			// Auth client answers outside the query and mutation caches, so
			// `main.tsx` never sees this one: the redirect belongs here.
			queryClient.setQueryData(queryKeys.session, null);
			await router.navigate({
				to: "/connexion",
				search: { redirect: router.state.location.href },
			});
		} else if (error.status === 429) {
			// `/change-password` shares Better Auth's sign-in rule: three per ten seconds.
			toast.error(t("signIn.tooManyAttempts"));
		} else {
			showErrorToast("INTERNAL_ERROR");
		}
	});

	const describedBy = (name: keyof ChangePasswordValues, extra?: string) => {
		const ids = [errors[name] === undefined ? undefined : `${name}-error`, extra].filter(
			(id) => id !== undefined,
		);

		return ids.length === 0 ? {} : { "aria-describedby": ids.join(" ") };
	};

	return (
		<Card className="max-w-md">
			<CardHeader>
				<CardTitle>
					<h2 className="text-lg font-semibold">{t("security.title")}</h2>
				</CardTitle>
				<CardDescription>{t("security.description")}</CardDescription>
			</CardHeader>
			<CardContent>
				<form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="currentPassword">{t("security.currentPassword")}</Label>
						<Input
							id="currentPassword"
							type="password"
							autoComplete="current-password"
							aria-invalid={errors.currentPassword !== undefined}
							{...describedBy("currentPassword")}
							{...form.register("currentPassword")}
						/>
						<FieldMessage id="currentPassword-error" error={errors.currentPassword} />
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="newPassword">{t("security.newPassword")}</Label>
						<Input
							id="newPassword"
							type="password"
							autoComplete="new-password"
							aria-invalid={errors.newPassword !== undefined}
							{...describedBy("newPassword", "newPassword-hint")}
							{...form.register("newPassword")}
						/>
						<p id="newPassword-hint" className="text-xs text-muted-foreground">
							{t("setup.passwordHint")}
						</p>
						<FieldMessage id="newPassword-error" error={errors.newPassword} />
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="confirmPassword">{t("security.confirmPassword")}</Label>
						<Input
							id="confirmPassword"
							type="password"
							autoComplete="new-password"
							aria-invalid={errors.confirmPassword !== undefined}
							{...describedBy("confirmPassword")}
							{...form.register("confirmPassword")}
						/>
						<FieldMessage id="confirmPassword-error" error={errors.confirmPassword} />
					</div>
					<Button type="submit" disabled={isSubmitting}>
						{t("security.submit")}
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}
