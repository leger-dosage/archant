import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
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
import { sessionQuery } from "@/lib/auth-client";
import { showErrorToast } from "@/lib/error-toast";
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

// Presence only: whether it is a TOTP code or a backup code, and whether it
// is right, is the server's to say.
const codeSchema = z.object({ code: z.string().trim().min(1) });

type CodeValues = z.input<typeof codeSchema>;

type FormFailure = "invalidCredentials" | "tooManyAttempts" | "challengeExpired" | "originMismatch";

/**
 * Archant's own refusal of an origin other than `BETTER_AUTH_URL`'s, ahead of
 * Better Auth. Its client spreads the JSON body into `error`, so the envelope's
 * code sits at `error.error.code`.
 */
const originMismatch = z.object({ error: z.object({ code: z.literal("ORIGIN_MISMATCH") }) });

/** A TOTP code; anything else typed in the field is taken for a backup code. */
const TOTP_CODE = /^\d{6}$/u;

/**
 * The plugin's answers that end the challenge: its cookie expired after ten
 * minutes, or five wrong codes spent it. Only the password step starts a new one.
 */
const CHALLENGE_ENDED = new Set([
	"INVALID_TWO_FACTOR_COOKIE",
	"TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE",
]);

export const Route = createFileRoute("/sign-in")({
	validateSearch: searchSchema,
	beforeLoad: async ({ context, search }) => {
		if ((await context.queryClient.ensureQueryData(sessionQuery)) !== null) {
			throw redirect({ href: safeRedirect(search.redirect) });
		}
	},
	component: SignInPage,
});

function SignInPage() {
	const { t } = useTranslation();
	const { signIn } = useAuthActions();
	const router = useRouter();
	const queryClient = useQueryClient();
	const search = Route.useSearch();
	const [failure, setFailure] = useState<FormFailure | null>(null);
	// Two-factor on: the password was right and a code is now expected. No
	// session exists yet, only the plugin's challenge cookie.
	const [step, setStep] = useState<"password" | "code">("password");
	const form = useForm<SignInValues>({
		resolver: zodResolver(signInSchema),
		defaultValues: { email: "", password: "" },
	});
	const { errors, isSubmitting } = form.formState;

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("signIn.title"), app: t("app.name") });
	}, [t]);

	const completeSignIn = async () => {
		queryClient.removeQueries({ queryKey: queryKeys.session });
		await router.navigate({ href: safeRedirect(search.redirect) });
	};

	const submit = form.handleSubmit(async ({ email, password }) => {
		setFailure(null);
		const { data, error } = await signIn({ email, password });

		if (error === null) {
			if ("twoFactorRedirect" in data && data.twoFactorRedirect) {
				setStep("code");
				return;
			}

			await completeSignIn();
			return;
		}

		if (error.status === 401) {
			setFailure("invalidCredentials");
		} else if (error.status === 429) {
			setFailure("tooManyAttempts");
		} else if (originMismatch.safeParse(error).success) {
			// Inline, not a toast: the fix is an edit and a restart, longer than
			// a toast stays on screen.
			setFailure("originMismatch");
		} else {
			// A 403 here is Better Auth refusing a missing or `null` origin.
			showErrorToast(error.status === 403 ? "FORBIDDEN" : "INTERNAL_ERROR");
		}
	});

	const describedBy = (name: keyof SignInValues) =>
		errors[name] === undefined ? {} : { "aria-describedby": `${name}-error` };

	if (step === "code") {
		return (
			<CodeStep
				onSignedIn={completeSignIn}
				onChallengeEnded={() => {
					form.resetField("password");
					setFailure("challengeExpired");
					setStep("password");
				}}
			/>
		);
	}

	return (
		<OutsideShell className="flex flex-col gap-6">
			<h1 className="page-title">{t("signIn.title")}</h1>
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
						{failure === "originMismatch" ? t("errors.ORIGIN_MISMATCH") : t(`signIn.${failure}`)}
					</p>
				)}
			</form>
		</OutsideShell>
	);
}

/**
 * The second step, on the same page: one field that takes either the code of
 * the authenticator app or a backup code, as Sure's does.
 */
function CodeStep({
	onSignedIn,
	onChallengeEnded,
}: {
	onSignedIn: () => Promise<void>;
	onChallengeEnded: () => void;
}) {
	const { t } = useTranslation();
	const { verifyBackupCode, verifyTotp } = useAuthActions();
	const [tooMany, setTooMany] = useState(false);
	const form = useForm<CodeValues>({
		resolver: zodResolver(codeSchema),
		defaultValues: { code: "" },
	});
	const { errors, isSubmitting } = form.formState;

	const submit = form.handleSubmit(async ({ code }) => {
		setTooMany(false);
		// Apps show a TOTP code as « 123 456 »; a backup code keeps its dash.
		const compact = code.replace(/\s+/gu, "");
		const { error } = TOTP_CODE.test(compact)
			? await verifyTotp(compact)
			: await verifyBackupCode(compact);

		if (error === null) {
			await onSignedIn();
			return;
		}

		if (error.code !== undefined && CHALLENGE_ENDED.has(error.code)) {
			onChallengeEnded();
		} else if (error.code === "INVALID_CODE" || error.code === "INVALID_BACKUP_CODE") {
			form.setError("code", { type: "custom", message: "invalid_two_factor_code" });
		} else if (error.status === 429) {
			// The plugin's own limit, or its lockout after ten wrong codes.
			setTooMany(true);
		} else {
			showErrorToast("INTERNAL_ERROR");
		}
	});

	return (
		<OutsideShell className="flex flex-col gap-6">
			<h1 className="page-title">{t("signIn.title")}</h1>
			<p className="text-sm text-muted-foreground">{t("signIn.codeDescription")}</p>
			<form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="code">{t("signIn.code")}</Label>
					<Input
						id="code"
						autoComplete="one-time-code"
						autoFocus
						spellCheck={false}
						aria-invalid={errors.code !== undefined}
						{...(errors.code === undefined ? {} : { "aria-describedby": "code-error" })}
						{...form.register("code")}
					/>
					<FieldMessage id="code-error" error={errors.code} />
				</div>
				<Button type="submit" disabled={isSubmitting}>
					{t("signIn.verify")}
				</Button>
				{tooMany && (
					<p role="alert" className="text-sm text-destructive">
						{t("signIn.tooManyAttempts")}
					</p>
				)}
			</form>
		</OutsideShell>
	);
}
