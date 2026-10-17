import type { CsvImportPreviewData } from "@/hooks/useCsvImport";
import type { ReactNode } from "react";

import { useTranslation } from "react-i18next";

import type { CsvImportMappingsInput } from "@archant/api/schemas/csv-imports";
import { CREATE_NEW_KEY } from "@archant/api/schemas/csv-imports";
import type { AccountSubtype, AccountType } from "@archant/data/account-types";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_IDS, isSubtypeOf } from "@archant/data/account-types";

import { AccountSubtypeSelect } from "@/components/AccountSubtypeSelect";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useCategories } from "@/hooks/useCategories";
import { useTags } from "@/hooks/useTags";
import { categoryTree } from "@/lib/category-tree";

/** Sure's mapping steps: `AccountTypeMapping`, `AccountMapping`, `CategoryMapping`, `TagMapping`. */
export type MapKind = "accountTypes" | "accounts" | "categories" | "tags";

type ValueKind = Exclude<MapKind, "accountTypes">;

type Preview = CsvImportPreviewData;
type AccountTypeChoice = Preview["mappings"]["accountTypes"][number];

/** « Laisser non attribué »: a value no row of the household takes. */
const UNASSIGNED = "__unassigned__";

/** One row of « Mapper »: the file's value, the choice, how many rows hold it. */
function MappingRow({
	label,
	count,
	children,
}: {
	label: string;
	count: number;
	children: ReactNode;
}) {
	const { t } = useTranslation();

	return (
		<li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
			<div className="flex min-w-0 flex-col">
				<span className="truncate text-sm font-medium">{label}</span>
				<span className="text-xs text-muted-foreground">{t("csvImport.map.rows", { count })}</span>
			</div>
			<div className="flex w-full flex-col gap-3 sm:w-72">{children}</div>
		</li>
	);
}

const mappedType = (mapping: { type: AccountType | null; subtype: AccountSubtype | null }) =>
	mapping.type !== null && isSubtypeOf(mapping.type, mapping.subtype);

/** The household's rows a value may map to, a child category indented under its parent. */
function useOptions(kind: ValueKind, accounts: readonly { id: string; name: string }[]) {
	const categories = useCategories();
	const tags = useTags();

	if (kind === "accounts") {
		return accounts.map((account) => ({ id: account.id, name: account.name, child: false }));
	}

	if (kind === "tags") {
		return (tags.data ?? [])
			.toSorted((a, b) => a.name.localeCompare(b.name, "fr"))
			.map((tag) => ({ id: tag.id, name: tag.name, child: false }));
	}

	return categoryTree(categories.data ?? []).flatMap(({ parent, children }) => [
		{ id: parent.id, name: parent.name, child: false },
		...children.map((child) => ({ id: child.id, name: child.name, child: true })),
	]);
}

/**
 * One of Sure's « Attribuez vos … » steps: each value of the file mapped to
 * an Archant type, a loan's or a property's subtype included, or to one of
 * the household's accounts, categories or tags, a new one, or none for a
 * category or a tag. « Suivant » waits for every account type and account to
 * be mapped, as Sure's `publishable?`.
 */
export function CsvMapStep({
	kind,
	preview,
	mappings,
	accounts,
	onChange,
	reading,
	error,
	onSubmit,
}: {
	kind: MapKind;
	preview: Preview;
	mappings: CsvImportMappingsInput;
	/** The accounts « Attribuez vos comptes » offers. */
	accounts: readonly { id: string; name: string }[];
	onChange: (mappings: CsvImportMappingsInput) => void;
	reading: boolean;
	error: string | null;
	onSubmit: () => void;
}) {
	const { t } = useTranslation();
	const valueKind: ValueKind = kind === "accountTypes" ? "accounts" : kind;
	const options = useOptions(valueKind, accounts);
	const counts = new Map(preview.mappings[kind].map((mapping) => [mapping.key, mapping.count]));
	const accountTypes = mappings.accountTypes ?? [];
	const values = mappings[valueKind] ?? [];
	const keyLabel = (key: string) => (key === "" ? t("csvImport.map.unassigned") : key);
	const complete =
		kind === "accountTypes"
			? accountTypes.every(mappedType)
			: kind !== "accounts" || values.every((mapping) => mapping.value !== null);
	const optional = kind === "categories" || kind === "tags";

	const setType = (key: string, patch: Partial<AccountTypeChoice>) =>
		onChange({
			...mappings,
			accountTypes: accountTypes.map((mapping) =>
				mapping.key === key ? { ...mapping, ...patch } : mapping,
			),
		});
	const setValue = (key: string, value: string | null) =>
		onChange({
			...mappings,
			[valueKind]: values.map((mapping) => (mapping.key === key ? { ...mapping, value } : mapping)),
		});

	return (
		<form
			className="flex flex-col gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			<Section title={t("csvImport.map.csvColumn", { mapping: t(`csvImport.map.labels.${kind}`) })}>
				<ul className="divide-y divide-line">
					{kind === "accountTypes"
						? accountTypes.map((mapping, index) => (
								<MappingRow
									key={mapping.key}
									label={keyLabel(mapping.key)}
									count={counts.get(mapping.key) ?? 0}
								>
									<div className="flex flex-col gap-1.5">
										<Label htmlFor={`csv-import-type-${index}`}>
											{t("csvImport.map.archantColumn", {
												mapping: t("csvImport.map.labels.accountTypes"),
											})}
										</Label>
										<Select
											value={mapping.type ?? ""}
											onValueChange={(value) => {
												const chosen = ACCOUNT_TYPE_IDS.find((id) => id === value);

												if (chosen !== undefined) {
													setType(mapping.key, { type: chosen, subtype: null });
												}
											}}
										>
											<SelectTrigger
												id={`csv-import-type-${index}`}
												className="w-full"
												aria-invalid={mapping.type === null}
											>
												<SelectValue placeholder={t("csvImport.map.select")} />
											</SelectTrigger>
											<SelectContent>
												{ACCOUNT_TYPE_IDS.map((id) => (
													<SelectItem key={id} value={id}>
														{t(`accounts.types.${id}`)}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
									{mapping.type !== null && ACCOUNT_TYPES[mapping.type].subtypes.length > 0 && (
										<AccountSubtypeSelect
											id={`csv-import-subtype-${index}`}
											type={mapping.type}
											value={mapping.subtype ?? null}
											onChange={(subtype) => setType(mapping.key, { subtype })}
											error={undefined}
											label={t("csvImport.map.subtype")}
											prompt={t("csvImport.map.select")}
										/>
									)}
								</MappingRow>
							))
						: values.map((mapping, index) => (
								<MappingRow
									key={mapping.key}
									label={keyLabel(mapping.key)}
									count={counts.get(mapping.key) ?? 0}
								>
									<div className="flex flex-col gap-1.5">
										<Label htmlFor={`csv-import-${kind}-${index}`}>
											{t("csvImport.map.archantColumn", {
												mapping: t(`csvImport.map.labels.${kind}`),
											})}
										</Label>
										<Select
											value={mapping.value ?? (optional ? UNASSIGNED : "")}
											onValueChange={(value) =>
												setValue(mapping.key, value === UNASSIGNED ? null : value)
											}
										>
											<SelectTrigger
												id={`csv-import-${kind}-${index}`}
												className="w-full"
												aria-invalid={!optional && mapping.value === null}
											>
												<SelectValue placeholder={t("csvImport.map.select")} />
											</SelectTrigger>
											<SelectContent>
												{optional && (
													<SelectItem value={UNASSIGNED}>
														{t("csvImport.map.leaveUnassigned")}
													</SelectItem>
												)}
												{mapping.key.trim() !== "" && (
													<SelectItem value={CREATE_NEW_KEY}>
														{t(`csvImport.map.createNew.${valueKind}`)}
													</SelectItem>
												)}
												{options.map((option) => (
													<SelectItem
														key={option.id}
														value={option.id}
														className={option.child ? "pl-6" : undefined}
													>
														{option.name}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
								</MappingRow>
							))}
				</ul>
			</Section>
			<Button type="submit" className="self-center" disabled={!complete || reading}>
				{reading ? t("csvImport.configure.applying") : t("csvImport.map.next")}
			</Button>
			{error !== null && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
		</form>
	);
}
