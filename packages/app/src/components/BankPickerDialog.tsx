import type { InstitutionData } from "@/hooks/useBankConnections";
import type { RefObject } from "react";

import { BuildingIcon, ChevronRightIcon, Loader2Icon, SearchIcon } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { BankCountry } from "@archant/data/bank-countries";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useInstitutions, useStartBankConnection } from "@/hooks/useBankConnections";
import { errorCodeOf } from "@/lib/api";
import { showFailureToast } from "@/lib/error-toast";

const countryNames = new Intl.DisplayNames("fr", { type: "region" });

export const countryName = (code: string) => countryNames.of(code) ?? code;

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

function Institutions({
	country,
	picked,
	onPick,
}: {
	country: BankCountry;
	picked: string | null;
	onPick: (institution: InstitutionData) => void;
}) {
	const { t } = useTranslation();
	const searchId = useId();
	// Mounted only while the dialog is open, so a page load asks nothing.
	const institutions = useInstitutions(country, true);
	const [query, setQuery] = useState("");
	const list = institutions.data ?? [];
	const shown = useMemo(() => list.filter((item) => matches(item, query)), [list, query]);

	return (
		<div className="flex min-w-0 flex-col gap-3">
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
						autoFocus
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
				<div role="alert" className="flex flex-col items-start gap-3">
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
					// Sure's `max-h-80 overflow-y-auto`: a country lists hundreds of
					// banks, and the dialog must stay within the screen. The padding
					// keeps a focused row's ring inside the scrolled box.
					<ul
						aria-label={t("banks.institutions")}
						className="-mx-1 flex max-h-80 flex-col gap-2 overflow-y-auto p-1"
					>
						{shown.map((institution) => (
							<li key={institution.name}>
								<InstitutionButton
									institution={institution}
									pending={picked === institution.name}
									disabled={picked !== null}
									onPick={() => onPick(institution)}
								/>
							</li>
						))}
					</ul>
				))}
		</div>
	);
}

/**
 * Sure's `select_bank` modal: a click on a bank starts its consent at once,
 * with no confirm step. Its content unmounts on close, so every opening
 * starts with an empty search.
 */
export function BankPickerDialog({
	country,
	open,
	onOpenChange,
	opener,
}: {
	country: BankCountry;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Focused again on close: two buttons open the picker, and neither is a `DialogTrigger`. */
	opener: RefObject<HTMLElement | null>;
}) {
	const { t } = useTranslation();
	const start = useStartBankConnection();
	// Kept once the provider answers: the browser is leaving for the bank.
	const [picked, setPicked] = useState<string | null>(null);

	useEffect(() => {
		// Back from the bank's site can restore this page from the back/forward
		// cache, with a bank still picked: every row, « Annuler » and closing
		// would stay refused.
		const restored = (event: PageTransitionEvent) => {
			if (event.persisted) {
				setPicked(null);
			}
		};

		window.addEventListener("pageshow", restored);
		return () => window.removeEventListener("pageshow", restored);
	}, []);

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
		<Dialog
			open={open}
			onOpenChange={(next) => {
				// A chosen bank's request is under way and the browser is about to
				// leave for the bank: closing now would hide that, not cancel it.
				if (next || picked === null) {
					onOpenChange(next);
				}
			}}
		>
			<DialogContent
				className="max-h-[90vh] overflow-y-auto"
				onCloseAutoFocus={(event) => {
					// Radix returns the focus to its trigger only, and there is none.
					event.preventDefault();
					opener.current?.focus();
				}}
			>
				<DialogHeader>
					<DialogTitle>{t("banks.chooseBank")}</DialogTitle>
					<DialogDescription>
						{t("banks.pickerDescription", { country: countryName(country) })}
					</DialogDescription>
				</DialogHeader>
				<Institutions country={country} picked={picked} onPick={pick} />
				<DialogFooter>
					<DialogClose asChild>
						<Button type="button" variant="outline" disabled={picked !== null}>
							{t("common.cancel")}
						</Button>
					</DialogClose>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
