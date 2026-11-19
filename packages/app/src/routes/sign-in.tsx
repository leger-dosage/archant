import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
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
import { passwordResetAvailability, sessionQuery } from "@/lib/auth-client";
import { showErrorToast } from "@/lib/error-toast";
import { signInOptionsQuery, signInWithOpenIdConnect } from "@/lib/openid-connect-client";
import { passkeyConfigQuery, signInWithPasskey } from "@/lib/passkey-client";
import { queryKeys } from "@/lib/query-keys";
import { safeRedirect } from "@/lib/safe-redirect";

// Loose: when an assistant's authorisation sent the owner here, the address
// also holds Better Auth's signed OAuth query, which must stay in it as it
// came, since `oauthProviderClient` reads it from there on each step.
const searchSchema = z.looseObject({
	redirect: z.string().optional().catch(undefined),
	oidc: z.literal("failed").optional().catch(undefined),
	passwordReset: z.literal(true).optional().catch(undefined),
});

/**
 * Better Auth's answer to a sign-in that continues an assistant's
 * authorisation: the address to follow, the consent page or the assistant's
 * own, rather than this page's `redirect`.
 */
const oauthContinuation = z.object({ redirect: z.literal(true), url: z.string().min(1) });

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
		if (
			!search.passwordReset &&
			(await context.queryClient.ensureQueryData(sessionQuery)) !== null
		) {
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
	const { data: passkeyConfig } = useQuery(passkeyConfigQuery);
	const { data: options } = useQuery(signInOptionsQuery);
	const [oidcFailure, setOidcFailure] = useState(search.oidc === "failed");
	const { data: recovery } = useQuery(passwordResetAvailability);
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

	const completeSignIn = async (answer: unknown) => {
		queryClient.removeQueries({ queryKey: queryKeys.session });
		const continuation = oauthContinuation.safeParse(answer);

		if (continuation.success) {
			// A full load: the consent page reads its own signed query, and the
			// assistant's address is no route of this interface.
			window.location.href = continuation.data.url;
			return;
		}

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

			await completeSignIn(data);
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
				passkeyAvailable={passkeyConfig?.available === true}
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
			{search.passwordReset && <p role="status">{t("passwordRecovery.success")}</p>}
			{options?.password !== false && (
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
						<div className="flex items-center justify-between gap-2">
							<Label htmlFor="password">{t("signIn.password")}</Label>
							{recovery?.data.enabled && (
								<Link to="/forgot-password" className="text-sm underline">
									{t("passwordRecovery.forgotTitle")}
								</Link>
							)}
						</div>
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
			)}
			{options?.openIdConnect && (
				<Button
					type="button"
					variant="outline"
					onClick={() => {
						void signInWithOpenIdConnect(safeRedirect(search.redirect))
							.then(({ error }) => setOidcFailure(error !== null))
							.catch(() => setOidcFailure(true));
					}}
				>
					{t("openidConnect.signIn")}
				</Button>
			)}
			{oidcFailure && (
				<p role="alert" className="text-sm text-destructive">
					{t("openidConnect.signInFailure")}
				</p>
			)}
			{passkeyConfig?.standalone === true && (
				<PasskeyButton mode="standalone" disabled={isSubmitting} onSignedIn={completeSignIn} />
			)}
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
	passkeyAvailable,
}: {
	onSignedIn: (answer: unknown) => Promise<void>;
	onChallengeEnded: () => void;
	passkeyAvailable: boolean;
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
		const { data, error } = TOTP_CODE.test(compact)
			? await verifyTotp(compact)
			: await verifyBackupCode(compact);

		if (error === null) {
			await onSignedIn(data);
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
			{passkeyAvailable && (
				<PasskeyButton
					mode="second-factor"
					disabled={isSubmitting}
					onSignedIn={onSignedIn}
					onChallengeEnded={onChallengeEnded}
				/>
			)}
		</OutsideShell>
	);
}

function PasskeyButton({
	mode,
	disabled,
	onSignedIn,
	onChallengeEnded,
}: {
	mode: "standalone" | "second-factor";
	disabled: boolean;
	onSignedIn: (answer: unknown) => Promise<void>;
	onChallengeEnded?: () => void;
}) {
	const { t } = useTranslation();
	const [pending, setPending] = useState(false);
	const [failure, setFailure] = useState<"failed" | "tooMany" | null>(null);

	const signIn = async () => {
		setPending(true);
		setFailure(null);
		try {
			const { data, error } = await signInWithPasskey(mode);
			if (!error) {
				await onSignedIn(data);
			} else if (
				"code" in error &&
				typeof error.code === "string" &&
				CHALLENGE_ENDED.has(error.code)
			) {
				onChallengeEnded?.();
			} else {
				setFailure(error.status === 429 ? "tooMany" : "failed");
			}
		} catch {
			setFailure("failed");
		} finally {
			setPending(false);
		}
	};

	return (
		<div className="flex flex-col gap-2">
			<Button
				type="button"
				variant="outline"
				disabled={disabled || pending}
				onClick={() => void signIn()}
			>
				{t(mode === "standalone" ? "passkeys.signIn" : "passkeys.verify")}
			</Button>
			{failure !== null && (
				<p role="alert" className="text-sm text-destructive">
					{t(`passkeys.${failure}`)}
				</p>
			)}
		</div>
	);
}
