import type { TagData } from "@/hooks/useTags";

import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { MAX_TAGS_PER_TRANSACTION } from "@archant/api/schemas/transactions";
import { TAG_NAME_MAX_LENGTH } from "@archant/data/name-limits";

import { TagBadge } from "@/components/TagBadge";
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
import { filterByName } from "@/lib/search-match";

// cmdk matches on an item's value; ids keep two items apart whatever their
// names, and the filter reads the name from the keywords instead.
const CREATE = "create";
const NONE = "none";

const filterOptions = filterByName([CREATE]);

type TagComboboxProps = {
	/** Sorted by name, as the API lists them. */
	tags: readonly TagData[];
	/** The tags the transaction carries, each marked with a check. */
	value: readonly string[];
	/** Adds the tag when absent, removes it when present. */
	onToggle: (tagId: string) => void;
	/**
	 * Offers « Aucune étiquette » first, as Sure's bulk select's blank option,
	 * marked while `noneChecked`: the bulk edit drawer's only way to clear the tags.
	 */
	onNone?: () => void;
	noneChecked?: boolean;
};

/**
 * A multiple-choice tag list to type into, and « Créer "…" » last when no tag
 * holds the typed name. Picking toggles a tag and keeps the list open;
 * « Créer » creates the tag, then selects it. The caller decides when the
 * choice is saved.
 */
export function TagCombobox({
	tags,
	value,
	onToggle,
	onNone,
	noneChecked = false,
}: TagComboboxProps) {
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
		<Command filter={filterOptions} loop>
			<CommandInput
				aria-label={t("transactions.tags.search")}
				placeholder={t("transactions.tags.search")}
				value={search}
				onValueChange={setSearch}
			/>
			<CommandList>
				<CommandEmpty>{t("transactions.tags.empty")}</CommandEmpty>
				<CommandGroup>
					{onNone !== undefined && (
						<CommandItem
							value={NONE}
							keywords={[t("transactions.tags.none")]}
							data-checked={noneChecked}
							aria-checked={noneChecked}
							onSelect={onNone}
						>
							<span>{t("transactions.tags.none")}</span>
						</CommandItem>
					)}
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
							<TagBadge tag={tag} />
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
