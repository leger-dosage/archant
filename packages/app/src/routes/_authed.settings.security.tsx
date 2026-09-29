import type { FieldError } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";

import { firstNameSchema, setupSchema } from "@archant/api/schemas/setup";

import { Page } from "@/components/Page";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { showErrorToast } from "@/lib/error-toast";
import { fieldErrorCode } from "@/lib/form-errors";
import { queryKeys } from "@/lib/query-keys";

export const Route = createFileRoute("/_authed/settings/security")({
	component: SecurityPage,
});

// The API's rule, which Better Auth's update hook applies too.
const profileSchema = z.object({ name: firstNameSchema });

type ProfileValues = z.input<typeof profileSchema>;

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

/**
 * The first name the dashboard greets, Better Auth's `user.name`. Saved
 * through Better Auth's own update, never a route of ours (AD-13).
 */
function ProfileSection() {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const router = useRouter();
	const name = Route.useRouteContext({ select: (context) => context.session.user.name });
	const form = useForm<ProfileValues>({
		resolver: zodResolver(profileSchema),
		defaultValues: { name },
	});
	const { errors, isSubmitting } = form.formState;

	const submit = form.handleSubmit(async (values) => {
		const { error } = await authClient.updateUser({ name: values.name });

		if (error === null) {
			// The session sits in the route context, from a query cached for good
			// (lib/auth-client.ts): refetch it, then rerun `beforeLoad`, so the
			// greeting follows without a reload.
			await queryClient.invalidateQueries({ queryKey: queryKeys.session, refetchType: "all" });
			await router.invalidate();
			form.reset({ name: values.name });
			toast.success(t("profile.saved"));
			return;
		}

		if (error.status === 400) {
			form.setError("name", { type: "custom", message: "too_big" });
		} else if (error.status === 401) {
			queryClient.setQueryData(queryKeys.session, null);
			await router.navigate({
				to: "/sign-in",
				search: { redirect: router.state.location.href },
			});
		} else {
			showErrorToast("INTERNAL_ERROR");
		}
	});

	return (
		<Section title={t("profile.title")}>
			<div className="flex flex-col gap-4 p-4">
				<p className="text-sm text-muted-foreground">{t("profile.description")}</p>
				<form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="name">{t("profile.firstName")}</Label>
						<Input
							id="name"
							autoComplete="given-name"
							aria-invalid={errors.name !== undefined}
							{...(errors.name === undefined ? {} : { "aria-describedby": "name-error" })}
							{...form.register("name")}
						/>
						<FieldMessage id="name-error" error={errors.name} />
					</div>
					<Button type="submit" className="self-start" disabled={isSubmitting}>
						{t("profile.submit")}
					</Button>
				</form>
			</div>
		</Section>
	);
}

function SecurityPage() {
	const { t } = useTranslation();

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("security.title"), app: t("app.name") });
	}, [t]);

	return (
		<Page centred title={t("security.title")}>
			<ProfileSection />
			<PasswordSection />
			<TwoFactorSection />
		</Page>
	);
}

function PasswordSection() {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const router = useRouter();
	const form = useForm<ChangePasswordValues>({
		resolver: zodResolver(changePasswordSchema),
		defaultValues: EMPTY,
	});
	const { errors, isSubmitting } = form.formState;

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
			// `app.tsx` never sees this one: the redirect belongs here.
			queryClient.setQueryData(queryKeys.session, null);
			await router.navigate({
				to: "/sign-in",
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
		<Section title={t("security.passwordTitle")}>
			<div className="flex flex-col gap-4 p-4">
				<p className="text-sm text-muted-foreground">{t("security.description")}</p>
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
					<Button type="submit" className="self-start" disabled={isSubmitting}>
						{t("security.submit")}
					</Button>
				</form>
			</div>
		</Section>
	);
}

const passwordSchema = z.object({ password: z.string().min(1) });

type PasswordValues = z.input<typeof passwordSchema>;

const totpSchema = z.object({ code: z.string().trim().min(1) });

type TotpValues = z.input<typeof totpSchema>;

/**
 * What the section shows: its resting state, read from the session; the
 * activation started, waiting for a first code; or backup codes, shown once.
 */
type TwoFactorStep =
	| { kind: "idle" }
	| { kind: "scanning"; totpURI: string; backupCodes: string[] }
	| { kind: "codes"; backupCodes: string[] };

/** The failure every call of this section shares with the password form. */
type AuthFailure = { code?: string | undefined; status: number };

/**
 * Two-factor sign-in through Better Auth's `twoFactor` plugin (AD-13): every
 * call here is the plugin's, which asks for the password itself. Turning it
 * on writes nothing the next sign-in reads until a first code proves the app
 * holds the secret.
 */
function TwoFactorSection() {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const router = useRouter();
	const enabled = Route.useRouteContext({
		select: (context) => context.session.user.twoFactorEnabled === true,
	});
	const [step, setStep] = useState<TwoFactorStep>({ kind: "idle" });
	const passwordForm = useForm<PasswordValues>({
		resolver: zodResolver(passwordSchema),
		defaultValues: { password: "" },
	});
	const passwordErrors = passwordForm.formState.errors;

	/** Refetches the session, then reruns `beforeLoad`, so the page reads the new state. */
	const refreshSession = async () => {
		await queryClient.invalidateQueries({ queryKey: queryKeys.session, refetchType: "all" });
		await router.invalidate();
	};

	/** What every call does with a failure but a wrong code. */
	const handleFailure = async (error: AuthFailure) => {
		if (error.code === "INVALID_PASSWORD") {
			passwordForm.setError("password", { type: "custom", message: "invalid_password" });
		} else if (error.status === 401) {
			queryClient.setQueryData(queryKeys.session, null);
			await router.navigate({
				to: "/sign-in",
				search: { redirect: router.state.location.href },
			});
		} else if (error.status === 429) {
			// The plugin's limit: three requests per ten seconds on each of its paths.
			toast.error(t("signIn.tooManyAttempts"));
		} else {
			showErrorToast("INTERNAL_ERROR");
		}
	};

	const start = passwordForm.handleSubmit(async ({ password }) => {
		const { data, error } = await authClient.twoFactor.enable({ password });

		if (error !== null) {
			await handleFailure(error);
			return;
		}

		// Always `totp`: no `sendOTP` is configured, so the plugin offers nothing else.
		if (data.method === "totp") {
			passwordForm.reset({ password: "" });
			setStep({ kind: "scanning", totpURI: data.totpURI, backupCodes: data.backupCodes });
		}
	});

	const regenerate = passwordForm.handleSubmit(async ({ password }) => {
		const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });

		if (error === null) {
			passwordForm.reset({ password: "" });
			setStep({ kind: "codes", backupCodes: data.backupCodes });
			return;
		}

		await handleFailure(error);
	});

	const disable = passwordForm.handleSubmit(async ({ password }) => {
		const { error } = await authClient.twoFactor.disable({ password });

		if (error === null) {
			passwordForm.reset({ password: "" });
			await refreshSession();
			toast.success(t("twoFactor.disabled"));
			return;
		}

		await handleFailure(error);
	});

	const isSubmitting = passwordForm.formState.isSubmitting;

	return (
		<Section title={t("twoFactor.title")}>
			<div className="flex flex-col gap-4 p-4">
				{step.kind === "scanning" ? (
					<ScanStep
						totpURI={step.totpURI}
						onCancel={() => setStep({ kind: "idle" })}
						onFailure={handleFailure}
						onEnabled={async () => {
							await refreshSession();
							toast.success(t("twoFactor.enabled"));
							setStep({ kind: "codes", backupCodes: step.backupCodes });
						}}
					/>
				) : step.kind === "codes" ? (
					<BackupCodes codes={step.backupCodes} onDone={() => setStep({ kind: "idle" })} />
				) : (
					<>
						<p className="text-sm text-muted-foreground">
							{t(enabled ? "twoFactor.descriptionOn" : "twoFactor.descriptionOff")}
						</p>
						<form
							noValidate
							className="flex flex-col gap-4"
							// On, Enter starts nothing: regenerating and turning off each
							// need their own button, so a password typed for one never
							// triggers the other.
							onSubmit={(event) => {
								if (enabled) {
									event.preventDefault();
								} else {
									void start(event);
								}
							}}
						>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="twoFactorPassword">{t("twoFactor.password")}</Label>
								<Input
									id="twoFactorPassword"
									type="password"
									autoComplete="current-password"
									aria-invalid={passwordErrors.password !== undefined}
									{...(passwordErrors.password === undefined
										? {}
										: { "aria-describedby": "twoFactorPassword-error" })}
									{...passwordForm.register("password")}
								/>
								<FieldMessage id="twoFactorPassword-error" error={passwordErrors.password} />
							</div>
							{enabled ? (
								<>
									<Button
										type="button"
										className="self-start"
										disabled={isSubmitting}
										aria-describedby="regenerate-hint"
										onClick={(event) => void regenerate(event)}
									>
										{t("twoFactor.regenerate")}
									</Button>
									<p id="regenerate-hint" className="text-xs text-muted-foreground">
										{t("twoFactor.regenerateHint")}
									</p>
									<Button
										type="button"
										variant="outline"
										className="self-start"
										disabled={isSubmitting}
										onClick={(event) => void disable(event)}
									>
										{t("twoFactor.disable")}
									</Button>
								</>
							) : (
								<Button type="submit" className="self-start" disabled={isSubmitting}>
									{t("twoFactor.enable")}
								</Button>
							)}
						</form>
					</>
				)}
			</div>
		</Section>
	);
}

/**
 * The QR code and the secret it carries, then the first code. An inline SVG:
 * the Content-Security-Policy sets no `img-src`, which a data URL would need.
 */
function ScanStep({
	totpURI,
	onCancel,
	onFailure,
	onEnabled,
}: {
	totpURI: string;
	onCancel: () => void;
	onFailure: (error: AuthFailure) => Promise<void>;
	onEnabled: () => Promise<void>;
}) {
	const { t } = useTranslation();
	const form = useForm<TotpValues>({
		resolver: zodResolver(totpSchema),
		defaultValues: { code: "" },
	});
	const { errors, isSubmitting } = form.formState;
	// For an app that cannot scan: the same secret, as the URI carries it.
	const secret = new URL(totpURI).searchParams.get("secret") ?? "";

	const submit = form.handleSubmit(async ({ code }) => {
		// Apps show the code as « 123 456 ».
		const { error } = await authClient.twoFactor.verifyTotp({
			code: code.replace(/\s+/gu, ""),
		});

		if (error === null) {
			await onEnabled();
			return;
		}

		// A 401 here is the plugin's answer to a wrong code, not a lost session.
		if (error.code === "INVALID_CODE") {
			form.setError("code", { type: "custom", message: "invalid_two_factor_code" });
			return;
		}

		await onFailure(error);
	});

	return (
		<>
			<p className="text-sm text-muted-foreground">{t("twoFactor.scan")}</p>
			<div className="self-start rounded-md bg-white p-3">
				<QRCodeSVG value={totpURI} size={176} title={t("twoFactor.qrCode")} role="img" />
			</div>
			<div className="flex flex-col gap-1.5">
				<p id="twoFactorSecret-label" className="text-sm font-medium">
					{t("twoFactor.secret")}
				</p>
				<code
					aria-labelledby="twoFactorSecret-label"
					className="font-mono text-sm break-all select-all"
				>
					{secret}
				</code>
			</div>
			<form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="twoFactorCode">{t("twoFactor.code")}</Label>
					<Input
						id="twoFactorCode"
						inputMode="numeric"
						autoComplete="one-time-code"
						aria-invalid={errors.code !== undefined}
						{...(errors.code === undefined ? {} : { "aria-describedby": "twoFactorCode-error" })}
						{...form.register("code")}
					/>
					<FieldMessage id="twoFactorCode-error" error={errors.code} />
				</div>
				<div className="flex gap-2">
					<Button type="submit" disabled={isSubmitting}>
						{t("twoFactor.confirm")}
					</Button>
					<Button type="button" variant="outline" onClick={onCancel}>
						{t("twoFactor.cancel")}
					</Button>
				</div>
			</form>
		</>
	);
}

/** The ten backup codes, shown once: the server keeps them encrypted and never sends them again. */
function BackupCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
	const { t } = useTranslation();

	return (
		<>
			<h3 id="backupCodes-title" className="text-sm font-medium">
				{t("twoFactor.backupCodesTitle")}
			</h3>
			<p className="text-sm text-muted-foreground">{t("twoFactor.backupCodesDescription")}</p>
			<ul aria-labelledby="backupCodes-title" className="grid grid-cols-2 gap-2 font-mono text-sm">
				{codes.map((code) => (
					<li key={code}>{code}</li>
				))}
			</ul>
			<Button type="button" className="self-start" onClick={onDone}>
				{t("twoFactor.backupCodesDone")}
			</Button>
		</>
	);
}
