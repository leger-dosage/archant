import type { Status } from "@/components/StatusBadge";
import type { BankConnectionData } from "@/hooks/useBankConnections";

import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronRightIcon, LandmarkIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { BankCountry } from "@archant/data/bank-countries";
import { BANK_COUNTRIES, DEFAULT_BANK_COUNTRY } from "@archant/data/bank-countries";

import { CredentialsForm, EnvironmentCredentials, Unavailable } from "@/components/BankCredentials";
import { BankPickerDialog, countryName } from "@/components/BankPickerDialog";
import { EmptyState } from "@/components/EmptyState";
import { InsetGroup } from "@/components/InsetGroup";
import { ListCard } from "@/components/ListCard";
import { Page } from "@/components/Page";
import { Section } from "@/components/Section";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useBankConnections, useBankSetup } from "@/hooks/useBankConnections";
import { errorCodeOf } from "@/lib/api";

export const Route = createFileRoute("/_authed/settings/banks")({
	component: BanksPage,
});

const byName = new Intl.Collator("fr", { sensitivity: "base" });

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

const ALERT_BADGES = {
	consent_expiring: "consentExpiring",
	consent_expired: "consentExpired",
	sync_stale: "syncStale",
} as const satisfies Record<NonNullable<BankConnectionData["alert"]>, Status>;

/** `onChooseBank` opens the bank picker, the one way to add a bank. */
function Connections({ onChooseBank }: { onChooseBank: (opener: HTMLElement) => void }) {
	const { t } = useTranslation();
	const connections = useBankConnections(true);
	const list: BankConnectionData[] = connections.data ?? [];

	return (
		<ListCard>
			<InsetGroup
				id="bank-connections-title"
				level={2}
				title={t("banks.connections")}
				{...(connections.data === undefined ? {} : { count: list.length })}
			>
				{connections.isPending && (
					<div className="p-4">
						<Skeleton className="h-14 w-full" />
					</div>
				)}
				{connections.isError && (
					<p role="alert" className="p-4 text-muted-foreground">
						{t(`errors.${errorCodeOf(connections.error)}`)}
					</p>
				)}
				{connections.data !== undefined &&
					(list.length === 0 ? (
						// The group's block is the card already.
						<EmptyState
							flush
							icon={{ kind: "transfer", icon: LandmarkIcon }}
							title={t("banks.noConnections.title")}
							description={t("banks.noConnections.description")}
							action={
								<Button onClick={(event) => onChooseBank(event.currentTarget)}>
									{t("banks.noConnections.action")}
								</Button>
							}
						/>
					) : (
						<ul aria-label={t("banks.connections")} className="divide-y divide-line">
							{list.map((connection) => (
								<li key={connection.id}>
									<Link
										to="/settings/banks/$connectionId"
										params={{ connectionId: connection.id }}
										aria-label={t("banks.manage", { name: connection.institutionName })}
										className="flex min-h-14 items-center gap-4 px-4 py-3 transition-colors outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
									>
										<span className="flex min-w-0 flex-1 flex-col gap-0.5">
											<span className="flex flex-wrap items-center gap-2">
												<span className="font-medium">{connection.institutionName}</span>
												{connection.alert !== null && (
													<StatusBadge status={ALERT_BADGES[connection.alert]} />
												)}
											</span>
											<span className="text-muted-foreground">
												{countryName(connection.country)}
												{/* An ended consent has no date left to show: its badge says it. */}
												{connection.alert !== "consent_expired" &&
													connection.consentExpiresAt !== null && (
														<>
															{" · "}
															{t("banks.consentUntil", {
																date: consentDate.format(new Date(connection.consentExpiresAt)),
															})}
														</>
													)}
											</span>
											<span className="text-muted-foreground">
												{connection.lastSyncedAt === null
													? t("banks.sync.never")
													: t("banks.sync.last", {
															when: syncTime.format(new Date(connection.lastSyncedAt)),
														})}
											</span>
										</span>
										<ChevronRightIcon
											className="size-5 shrink-0 text-muted-foreground"
											aria-hidden
										/>
									</Link>
								</li>
							))}
						</ul>
					))}
			</InsetGroup>
		</ListCard>
	);
}

/**
 * Sure's `select_bank`: the connected banks first, then a country and a
 * button opening the bank picker, then off to the bank's consent page. The
 * bank sends the browser back to `/settings/banks/callback`.
 * Until Enable Banking is set up, Sure's panel stands in its place.
 */
function BanksPage() {
	const { t } = useTranslation();
	const setup = useBankSetup();

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("banks.title"), app: t("app.name") });
	}, [t]);

	const data = setup.data;
	// Here rather than in `ConnectBank`, since the empty « Banques connectées »
	// opens the same picker for the same country.
	const [country, setCountry] = useState<BankCountry>(DEFAULT_BANK_COUNTRY);
	const [pickerOpen, setPickerOpen] = useState(false);
	const opener = useRef<HTMLElement | null>(null);

	// The clicked button, not `document.activeElement`: Safari does not focus
	// a button on click.
	const openPicker = (button: HTMLElement) => {
		opener.current = button;
		setPickerOpen(true);
	};

	return (
		<Page centred title={t("banks.title")} description={t("banks.description")} className="gap-4">
			{setup.isPending && <Skeleton className="h-24 w-full" />}

			{setup.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border bg-card p-4">
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
						<Connections onChooseBank={openPicker} />
						<Section title={t("banks.picker")}>
							<ConnectBank
								country={country}
								onCountryChange={setCountry}
								onChooseBank={openPicker}
							/>
						</Section>
						<BankPickerDialog
							country={country}
							open={pickerOpen}
							onOpenChange={setPickerOpen}
							opener={opener}
						/>
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
		</Page>
	);
}

function ConnectBank({
	country,
	onCountryChange,
	onChooseBank,
}: {
	country: BankCountry;
	onCountryChange: (country: BankCountry) => void;
	onChooseBank: (opener: HTMLElement) => void;
}) {
	const { t } = useTranslation();
	const countryId = useId();

	// The country stays on the page, as Sure asks it before opening its picker.
	return (
		<div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
			<div className="flex flex-col gap-1.5">
				<Label htmlFor={countryId}>{t("banks.country")}</Label>
				<Select
					value={country}
					onValueChange={(value) => {
						const next = COUNTRIES.find((code) => code === value);

						if (next !== undefined) {
							onCountryChange(next);
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
			<Button type="button" onClick={(event) => onChooseBank(event.currentTarget)}>
				{t("banks.chooseBank")}
			</Button>
		</div>
	);
}
