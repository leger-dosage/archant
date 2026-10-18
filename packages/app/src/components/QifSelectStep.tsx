import type { CsvImportPreviewData } from "@/hooks/useCsvImport";

import { CircleAlertIcon, TagIcon, TriangleAlertIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { CsvImportConfigurationInput } from "@archant/api/schemas/csv-imports";

import { ChoiceField } from "@/components/ChoiceField";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

type QifPreview = NonNullable<CsvImportPreviewData["qif"]>;

/** The kept names once `name` is checked or unchecked. */
const toggled = (kept: ReadonlySet<string>, name: string, checked: boolean) =>
	checked ? [...kept, name] : [...kept].filter((other) => other !== name);

/** One checkable list, « Catégories » or « Étiquettes », as Sure's table of them. */
function Choices({
	id,
	heading,
	found,
	column,
	items,
	kept,
	onToggle,
}: {
	id: string;
	heading: string;
	found: string;
	column: string;
	items: readonly { name: string; count: number; split?: boolean }[];
	kept: ReadonlySet<string>;
	onToggle: (name: string, checked: boolean) => void;
}) {
	const { t } = useTranslation();

	return (
		<section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-3">
				<h2 id={`${id}-heading`} className="text-lg font-medium">
					{heading}
				</h2>
				<span className="text-sm text-muted-foreground">{found}</span>
			</div>
			<div className="overflow-hidden rounded-xl border bg-card">
				<div
					aria-hidden="true"
					className="grid grid-cols-[1.5rem_1fr_auto] gap-3 border-b px-4 py-3 text-xs font-medium text-muted-foreground uppercase"
				>
					<span />
					<span>{column}</span>
					<span className="text-right">{t("csvImport.qif.transactions")}</span>
				</div>
				<ul className="divide-y divide-line">
					{items.map((item, index) => {
						const checkbox = `${id}-${index}`;

						return (
							<li key={item.name}>
								<label
									htmlFor={checkbox}
									className="grid cursor-pointer grid-cols-[1.5rem_1fr_auto] items-center gap-3 px-4 py-3 hover:bg-hover"
								>
									<Checkbox
										id={checkbox}
										checked={kept.has(item.name)}
										aria-label={t("csvImport.qif.keep", { name: item.name })}
										onCheckedChange={(checked) => onToggle(item.name, checked === true)}
									/>
									<span className="flex min-w-0 items-center gap-2 text-sm">
										<span className="truncate">{item.name}</span>
										{item.split === true && (
											<span className="shrink-0 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs text-warning">
												{t("csvImport.qif.splitBadge")}
											</span>
										)}
									</span>
									<span className="text-right text-sm text-muted-foreground tabular-nums">
										{t("csvImport.qif.count", { count: item.count })}
									</span>
								</label>
							</li>
						);
					})}
				</ul>
			</div>
		</section>
	);
}

/**
 * Sure's « Configurer et sélectionner », `qif_category_selections/show`: the
 * file's date format with its first date, the split warning, then the
 * categories and tags to import, every one checked at first, and « Continuer
 * vers la revue ».
 */
export function QifSelectStep({
	preview,
	configuration,
	onChange,
	reading,
	error,
	onSubmit,
}: {
	preview: QifPreview;
	configuration: CsvImportConfigurationInput;
	onChange: (configuration: CsvImportConfigurationInput) => void;
	reading: boolean;
	error: string | null;
	onSubmit: () => void;
}) {
	const { t } = useTranslation();
	const keptCategories = new Set(
		configuration.qifCategories ?? preview.categories.map(({ name }) => name),
	);
	const keptTags = new Set(configuration.qifTags ?? preview.tags.map(({ name }) => name));
	const format = configuration.dateFormat ?? preview.dateFormats[0]?.format ?? "";
	const first = preview.dateFormats.find((candidate) => candidate.format === format)?.first;

	return (
		<form
			className="mx-auto flex w-full max-w-2xl flex-col gap-8"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			<section aria-labelledby="qif-date-format-heading" className="flex flex-col gap-3">
				<h2 id="qif-date-format-heading" className="text-lg font-medium">
					{t("csvImport.qif.dateFormat.heading")}
				</h2>
				<p className="text-sm text-muted-foreground">{t("csvImport.qif.dateFormat.description")}</p>
				{preview.dateFormats.length > 0 ? (
					<>
						<ChoiceField
							id="qif-date-format"
							label={t("csvImport.qif.dateFormat.heading")}
							value={format}
							options={preview.dateFormats.map((candidate) => ({
								value: candidate.format,
								label: candidate.label,
							}))}
							onChange={(value) => onChange({ ...configuration, dateFormat: value })}
						/>
						{first !== undefined && (
							<p className="text-xs text-muted-foreground">
								{t("csvImport.qif.dateFormat.preview", { date: first })}
							</p>
						)}
					</>
				) : (
					<div
						role="alert"
						className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
					>
						<CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
						<div className="flex flex-col gap-1">
							<p className="font-medium">{t("csvImport.qif.dateFormat.errorTitle")}</p>
							<p>{t("csvImport.qif.dateFormat.errorDescription")}</p>
						</div>
					</div>
				)}
			</section>
			{preview.splits && (
				<div className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
					<TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					<div className="flex flex-col gap-1">
						<p className="font-medium">{t("csvImport.qif.splitWarningTitle")}</p>
						<p>{t("csvImport.qif.splitWarningDescription")}</p>
					</div>
				</div>
			)}
			{preview.categories.length > 0 && (
				<Choices
					id="qif-categories"
					heading={t("csvImport.qif.categoriesHeading")}
					found={t("csvImport.qif.categoriesFound", { count: preview.categories.length })}
					column={t("csvImport.qif.categoryName")}
					items={preview.categories}
					kept={keptCategories}
					onToggle={(name, checked) =>
						onChange({ ...configuration, qifCategories: toggled(keptCategories, name, checked) })
					}
				/>
			)}
			{preview.tags.length > 0 && (
				<Choices
					id="qif-tags"
					heading={t("csvImport.qif.tagsHeading")}
					found={t("csvImport.qif.tagsFound", { count: preview.tags.length })}
					column={t("csvImport.qif.tagName")}
					items={preview.tags}
					kept={keptTags}
					onToggle={(name, checked) =>
						onChange({ ...configuration, qifTags: toggled(keptTags, name, checked) })
					}
				/>
			)}
			{preview.categories.length === 0 && preview.tags.length === 0 && (
				<div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
					<TagIcon aria-hidden="true" className="size-6" />
					<p className="text-sm">{t("csvImport.qif.emptyPrimary")}</p>
					<p className="text-xs">{t("csvImport.qif.emptySecondary")}</p>
				</div>
			)}
			<div className="flex flex-col items-center gap-2">
				<Button
					type="submit"
					className="w-full md:w-auto"
					disabled={preview.dateFormats.length === 0 || reading}
				>
					{reading ? t("csvImport.qif.applying") : t("csvImport.qif.submit")}
				</Button>
				{error !== null && (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				)}
			</div>
		</form>
	);
}
