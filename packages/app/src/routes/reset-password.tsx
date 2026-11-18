import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import { queryKeys } from "@/lib/query-keys";

const schema = z
	.object({
		password: setupSchema.shape.password,
		confirmPassword: z.string(),
	})
	.refine(({ password, confirmPassword }) => password === confirmPassword, {
		path: ["confirmPassword"],
		message: "password_mismatch",
	});
type Values = z.input<typeof schema>;
type LinkStatus = "checking" | "valid" | "invalid" | "unavailable";

export const Route = createFileRoute("/reset-password")({ component: ResetPasswordPage });

function ResetPasswordPage() {
	const { t } = useTranslation();
	const { checkPasswordReset, resetPassword } = useAuthActions();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token"));
	const [status, setStatus] = useState<LinkStatus>(token ? "checking" : "invalid");
	const [failure, setFailure] = useState<
		"TOO_MANY_REQUESTS" | "INTERNAL_ERROR" | "NETWORK_ERROR"
	>();
	const form = useForm<Values>({
		resolver: zodResolver(schema),
		defaultValues: { password: "", confirmPassword: "" },
	});
	const { errors, isSubmitting } = form.formState;

	useEffect(() => {
		const controller = new AbortController();

		const checkLink = async (linkToken: string) => {
			try {
				const { error } = await checkPasswordReset(linkToken, controller.signal);
				if (error === null) {
					setStatus("valid");
				} else {
					setStatus(error.status === 400 || error.status === 404 ? "invalid" : "unavailable");
				}
			} catch {
				if (!controller.signal.aborted) {
					setStatus("unavailable");
				}
			}
		};

		if (token) {
			// The link is usable from its email again if the page is reloaded.
			window.history.replaceState(window.history.state, "", window.location.pathname);
			void checkLink(token);
		}

		return () => controller.abort();
	}, [checkPasswordReset, token]);

	const submit = form.handleSubmit(async ({ password: newPassword }) => {
		if (!token) {
			return;
		}

		setFailure(undefined);
		try {
			const { error } = await resetPassword(token, newPassword);
			if (error === null) {
				queryClient.removeQueries({ queryKey: queryKeys.session });
				await navigate({ to: "/sign-in", search: { passwordReset: true }, replace: true });
			} else if (error.code === "INVALID_TOKEN" || error.status === 404) {
				setStatus("invalid");
			} else {
				setFailure(error.status === 429 ? "TOO_MANY_REQUESTS" : "INTERNAL_ERROR");
			}
		} catch {
			setFailure("NETWORK_ERROR");
		}
	});

	return (
		<OutsideShell className="flex flex-col gap-6">
			<h1 className="page-title">{t("passwordRecovery.resetTitle")}</h1>
			{status === "checking" && <p role="status">{t("passwordRecovery.checking")}</p>}
			{status === "invalid" && (
				<p role="alert" className="text-sm text-destructive">
					{t("passwordRecovery.invalid")}
				</p>
			)}
			{status === "unavailable" && (
				<p role="alert" className="text-sm text-destructive">
					{t("errors.INTERNAL_ERROR")}
				</p>
			)}
			{status === "valid" && (
				<form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="password">{t("security.newPassword")}</Label>
						<Input
							id="password"
							type="password"
							autoComplete="new-password"
							aria-invalid={errors.password !== undefined}
							aria-describedby={errors.password ? "password-error" : undefined}
							{...form.register("password")}
						/>
						<FieldMessage id="password-error" error={errors.password} />
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="confirm-password">{t("security.confirmPassword")}</Label>
						<Input
							id="confirm-password"
							type="password"
							autoComplete="new-password"
							aria-invalid={errors.confirmPassword !== undefined}
							aria-describedby={errors.confirmPassword ? "confirm-password-error" : undefined}
							{...form.register("confirmPassword")}
						/>
						<FieldMessage id="confirm-password-error" error={errors.confirmPassword} />
					</div>
					<Button type="submit" disabled={isSubmitting}>
						{t("passwordRecovery.reset")}
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
