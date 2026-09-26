import type { FieldError } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { setupSchema } from "@archant/api/schemas/setup";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient, sessionQuery } from "@/lib/auth-client";
import { showErrorToast } from "@/lib/error-toast";
import { fieldErrorCode } from "@/lib/form-errors";
import { queryKeys } from "@/lib/query-keys";
import { safeRedirect } from "@/lib/safe-redirect";

const searchSchema = z.object({
	redirect: z.string().optional().catch(undefined),
});

// Presence only: the length rules belong to setup and to Better Auth. A
// password that no longer meets them must still reach the server and fail
// there like any other wrong password.
const signInSchema = z.object({
	// Checked here, as on /setup: Better Auth answers a malformed address with
	// a 400 the page would otherwise report as an unexpected error.
	email: setupSchema.shape.email,
	password: z.string().min(1),
});

type SignInValues = z.input<typeof signInSchema>;

type FormFailure = "invalidCredentials" | "tooManyAttempts";

export const Route = createFileRoute("/sign-in")({
	validateSearch: searchSchema,
	beforeLoad: async ({ context, search }) => {
		if ((await context.queryClient.ensureQueryData(sessionQuery)) !== null) {
			throw redirect({ href: safeRedirect(search.redirect) });
		}
	},
	component: SignInPage,
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

function SignInPage() {
	const { t } = useTranslation();
	const router = useRouter();
	const queryClient = useQueryClient();
	const search = Route.useSearch();
	const [failure, setFailure] = useState<FormFailure | null>(null);
	const form = useForm<SignInValues>({
		resolver: zodResolver(signInSchema),
		defaultValues: { email: "", password: "" },
	});
	const { errors, isSubmitting } = form.formState;

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("signIn.title"), app: t("app.name") });
	}, [t]);

	const submit = form.handleSubmit(async ({ email, password }) => {
		setFailure(null);
		const { error } = await authClient.signIn.email({ email, password });

		if (error === null) {
			queryClient.removeQueries({ queryKey: queryKeys.session });
			await router.navigate({ href: safeRedirect(search.redirect) });
			return;
		}

		if (error.status === 401) {
			setFailure("invalidCredentials");
		} else if (error.status === 429) {
			setFailure("tooManyAttempts");
		} else {
			// A 403 is Better Auth refusing the origin: `BETTER_AUTH_URL` does not
			// match the address in the browser, not a wrong password.
			showErrorToast(error.status === 403 ? "FORBIDDEN" : "INTERNAL_ERROR");
		}
	});

	const describedBy = (name: keyof SignInValues) =>
		errors[name] === undefined ? {} : { "aria-describedby": `${name}-error` };

	return (
		<main className="flex min-h-svh items-center justify-center p-6">
			<Card className="w-full max-w-sm">
				<CardHeader>
					<CardTitle>
						<h1 className="text-xl font-semibold">{t("signIn.title")}</h1>
					</CardTitle>
				</CardHeader>
				<CardContent>
					<form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="email">{t("signIn.email")}</Label>
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
							<Label htmlFor="password">{t("signIn.password")}</Label>
							<Input
								id="password"
								type="password"
								autoComplete="current-password"
								aria-invalid={errors.password !== undefined}
								{...describedBy("password")}
								{...form.register("password")}
							/>
							<FieldMessage id="password-error" error={errors.password} />
						</div>
						<Button type="submit" disabled={isSubmitting}>
							{t("signIn.submit")}
						</Button>
						{failure !== null && (
							<p role="alert" className="text-sm text-destructive">
								{t(`signIn.${failure}`)}
							</p>
						)}
					</form>
				</CardContent>
			</Card>
		</main>
	);
}
