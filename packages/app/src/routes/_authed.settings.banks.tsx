import type {
	BankConnectionData,
	BankSetupData,
	InstitutionData,
} from "@/hooks/useBankConnections";
import type { FormEvent } from "react";

import { Link, createFileRoute } from "@tanstack/react-router";
import {
	BuildingIcon,
	ChevronRightIcon,
	CopyIcon,
	Loader2Icon,
	LockIcon,
	SearchIcon,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { BankCountry } from "@archant/data/bank-countries";
import { BANK_COUNTRIES, DEFAULT_BANK_COUNTRY } from "@archant/data/bank-countries";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	useBankConnections,
	useBankSetup,
	useInstitutions,
	useSaveBankCredentials,
	useStartBankConnection,
} from "@/hooks/useBankConnections";
import { ApiError, errorCodeOf } from "@/lib/api";
import { errorMessage, showFailureToast } from "@/lib/error-toast";

export const Route = createFileRoute("/_authed/settings/banks")({
	component: BanksPage,
});

const DEPLOYMENT_GUIDE =
	"https://github.com/leger-dosage/archant/blob/main/docs/deployment.md#connecting-a-bank";

/** Where an application is created, as Sure's panel links it. */
const ENABLE_BANKING_PORTAL = "https://enablebanking.com/cp/applications";

const countryNames = new Intl.DisplayNames("fr", { type: "region" });
const byName = new Intl.Collator("fr", { sensitivity: "base" });

const countryName = (code: string) => countryNames.of(code) ?? code;

// France first, as the household's own; the rest by their French name.
const COUNTRIES: readonly BankCountry[] = [
	DEFAULT_BANK_COUNTRY,
	...BANK_COUNTRIES.filter((code) => code !== DEFAULT_BANK_COUNTRY).toSorted((left, right) =>
		byName.compare(countryName(left), countryName(right)),
	),
];

const consentDate = new Intl.DateTimeFormat("fr-FR", {
	day: "numeric",
	month: "long",
	year: "numeric",
});

const syncTime = new Intl.DateTimeFormat("fr-FR", {
	day: "numeric",
	month: "long",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
});

/** Case and accents ignored, as a user types a bank's name. */
const folded = (text: string) =>
	text
		.normalize("NFD")
		.replaceAll(/\p{Diacritic}/gu, "")
		.toLocaleLowerCase("fr")
		.trim();

/** Sure's `bank-search`: the query anywhere in the name or the BIC. */
function matches(institution: InstitutionData, query: string): boolean {
	return folded([institution.name, institution.bic ?? ""].join(" ")).includes(folded(query));
}

function Unavailable({ missing }: { missing: string[] }) {
	const { t } = useTranslation();

	return (
		<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-6">
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

/** The redirect address with a button that copies it, to paste into the portal. */
function RedirectAddress({ url }: { url: string }) {
	const { t } = useTranslation();

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(url);
			toast.success(t("banks.credentials.copied"));
		} catch {
			// No clipboard outside a secure context, or permission refused.
			toast.error(t("banks.credentials.copyFailed"));
		}
	};

	return (
		<div className="flex items-center gap-2">
			<code className="min-w-0 flex-1 rounded bg-muted px-2 py-1 font-mono text-sm break-all select-all">
				{url}
			</code>
			<Button
				type="button"
				variant="outline"
				size="icon"
				aria-label={t("banks.credentials.copy")}
				onClick={() => void copy()}
			>
				<CopyIcon aria-hidden />
			</Button>
		</div>
	);
}

/**
 * Sure's Enable Banking panel: the steps, the application ID and the `.pem`
 * file, whose text the browser reads and sends. No country here: it is
 * asked when connecting. Disabled, with Sure's warning, while a bank is
 * connected, since its session belongs to the current application.
 */
function CredentialsForm({ setup }: { setup: BankSetupData }) {
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
		<section aria-labelledby="bank-credentials-title" className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<h3 id="bank-credentials-title" className="text-base font-semibold">
					{t("banks.credentials.title")}
				</h3>
				<p className="text-sm text-muted-foreground">{t("banks.credentials.description")}</p>
			</div>

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
					<RedirectAddress url={setup.redirectUrl} />
				</li>
				<li>{t("banks.credentials.step3")}</li>
			</ol>

			{locked && (
				<div role="status" className="flex gap-3 rounded-lg border border-amber-500/50 p-4">
					<LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
					<div className="flex flex-col gap-1">
						<p className="text-sm font-medium">{t("banks.credentials.lockedTitle")}</p>
						<p className="text-sm text-muted-foreground">
							{t("banks.credentials.lockedDescription")}
						</p>
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
		</section>
	);
}

/** Credentials pinned by `ENABLE_BANKING_*`: shown, never editable here. */
function EnvironmentCredentials({
	applicationId,
	redirectUrl,
}: {
	applicationId: string | null;
	redirectUrl: string;
}) {
	const { t } = useTranslation();

	return (
		<section
			aria-labelledby="bank-credentials-title"
			className="flex flex-col gap-1 rounded-lg border p-4"
		>
			<h3 id="bank-credentials-title" className="text-base font-semibold">
				{t("banks.credentials.title")}
			</h3>
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
			<RedirectAddress url={redirectUrl} />
		</section>
	);
}

function InstitutionButton({
	institution,
	pending,
	disabled,
	onPick,
}: {
	institution: InstitutionData;
	pending: boolean;
	disabled: boolean;
	onPick: () => void;
}) {
	const { t } = useTranslation();

	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onPick}
			aria-label={t("banks.connect", { name: institution.name })}
			className="flex w-full items-center gap-4 rounded-lg border p-3 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
		>
			{institution.logo === null ? (
				<span className="flex size-10 shrink-0 items-center justify-center rounded bg-muted">
					<BuildingIcon className="size-5 text-muted-foreground" aria-hidden />
				</span>
			) : (
				<img
					src={institution.logo}
					alt=""
					loading="lazy"
					className="size-10 shrink-0 rounded object-contain"
				/>
			)}
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate text-sm font-medium">{institution.name}</span>
				{institution.bic !== null && (
					<span className="truncate text-xs text-muted-foreground">
						{t("banks.bic", { bic: institution.bic })}
					</span>
				)}
			</span>
			{pending ? (
				<Loader2Icon className="size-5 shrink-0 animate-spin text-muted-foreground" aria-hidden />
			) : (
				<ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
			)}
		</button>
	);
}

function Institutions({ country }: { country: BankCountry }) {
	const { t } = useTranslation();
	const searchId = useId();
	const institutions = useInstitutions(country, true);
	const start = useStartBankConnection();
	const [query, setQuery] = useState("");
	// Kept once the provider answers: the browser is leaving for the bank.
	const [picked, setPicked] = useState<string | null>(null);
	const list = institutions.data ?? [];
	const shown = useMemo(() => list.filter((item) => matches(item, query)), [list, query]);

	const pick = (institution: InstitutionData) => {
		setPicked(institution.name);
		start.mutate(
			{ country, institution: institution.name },
			{
				onSuccess: ({ url }) => window.location.assign(url),
				onError: (error) => {
					setPicked(null);
					showFailureToast(error);
				},
			},
		);
	};

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={searchId}>{t("banks.search")}</Label>
				<InputGroup>
					<InputGroupAddon>
						<SearchIcon aria-hidden />
					</InputGroupAddon>
					<InputGroupInput
						id={searchId}
						type="search"
						value={query}
						placeholder={t("banks.searchPlaceholder")}
						onChange={(event) => setQuery(event.target.value)}
					/>
				</InputGroup>
			</div>

			{institutions.isPending && (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-16 w-full" />
					<Skeleton className="h-16 w-full" />
					<Skeleton className="h-16 w-full" />
				</div>
			)}

			{institutions.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-6">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(institutions.error)}`)}</p>
					<Button variant="outline" onClick={() => void institutions.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{institutions.data !== undefined &&
				(list.length === 0 ? (
					<p className="text-sm text-muted-foreground">{t("banks.noInstitutions")}</p>
				) : shown.length === 0 ? (
					<p className="text-sm text-muted-foreground">{t("banks.noResults")}</p>
				) : (
					<ul aria-label={t("banks.institutions")} className="flex flex-col gap-2">
						{shown.map((institution) => (
							<li key={institution.name}>
								<InstitutionButton
									institution={institution}
									pending={picked === institution.name}
									disabled={picked !== null}
									onPick={() => pick(institution)}
								/>
							</li>
						))}
					</ul>
				))}
		</div>
	);
}

function Connections() {
	const { t } = useTranslation();
	const connections = useBankConnections(true);
	const list: BankConnectionData[] = connections.data ?? [];

	return (
		<section aria-labelledby="bank-connections-title" className="flex flex-col gap-3">
			<h3 id="bank-connections-title" className="text-base font-semibold">
				{t("banks.connections")}
			</h3>
			{connections.isPending && <Skeleton className="h-14 w-full" />}
			{connections.isError && (
				<p role="alert" className="text-sm text-muted-foreground">
					{t(`errors.${errorCodeOf(connections.error)}`)}
				</p>
			)}
			{connections.data !== undefined &&
				(list.length === 0 ? (
					<p className="text-sm text-muted-foreground">{t("banks.noConnections")}</p>
				) : (
					<ul aria-label={t("banks.connections")} className="divide-y rounded-lg border">
						{list.map((connection) => (
							<li key={connection.id}>
								<Link
									to="/settings/banks/$connectionId"
									params={{ connectionId: connection.id }}
									aria-label={t("banks.manage", { name: connection.institutionName })}
									className="flex items-center gap-4 px-4 py-3 transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
								>
									<span className="flex min-w-0 flex-1 flex-col gap-0.5">
										<span className="font-medium">{connection.institutionName}</span>
										<span className="text-sm text-muted-foreground">
											{countryName(connection.country)}
											{connection.alert === "consent_expired" ? (
												<>
													{" · "}
													{t("banks.consentExpired")}
												</>
											) : (
												connection.consentExpiresAt !== null && (
													<>
														{" · "}
														{t("banks.consentUntil", {
															date: consentDate.format(new Date(connection.consentExpiresAt)),
														})}
													</>
												)
											)}
										</span>
										<span className="text-sm text-muted-foreground">
											{connection.lastSyncedAt === null
												? t("banks.sync.never")
												: t("banks.sync.last", {
														when: syncTime.format(new Date(connection.lastSyncedAt)),
													})}
										</span>
									</span>
									<ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
								</Link>
							</li>
						))}
					</ul>
				))}
		</section>
	);
}

/**
 * Sure's `select_bank`: a country, then a bank, then off to the bank's
 * consent page. The bank sends the browser back to `/settings/banks/callback`.
 * Until Enable Banking is set up, Sure's panel stands in its place.
 */
function BanksPage() {
	const { t } = useTranslation();
	const setup = useBankSetup();

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("banks.title"), app: t("app.name") });
	}, [t]);

	const data = setup.data;

	return (
		<div className="flex max-w-2xl flex-col gap-6">
			<div className="flex flex-col gap-1">
				<h2 className="text-lg font-semibold">{t("banks.title")}</h2>
				<p className="text-sm text-muted-foreground">{t("banks.description")}</p>
			</div>

			{setup.isPending && <Skeleton className="h-24 w-full" />}

			{setup.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-6">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(setup.error)}`)}</p>
					<Button variant="outline" onClick={() => void setup.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{data !== undefined &&
				(data.missing.length > 0 ? (
					<Unavailable missing={data.missing} />
				) : data.source === null ? (
					<CredentialsForm setup={data} />
				) : (
					<>
						<ConnectBank />
						<Connections />
						{data.source === "environment" ? (
							<EnvironmentCredentials
								applicationId={data.applicationId}
								redirectUrl={data.redirectUrl}
							/>
						) : (
							// Keyed, so a saved ID becomes the form's starting value.
							<CredentialsForm key={data.applicationId} setup={data} />
						)}
					</>
				))}
		</div>
	);
}

function ConnectBank() {
	const { t } = useTranslation();
	const countryId = useId();
	const [country, setCountry] = useState<BankCountry>(DEFAULT_BANK_COUNTRY);

	return (
		<>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={countryId}>{t("banks.country")}</Label>
				<Select
					value={country}
					onValueChange={(value) => {
						const next = COUNTRIES.find((code) => code === value);

						if (next !== undefined) {
							setCountry(next);
						}
					}}
				>
					<SelectTrigger id={countryId} className="w-full sm:w-64">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{COUNTRIES.map((code) => (
							<SelectItem key={code} value={code}>
								{countryName(code)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			{/* Keyed, so a new country starts with an empty search. */}
			<Institutions key={country} country={country} />
		</>
	);
}
