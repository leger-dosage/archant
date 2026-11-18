import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { setupSchema } from "@archant/api/schemas/setup";

import { FieldMessage } from "@/components/FieldMessage";
import { OutsideShell } from "@/components/OutsideShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthActions } from "@/hooks/useAuthActions";
import { passwordResetAvailability } from "@/lib/auth-client";

const schema = z.object({ email: setupSchema.shape.email });
type Values = z.input<typeof schema>;

export const Route = createFileRoute("/forgot-password")({
	beforeLoad: async ({ context }) => {
		const { data } = await context.queryClient.ensureQueryData(passwordResetAvailability);
		if (!data.enabled) {
			throw redirect({ to: "/sign-in" });
		}
	},
	component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
	const { t } = useTranslation();
	const { requestPasswordReset } = useAuthActions();
	const [sent, setSent] = useState(false);
	const [failure, setFailure] = useState<
		"TOO_MANY_REQUESTS" | "INTERNAL_ERROR" | "NETWORK_ERROR"
	>();
	const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "" } });
	const { errors, isSubmitting } = form.formState;
	const submit = form.handleSubmit(async ({ email }) => {
		setFailure(undefined);
		try {
			const { error } = await requestPasswordReset(email);
			if (error === null) {
				setSent(true);
			} else {
				setFailure(error.status === 429 ? "TOO_MANY_REQUESTS" : "INTERNAL_ERROR");
			}
		} catch {
			setFailure("NETWORK_ERROR");
		}
	});

	return (
		<OutsideShell className="flex flex-col gap-6">
			<h1 className="page-title">{t("passwordRecovery.forgotTitle")}</h1>
			{sent ? (
				<p role="status">{t("passwordRecovery.sent")}</p>
			) : (
				<form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="email">{t("signIn.email")}</Label>
						<Input
							id="email"
							type="email"
							autoComplete="username"
							aria-invalid={errors.email !== undefined}
							aria-describedby={errors.email ? "email-error" : undefined}
							{...form.register("email")}
						/>
						<FieldMessage id="email-error" error={errors.email} />
					</div>
					<Button type="submit" disabled={isSubmitting}>
						{t("passwordRecovery.send")}
					</Button>
					{failure && (
						<p role="alert" className="text-sm text-destructive">
							{t(`errors.${failure}`)}
						</p>
					)}
				</form>
			)}
			<Link to="/sign-in" className="text-sm underline">
				{t("signIn.submit")}
			</Link>
		</OutsideShell>
	);
}
