import type { FieldError } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { setupSchema } from "@archant/api/schemas/setup";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api, unwrap } from "@/lib/api";
import { authClient, isSetupOpen, sessionQuery } from "@/lib/auth-client";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors, fieldErrorCode } from "@/lib/form-errors";
import { queryKeys } from "@/lib/query-keys";

// The API's schema plus the confirmation, which only the form needs.
const setupFormSchema = setupSchema
	.extend({ confirmPassword: z.string() })
	.refine((value) => value.password === value.confirmPassword, {
		path: ["confirmPassword"],
		message: "password_mismatch",
	});

type SetupFormValues = z.input<typeof setupFormSchema>;

const API_FIELDS = ["email", "password"] as const;

export const Route = createFileRoute("/setup")({
	beforeLoad: async ({ context }) => {
		if ((await context.queryClient.ensureQueryData(sessionQuery)) !== null) {
			throw redirect({ to: "/" });
		}

		if (!(await isSetupOpen())) {
			throw redirect({ to: "/connexion" });
		}
	},
	component: SetupPage,
});

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

function SetupPage() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const form = useForm<SetupFormValues>({
		resolver: zodResolver(setupFormSchema),
		defaultValues: { email: "", password: "", confirmPassword: "" },
	});
	const { errors, isSubmitting } = form.formState;

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("setup.title"), app: t("app.name") });
	}, [t]);

	const submit = form.handleSubmit(async ({ email, password }) => {
		try {
			await unwrap(api.setup.$post({ json: { email, password } }));
		} catch (error) {
			const apiError = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR");

			// Someone finished setup first: the account to sign in to exists.
			if (apiError.code === "FORBIDDEN") {
				await navigate({ to: "/connexion" });
				return;
			}

			const unplaced = applyFieldErrors(apiError.fields, API_FIELDS, form.setError);

			if (
				apiError.code !== "VALIDATION_ERROR" ||
				unplaced.length > 0 ||
				apiError.fields.length === 0
			) {
				showErrorToast(apiError.code);
			}

			return;
		}

		const { error } = await authClient.signIn.email({ email, password });

		if (error !== null) {
			await navigate({ to: "/connexion" });
			return;
		}

		queryClient.removeQueries({ queryKey: queryKeys.session });
		await navigate({ to: "/" });
	});

	const describedBy = (name: keyof SetupFormValues, extra?: string) => {
		const ids = [errors[name] === undefined ? undefined : `${name}-error`, extra].filter(
			(id) => id !== undefined,
		);

		return ids.length === 0 ? {} : { "aria-describedby": ids.join(" ") };
	};

	return (
		<main className="flex min-h-svh items-center justify-center p-6">
			<Card className="w-full max-w-sm">
				<CardHeader>
					<CardTitle>
						<h1 className="text-xl font-semibold">{t("setup.title")}</h1>
					</CardTitle>
					<CardDescription>{t("setup.description")}</CardDescription>
				</CardHeader>
				<CardContent>
					<form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="email">{t("setup.email")}</Label>
							<Input
								id="email"
								type="email"
								autoComplete="username"
								aria-invalid={errors.email !== undefined}
								{...describedBy("email")}
								{...form.register("email")}
							/>
							<FieldMessage id="email-error" error={errors.email} />
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="password">{t("setup.password")}</Label>
							<Input
								id="password"
								type="password"
								autoComplete="new-password"
								aria-invalid={errors.password !== undefined}
								{...describedBy("password", "password-hint")}
								{...form.register("password")}
							/>
							<p id="password-hint" className="text-xs text-muted-foreground">
								{t("setup.passwordHint")}
							</p>
							<FieldMessage id="password-error" error={errors.password} />
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="confirmPassword">{t("setup.confirmPassword")}</Label>
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
							{t("setup.submit")}
						</Button>
					</form>
				</CardContent>
			</Card>
		</main>
	);
}
