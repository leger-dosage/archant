import type { BankConnectionData, InstitutionData } from "@/hooks/useBankConnections";

import { createFileRoute } from "@tanstack/react-router";
import { BuildingIcon, ChevronRightIcon, Loader2Icon, SearchIcon } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { BankCountry } from "@archant/data/bank-countries";
import { BANK_COUNTRIES, DEFAULT_BANK_COUNTRY } from "@archant/data/bank-countries";

import { Button } from "@/components/ui/button";
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
	useStartBankConnection,
} from "@/hooks/useBankConnections";
import { errorCodeOf } from "@/lib/api";
import { showFailureToast } from "@/lib/error-toast";

export const Route = createFileRoute("/_authed/reglages/banques")({
	component: BanksPage,
});

const DEPLOYMENT_GUIDE =
	"https://github.com/leger-dosage/archant/blob/main/docs/deployment.md#connecting-a-bank";

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
							<li key={connection.id} className="flex flex-col gap-0.5 px-4 py-3">
								<span className="font-medium">{connection.institutionName}</span>
								<span className="text-sm text-muted-foreground">
									{countryName(connection.country)}
									{connection.consentExpiresAt !== null && (
										<>
											{" · "}
											{t("banks.consentUntil", {
												date: consentDate.format(new Date(connection.consentExpiresAt)),
											})}
										</>
									)}
								</span>
							</li>
						))}
					</ul>
				))}
		</section>
	);
}

/**
 * Sure's `select_bank`: a country, then a bank, then off to the bank's
 * consent page. The bank sends the browser back to `/reglages/banques/retour`.
 */
function BanksPage() {
	const { t } = useTranslation();
	const countryId = useId();
	const setup = useBankSetup();
	const [country, setCountry] = useState<BankCountry>(DEFAULT_BANK_COUNTRY);

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("banks.title"), app: t("app.name") });
	}, [t]);

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

			{setup.data?.available === false && <Unavailable missing={setup.data.missing} />}

			{setup.data?.available === true && (
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
					<Connections />
				</>
			)}
		</div>
	);
}
