import type { MerchantData } from "@/hooks/useMerchants";

import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { MERCHANT_NAME_MAX_LENGTH } from "@archant/data/schema/merchants";

import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { useCreateMerchant } from "@/hooks/useMerchants";
import { errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { matchesCommand } from "@/lib/shortcuts";

// cmdk matches on an item's value; ids keep two items apart whatever their
// names, and the filter reads the name from the keywords instead.
const NONE = "none";
const CREATE = "create";

/** Case and accents aside, in list order: `Enter` picks the first match as the user reads it. */
function filterByName(value: string, search: string, keywords: string[] = []): number {
	// « Créer » names exactly what was typed, so it always matches.
	return value === CREATE || matchesCommand(keywords.join(" "), search) ? 1 : 0;
}

/**
 * The name the API would store, folded as it compares names: « Créer » is
 * only offered for a name no merchant holds yet.
 */
function nameKey(name: string): string {
	return name.trim().normalize("NFC").toLocaleLowerCase("fr");
}

type MerchantComboboxProps = {
	/** Sorted by name, as the API lists them. */
	merchants: readonly MerchantData[];
	/** The current merchant, marked in the list; `null` for « Sans marchand ». */
	value: string | null;
	onSelect: (merchantId: string | null) => void;
	/** A merge target picker offers neither « Sans marchand » nor « Créer ». */
	mode?: "edit" | "target";
	/** Left out of the list: the merged merchant itself. */
	exclude?: string;
};

/**
 * A single-choice merchant list to type into: « Sans marchand » first, then
 * every merchant, and « Créer "…" » last when no merchant holds the typed
 * name. Picking it creates the merchant, then selects it. The caller puts it
 * in a popover and closes it on `onSelect`.
 */
export function MerchantCombobox({
	merchants,
	value,
	onSelect,
	mode = "edit",
	exclude,
}: MerchantComboboxProps) {
	const { t } = useTranslation();
	const createMerchant = useCreateMerchant();
	const [search, setSearch] = useState("");
	const none = t("transactions.merchant.none");
	const offered = merchants.filter((merchant) => merchant.id !== exclude);
	const typed = search.trim();
	const canCreate =
		mode === "edit" &&
		typed !== "" &&
		// The API would refuse a longer name.
		typed.normalize("NFC").length <= MERCHANT_NAME_MAX_LENGTH &&
		!merchants.some((merchant) => nameKey(merchant.name) === nameKey(typed));

	const create = () => {
		if (createMerchant.isPending) {
			return;
		}

		createMerchant.mutate(
			{ name: typed },
			{
				onSuccess: (merchant) => onSelect(merchant.id),
				onError: (error) => showErrorToast(errorCodeOf(error)),
			},
		);
	};

	return (
		<Command filter={filterByName} loop>
			<CommandInput
				aria-label={t("transactions.merchant.search")}
				placeholder={t("transactions.merchant.search")}
				value={search}
				onValueChange={setSearch}
			/>
			<CommandList>
				<CommandEmpty>{t("transactions.merchant.empty")}</CommandEmpty>
				<CommandGroup>
					{mode === "edit" && (
						<CommandItem
							value={NONE}
							keywords={[none]}
							data-checked={value === null}
							onSelect={() => onSelect(null)}
						>
							<span>{none}</span>
						</CommandItem>
					)}
					{offered.map((merchant) => (
						<CommandItem
							key={merchant.id}
							value={merchant.id}
							keywords={[merchant.name]}
							data-checked={merchant.id === value}
							onSelect={() => onSelect(merchant.id)}
						>
							<span className="truncate">{merchant.name}</span>
						</CommandItem>
					))}
					{canCreate && (
						<CommandItem value={CREATE} disabled={createMerchant.isPending} onSelect={create}>
							<PlusIcon aria-hidden="true" />
							<span className="truncate">{t("transactions.merchant.create", { name: typed })}</span>
						</CommandItem>
					)}
				</CommandGroup>
			</CommandList>
		</Command>
	);
}
