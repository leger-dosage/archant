import type { SecuritySearchData } from "@/hooks/useSecuritySearch";

import { PencilLineIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { SecurityChoiceInput } from "@archant/api/schemas/trades";
import { isValidIsin, normalizeIsin } from "@archant/api/schemas/trades";

import {
	Command,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { useSecuritySearch } from "@/hooks/useSecuritySearch";

/** What a pick sets: the choice the API takes, and what the field then shows. */
export type SecurityPick = { choice: SecurityChoiceInput; label: string };

type Listing = SecuritySearchData["items"][number];
type Known = SecuritySearchData["known"][number];

const MANUAL = "manual";

/** A security's line under its name: its symbol or ISIN, its venue and its currency, each when known. */
function detailOf(security: {
	ticker: string | null;
	mic: string | null;
	currency: string | null;
	isin?: string | null;
}) {
	return [security.ticker ?? security.isin, security.mic, security.currency]
		.filter((part): part is string => typeof part === "string")
		.join(" · ");
}

/**
 * A security typed by hand, from what was typed in the search: its ISIN when
 * the text is one, its name otherwise, so nothing is typed twice.
 */
function manualChoice(search: string): SecurityChoiceInput {
	const isin = normalizeIsin(search);

	return isValidIsin(isin)
		? { source: "manual", isin, name: "" }
		: { source: "manual", isin: "", name: search.trim() };
}

/** What the field shows once a security is picked. */
export function securityLabel(security: { name: string; ticker: string | null }): string {
	return security.ticker === null ? security.name : `${security.name} (${security.ticker})`;
}

/**
 * The trade form's security list to type into: the securities already
 * known, then the provider's listings, then « Saisir un titre manuellement »,
 * which the form follows with an ISIN and a name. While fetching is off, or
 * the provider fails, it says so and offers the known securities and manual
 * entry alone. The caller puts it in a popover and closes it on `onSelect`.
 */
export function SecurityCombobox({ onSelect }: { onSelect: (pick: SecurityPick) => void }) {
	const { t } = useTranslation();
	const [search, setSearch] = useState("");
	const results = useSecuritySearch(search);
	const typed = search.trim() !== "";
	const data = typed ? results.data : undefined;
	const known: readonly Known[] = data?.known ?? [];
	const listings: readonly Listing[] = data?.items ?? [];
	const notice =
		data === undefined
			? null
			: !data.enabled
				? t("trades.security.off")
				: data.unavailable
					? t("trades.security.unavailable")
					: null;

	const pickKnown = (security: Known) =>
		onSelect({ choice: { source: "known", id: security.id }, label: securityLabel(security) });

	const pickListing = (listing: Listing) =>
		onSelect({
			choice: { source: "listing", ...listing },
			label: securityLabel(listing),
		});

	return (
		// The server filters; cmdk only moves the highlight.
		<Command shouldFilter={false} loop>
			<CommandInput
				aria-label={t("trades.security.search")}
				placeholder={t("trades.security.search")}
				value={search}
				onValueChange={setSearch}
			/>
			<CommandList>
				{!typed && (
					<p className="px-3 py-2 text-xs text-muted-foreground">{t("trades.security.hint")}</p>
				)}
				{notice !== null && (
					<p role="status" className="px-3 py-2 text-xs text-muted-foreground">
						{notice}
					</p>
				)}
				{typed && results.isFetching && data === undefined && (
					<p className="px-3 py-2 text-xs text-muted-foreground">{t("trades.security.loading")}</p>
				)}
				{typed && results.isError && (
					<p role="status" className="px-3 py-2 text-xs text-muted-foreground">
						{t("trades.security.failed")}
					</p>
				)}
				{data !== undefined && known.length === 0 && listings.length === 0 && (
					<p className="px-3 py-2 text-xs text-muted-foreground">{t("trades.security.empty")}</p>
				)}
				{known.length > 0 && (
					<CommandGroup heading={t("trades.security.known")}>
						{known.map((security) => (
							<CommandItem
								key={security.id}
								value={`known:${security.id}`}
								onSelect={() => pickKnown(security)}
							>
								<span className="flex min-w-0 flex-col">
									<span className="truncate">{security.name}</span>
									<span className="truncate text-xs text-muted-foreground">
										{detailOf(security)}
									</span>
								</span>
							</CommandItem>
						))}
					</CommandGroup>
				)}
				{listings.length > 0 && (
					<CommandGroup heading={t("trades.security.listings")}>
						{listings.map((listing) => (
							<CommandItem
								key={`${listing.ticker} ${listing.mic ?? ""}`}
								value={`listing:${listing.ticker}:${listing.mic ?? ""}`}
								onSelect={() => pickListing(listing)}
							>
								<span className="flex min-w-0 flex-col">
									<span className="truncate">{listing.name}</span>
									<span className="truncate text-xs text-muted-foreground">
										{detailOf(listing)}
									</span>
								</span>
							</CommandItem>
						))}
					</CommandGroup>
				)}
				<CommandGroup>
					<CommandItem
						value={MANUAL}
						onSelect={() =>
							onSelect({ choice: manualChoice(search), label: t("trades.form.manualPick") })
						}
					>
						<PencilLineIcon aria-hidden="true" />
						<span>{t("trades.security.manual")}</span>
					</CommandItem>
				</CommandGroup>
			</CommandList>
		</Command>
	);
}
