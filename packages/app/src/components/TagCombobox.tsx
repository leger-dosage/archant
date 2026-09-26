import type { TagData } from "@/hooks/useTags";

import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { MAX_TAGS_PER_TRANSACTION } from "@archant/api/schemas/transactions";
import { TAG_NAME_MAX_LENGTH } from "@archant/data/schema/tags";

import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { useCreateTag } from "@/hooks/useTags";
import { errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { isNewName } from "@/lib/name-key";
import { matchesSearch } from "@/lib/search-match";

// cmdk matches on an item's value; ids keep two items apart whatever their
// names, and the filter reads the name from the keywords instead.
const CREATE = "create";

/** Case and accents aside, in list order: `Enter` picks the first match as the user reads it. */
function filterByName(value: string, search: string, keywords: string[] = []): number {
	// « Créer » names exactly what was typed, so it always matches.
	return value === CREATE || matchesSearch(keywords.join(" "), search) ? 1 : 0;
}

type TagComboboxProps = {
	/** Sorted by name, as the API lists them. */
	tags: readonly TagData[];
	/** The tags the transaction carries, each marked with a check. */
	value: readonly string[];
	/** Adds the tag when absent, removes it when present. */
	onToggle: (tagId: string) => void;
};

/**
 * A multiple-choice tag list to type into, and « Créer "…" » last when no tag
 * holds the typed name. Picking toggles a tag and keeps the list open;
 * « Créer » creates the tag, then selects it. The caller decides when the
 * choice is saved.
 */
export function TagCombobox({ tags, value, onToggle }: TagComboboxProps) {
	const { t } = useTranslation();
	const createTag = useCreateTag();
	const [search, setSearch] = useState("");
	const selected = new Set(value);
	// The API refuses a larger set; a tag already picked can still be removed.
	const full = selected.size >= MAX_TAGS_PER_TRANSACTION;
	const typed = search.trim();
	const canCreate =
		!full &&
		isNewName(
			typed,
			tags.map((tag) => tag.name),
			TAG_NAME_MAX_LENGTH,
		);

	const create = () => {
		if (createTag.isPending) {
			return;
		}

		createTag.mutate(
			{ name: typed },
			{
				onSuccess: (tag) => {
					setSearch("");
					onToggle(tag.id);
				},
				onError: (error) => showErrorToast(errorCodeOf(error)),
			},
		);
	};

	return (
		<Command filter={filterByName} loop>
			<CommandInput
				aria-label={t("transactions.tags.search")}
				placeholder={t("transactions.tags.search")}
				value={search}
				onValueChange={setSearch}
			/>
			<CommandList>
				<CommandEmpty>{t("transactions.tags.empty")}</CommandEmpty>
				<CommandGroup>
					{tags.map((tag) => (
						<CommandItem
							key={tag.id}
							value={tag.id}
							keywords={[tag.name]}
							data-checked={selected.has(tag.id)}
							aria-checked={selected.has(tag.id)}
							disabled={full && !selected.has(tag.id)}
							onSelect={() => onToggle(tag.id)}
						>
							<span className="truncate">{tag.name}</span>
						</CommandItem>
					))}
					{canCreate && (
						<CommandItem value={CREATE} disabled={createTag.isPending} onSelect={create}>
							<PlusIcon aria-hidden="true" />
							<span className="truncate">{t("transactions.tags.create", { name: typed })}</span>
						</CommandItem>
					)}
				</CommandGroup>
			</CommandList>
		</Command>
	);
}
