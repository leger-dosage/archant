import type { BankSetupData } from "@/hooks/useBankConnections";
import type { FormEvent } from "react";

import { Loader2Icon, LockIcon } from "lucide-react";
import { useId, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";

import { CopyableAddress } from "@/components/CopyableAddress";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSaveBankCredentials } from "@/hooks/useBankConnections";
import { ApiError } from "@/lib/api";
import { errorMessage } from "@/lib/error-toast";

const DEPLOYMENT_GUIDE =
	"https://github.com/leger-dosage/archant/blob/main/docs/deployment.md#connecting-a-bank";

/** Where an application is created, as Sure's panel links it. */
const ENABLE_BANKING_PORTAL = "https://enablebanking.com/cp/applications";

export function Unavailable({ missing }: { missing: string[] }) {
	const { t } = useTranslation();

	return (
		<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border bg-card p-4">
			<p className="font-medium">{t("banks.unavailable.title")}</p>
			<p className="text-sm text-muted-foreground">{t("banks.unavailable.description")}</p>
			<ul className="flex flex-col gap-1">
				{missing.map((name) => (
					<li key={name}>
						<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">{name}</code>
					</li>
				))}
			</ul>
			<a
				href={DEPLOYMENT_GUIDE}
				target="_blank"
				rel="noreferrer"
				className="text-sm font-medium underline underline-offset-4"
			>
				{t("banks.unavailable.docs")}
			</a>
		</div>
	);
}

/**
 * Sure's Enable Banking panel: the steps, the application ID and the `.pem`
 * file, whose text the browser reads and sends. No country here: it is
 * asked when connecting. Disabled, with Sure's warning, while a bank is
 * connected, since its session belongs to the current application.
 */
export function CredentialsForm({ setup }: { setup: BankSetupData }) {
	const { t } = useTranslation();
	const applicationIdId = useId();
	const privateKeyId = useId();
	const save = useSaveBankCredentials();
	const [applicationId, setApplicationId] = useState(setup.applicationId ?? "");
	const [file, setFile] = useState<File | null>(null);
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
	const [failure, setFailure] = useState<string | null>(null);
	const locked = setup.locked;

	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setFailure(null);

		const missing = {
			...(applicationId.trim() === "" ? { applicationId: "too_small" } : {}),
			...(file === null ? { privateKey: "too_small" } : {}),
		};
		setFieldErrors(missing);

		if (file === null || Object.keys(missing).length > 0) {
			return;
		}

		// Awaited rather than `mutate`'s callbacks: a first save swaps this form
		// for the country picker, and an unmounted observer calls none of them.
		try {
			await save.mutateAsync({
				applicationId: applicationId.trim(),
				privateKey: await file.text(),
			});
			toast.success(t("banks.credentials.saved"));
		} catch (error) {
			const fields = error instanceof ApiError ? error.fields : [];

			if (fields.length > 0) {
				setFieldErrors(Object.fromEntries(fields.map((field) => [field.path, field.code])));
			} else {
				setFailure(errorMessage(error));
			}
		}
	};

	const fieldError = (name: string) => {
		const code = fieldErrors[name];

		return code === undefined ? null : (
			<p id={`${name}-error`} className="text-xs text-destructive">
				{t(`errors.fields.${code}`, { defaultValue: t("errors.fields.unknown") })}
			</p>
		);
	};

	return (
		<Section id="bank-credentials-title" title={t("banks.credentials.title")}>
			<div className="flex flex-col gap-4 p-4">
				<p className="text-sm text-muted-foreground">{t("banks.credentials.description")}</p>

				<ol
					aria-label={t("banks.credentials.steps")}
					className="flex list-decimal flex-col gap-2 pl-5 text-sm"
				>
					<li>
						<Trans
							i18nKey="banks.credentials.step1"
							components={{
								portal: (
									<a
										href={ENABLE_BANKING_PORTAL}
										target="_blank"
										rel="noreferrer"
										className="font-medium underline underline-offset-4"
									/>
								),
							}}
						/>
					</li>
					<li className="flex flex-col gap-1.5">
						<span>{t("banks.credentials.step2")}</span>
						<CopyableAddress value={setup.redirectUrl} copyLabel={t("banks.credentials.copy")} />
					</li>
					<li>{t("banks.credentials.step3")}</li>
				</ol>

				{locked && (
					// Sure's `DS::Alert`, as the bank alerts above the page.
					<div
						role="status"
						className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning"
					>
						<LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
						<div className="flex flex-col gap-1">
							<p className="font-medium">{t("banks.credentials.lockedTitle")}</p>
							<p>{t("banks.credentials.lockedDescription")}</p>
						</div>
					</div>
				)}

				<form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
					<fieldset disabled={locked || save.isPending} className="flex flex-col gap-4">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor={applicationIdId}>{t("banks.credentials.applicationId")}</Label>
							<Input
								id={applicationIdId}
								value={applicationId}
								autoComplete="off"
								spellCheck={false}
								aria-invalid={fieldErrors["applicationId"] !== undefined}
								{...(fieldErrors["applicationId"] === undefined
									? {}
									: { "aria-describedby": "applicationId-error" })}
								onChange={(event) => setApplicationId(event.target.value)}
							/>
							{fieldError("applicationId")}
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor={privateKeyId}>{t("banks.credentials.privateKey")}</Label>
							<Input
								id={privateKeyId}
								type="file"
								accept=".pem,.key,application/x-pem-file"
								aria-invalid={fieldErrors["privateKey"] !== undefined}
								aria-describedby={
									fieldErrors["privateKey"] === undefined
										? "privateKey-hint"
										: "privateKey-error privateKey-hint"
								}
								onChange={(event) => setFile(event.target.files?.[0] ?? null)}
							/>
							{fieldError("privateKey")}
							<p id="privateKey-hint" className="text-xs text-muted-foreground">
								{t("banks.credentials.privateKeyHint")}
							</p>
						</div>
					</fieldset>

					{failure !== null && (
						<p
							role="alert"
							className="rounded-md border border-destructive/50 p-3 text-sm text-destructive"
						>
							{failure}
						</p>
					)}

					<div>
						<Button type="submit" disabled={locked || save.isPending}>
							{save.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
							{t("banks.credentials.submit")}
						</Button>
					</div>
				</form>
			</div>
		</Section>
	);
}

/** Credentials pinned by `ENABLE_BANKING_*`: shown, never editable here. */
export function EnvironmentCredentials({
	applicationId,
	redirectUrl,
}: {
	applicationId: string | null;
	redirectUrl: string;
}) {
	const { t } = useTranslation();

	return (
		<Section id="bank-credentials-title" title={t("banks.credentials.title")}>
			<div className="flex flex-col gap-1 p-4">
				<p className="text-sm">{t("banks.credentials.environment")}</p>
				{applicationId !== null && (
					<p className="text-sm text-muted-foreground">
						{t("banks.credentials.current", { id: applicationId })}
					</p>
				)}
				<p className="text-sm text-muted-foreground">
					{t("banks.credentials.environmentDescription")}
				</p>
				<p className="mt-2 text-sm">{t("banks.credentials.redirectLabel")}</p>
				<CopyableAddress value={redirectUrl} copyLabel={t("banks.credentials.copy")} />
			</div>
		</Section>
	);
}
