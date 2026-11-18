import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { setupSchema } from "@archant/api/schemas/setup";
import {
	DEFAULT_HOUSEHOLD_COUNTRY,
	currencyForCountry,
	defaultDateFormat,
	isHouseholdCountry,
} from "@archant/data/household-preferences";

import { ChoiceField } from "@/components/ChoiceField";
import { FieldMessage } from "@/components/FieldMessage";
import { OutsideShell } from "@/components/OutsideShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthActions } from "@/hooks/useAuthActions";
import { ApiError, api, unwrap } from "@/lib/api";
import { isSetupOpen, sessionQuery } from "@/lib/auth-client";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors } from "@/lib/form-errors";
import { countryOptions, currencyOptions, dateFormatOptions } from "@/lib/household-preferences";
import { activeLocale } from "@/lib/locale";
import { queryKeys } from "@/lib/query-keys";

// The API's schema plus the confirmation, which only the form needs. The API
// takes an empty token and refuses it as a wrong one; the form asks for one
// before sending.
const setupFormSchema = setupSchema
	.extend({ token: setupSchema.shape.token.min(1), confirmPassword: z.string() })
	.refine((value) => value.password === value.confirmPassword, {
		path: ["confirmPassword"],
		message: "password_mismatch",
	});

type SetupFormValues = z.input<typeof setupFormSchema>;

const API_FIELDS = [
	"token",
	"name",
	"email",
	"password",
	"country",
	"baseCurrency",
	"dateFormat",
] as const;

/** The `type` a refused token is set with, so its field shows that code's message. */
const TOKEN_REFUSED = "SETUP_TOKEN_INVALID";

export const Route = createFileRoute("/setup")({
	beforeLoad: async ({ context }) => {
		if ((await context.queryClient.ensureQueryData(sessionQuery)) !== null) {
			throw redirect({ to: "/" });
		}

		if (!(await isSetupOpen())) {
			throw redirect({ to: "/sign-in" });
		}
	},
	component: SetupPage,
});

function SetupPage() {
	const { t } = useTranslation();
	const { signIn } = useAuthActions();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const browserRegion = new Intl.Locale(navigator.language).maximize().region ?? "";
	const initialCountry = isHouseholdCountry(browserRegion)
		? browserRegion
		: DEFAULT_HOUSEHOLD_COUNTRY;
	const initialFormat = defaultDateFormat(activeLocale);
	const form = useForm<SetupFormValues>({
		resolver: zodResolver(setupFormSchema),
		defaultValues: {
			token: "",
			name: "",
			email: "",
			password: "",
			confirmPassword: "",
			country: initialCountry,
			baseCurrency: currencyForCountry(initialCountry),
			dateFormat: initialFormat,
		},
	});
	const { errors, isSubmitting } = form.formState;
	const candidate = form.watch("country") ?? initialCountry;
	const country = isHouseholdCountry(candidate) ? candidate : initialCountry;
	const baseCurrency = form.watch("baseCurrency") ?? currencyForCountry(country);
	const dateFormat = form.watch("dateFormat") ?? initialFormat;
	// Shown under the button rather than as a toast: the fix is an edit of
	// `ARCHANT_URL` and a restart, longer than a toast stays on screen.
	const [originMismatch, setOriginMismatch] = useState(false);

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("setup.title"), app: t("app.name") });
	}, [t]);

	const submit = form.handleSubmit(async ({ confirmPassword: _, ...input }) => {
		setOriginMismatch(false);

		try {
			await unwrap(api.setup.$post({ json: { ...input, locale: activeLocale } }));
		} catch (error) {
			const apiError = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR");

			// Someone finished setup first: the account to sign in to exists.
			if (apiError.code === "FORBIDDEN") {
				await navigate({ to: "/sign-in" });
				return;
			}

			if (apiError.code === "ORIGIN_MISMATCH") {
				setOriginMismatch(true);
				return;
			}

			if (apiError.code === "SETUP_TOKEN_INVALID") {
				form.setError("token", { type: TOKEN_REFUSED }, { shouldFocus: true });
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

		const { error } = await signIn({ email: input.email, password: input.password });

		if (error !== null) {
			await navigate({ to: "/sign-in" });
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
		<OutsideShell className="flex flex-col gap-6">
			<div className="flex flex-col gap-1.5">
				<h1 className="page-title">{t("setup.title")}</h1>
				<p className="text-sm text-muted-foreground">{t("setup.description")}</p>
			</div>
			<form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="token">{t("setup.token")}</Label>
					<Input
						id="token"
						autoComplete="off"
						spellCheck={false}
						aria-invalid={errors.token !== undefined}
						{...describedBy("token", "token-hint")}
						{...form.register("token")}
					/>
					<p id="token-hint" className="text-xs text-muted-foreground">
						{t("setup.tokenHint")}
					</p>
					{errors.token?.type === TOKEN_REFUSED ? (
						<p id="token-error" className="text-xs text-destructive">
							{t("errors.SETUP_TOKEN_INVALID")}
						</p>
					) : (
						<FieldMessage id="token-error" error={errors.token} />
					)}
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="name">{t("setup.firstName")}</Label>
					<Input
						id="name"
						autoComplete="given-name"
						aria-invalid={errors.name !== undefined}
						{...describedBy("name", "name-hint")}
						{...form.register("name")}
					/>
					<p id="name-hint" className="text-xs text-muted-foreground">
						{t("setup.firstNameHint")}
					</p>
					<FieldMessage id="name-error" error={errors.name} />
				</div>
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
				<ChoiceField
					id="setup-country"
					label={t("preferences.general.country")}
					value={country}
					options={countryOptions}
					disabled={isSubmitting}
					onChange={(value) => {
						form.setValue("country", value);
						form.setValue("baseCurrency", currencyForCountry(value));
					}}
				/>
				<FieldMessage id="country-error" error={errors.country} />
				<ChoiceField
					id="setup-currency"
					label={t("setup.currency")}
					value={baseCurrency}
					options={currencyOptions}
					disabled={isSubmitting}
					onChange={(value) => form.setValue("baseCurrency", value)}
				/>
				<FieldMessage id="baseCurrency-error" error={errors.baseCurrency} />
				<ChoiceField
					id="setup-date-format"
					label={t("preferences.general.dateFormat")}
					value={dateFormat}
					options={dateFormatOptions}
					disabled={isSubmitting}
					onChange={(value) => form.setValue("dateFormat", value)}
				/>
				<FieldMessage id="dateFormat-error" error={errors.dateFormat} />
				<Button type="submit" disabled={isSubmitting}>
					{t("setup.submit")}
				</Button>
				{originMismatch && (
					<p role="alert" className="text-sm text-destructive">
						{t("errors.ORIGIN_MISMATCH")}
					</p>
				)}
			</form>
		</OutsideShell>
	);
}
