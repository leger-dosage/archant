import { useTranslation } from "react-i18next";

import { MAX_CSV_SKIP_ROWS } from "@archant/api/schemas/imports";
import type { CsvDelimiter } from "@archant/data/csv-mapping";
import {
	CSV_COLUMN_ROLES,
	CSV_DATE_FORMATS,
	CSV_DECIMALS,
	CSV_DELIMITERS,
	CSV_SIGNS,
} from "@archant/data/csv-mapping";
import type { CsvMapping } from "@archant/data/schema/imports";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { csvTable, fitColumns } from "@/lib/import-preview";

const DELIMITER_KEYS = { ";": "semicolon", ",": "comma", "\t": "tab" } as const;

const DECIMAL_KEYS = { ",": "comma", ".": "point" } as const;

type Choice<Value extends string> = {
	id: string;
	label: string;
	value: Value;
	options: readonly { value: Value; label: string }[];
	onChange: (value: Value) => void;
};

function ChoiceField<Value extends string>({ id, label, value, options, onChange }: Choice<Value>) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={id}>{label}</Label>
			<Select
				value={value}
				onValueChange={(next) => {
					const option = options.find((candidate) => candidate.value === next);

					if (option !== undefined) {
						onChange(option.value);
					}
				}}
			>
				<SelectTrigger id={id} className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{options.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

type CsvColumnsProps = {
	/** The file's first records, as the server split them. */
	sample: string[][];
	/** The delimiter the server split `sample` with. */
	sampleDelimiter: CsvDelimiter;
	mapping: CsvMapping;
	onChange: (mapping: CsvMapping) => void;
};

/**
 * The Colonnes step: the first records under a role select per column, then
 * how the file is laid out. Columns go by position, as the parser reads them.
 */
export function CsvColumns({ sample, sampleDelimiter, mapping, onChange }: CsvColumnsProps) {
	const { t } = useTranslation();
	const table = csvTable(sample, sampleDelimiter, mapping);
	const columns = fitColumns(mapping.columns, table.width, "ignore");
	const nameOf = (index: number) => {
		const name = table.header?.[index]?.trim() ?? "";

		return name === "" ? t("imports.csv.unnamed", { number: index + 1 }) : name;
	};

	const change = (patch: Partial<CsvMapping>) => onChange({ ...mapping, columns, ...patch });

	return (
		<div className="flex min-w-0 flex-col gap-4">
			<div className="max-h-[40vh] overflow-auto rounded-md border">
				{table.width === 0 ? (
					<p className="p-3 text-muted-foreground">{t("imports.csv.empty")}</p>
				) : (
					<Table aria-label={t("imports.csv.label")}>
						<TableHeader>
							<TableRow>
								{columns.map((role, index) => (
									// Positions are the columns' identity: they never reorder.
									<TableHead key={index} scope="col" className="min-w-36 py-2 align-top">
										<div className="flex flex-col gap-1.5">
											<span className="truncate font-medium" title={nameOf(index)}>
												{nameOf(index)}
											</span>
											<Select
												value={role}
												onValueChange={(next) => {
													const picked = CSV_COLUMN_ROLES.find((candidate) => candidate === next);

													if (picked !== undefined) {
														change({
															columns: columns.map((current, at) =>
																at === index ? picked : current,
															),
														});
													}
												}}
											>
												<SelectTrigger
													size="sm"
													className="w-full"
													aria-label={t("imports.csv.column", { name: nameOf(index) })}
												>
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{CSV_COLUMN_ROLES.map((candidate) => (
														<SelectItem key={candidate} value={candidate}>
															{t(`imports.csv.roles.${candidate}`)}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
									</TableHead>
								))}
							</TableRow>
						</TableHeader>
						<TableBody>
							{table.rows.map((record, row) => (
								<TableRow key={row}>
									{columns.map((_role, index) => (
										<TableCell key={index} className="max-w-[24ch] truncate" title={record[index]}>
											{record[index] ?? ""}
										</TableCell>
									))}
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</div>

			<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
				<ChoiceField
					id="csv-delimiter"
					label={t("imports.csv.delimiter")}
					value={mapping.delimiter}
					options={CSV_DELIMITERS.map((value) => ({
						value,
						label: t(`imports.csv.delimiters.${DELIMITER_KEYS[value]}`),
					}))}
					// Another delimiter splits other columns: the roles start over.
					onChange={(delimiter) =>
						onChange({
							...mapping,
							delimiter,
							columns: fitColumns(
								[],
								csvTable(sample, sampleDelimiter, { ...mapping, delimiter }).width,
								"ignore",
							),
						})
					}
				/>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="csv-skip-rows">{t("imports.csv.skipRows")}</Label>
					<Input
						id="csv-skip-rows"
						type="number"
						inputMode="numeric"
						min={0}
						max={MAX_CSV_SKIP_ROWS}
						value={mapping.skipRows}
						onChange={(event) => {
							const value = Number.parseInt(event.target.value, 10);

							change({
								skipRows: Number.isNaN(value) ? 0 : Math.min(MAX_CSV_SKIP_ROWS, Math.max(0, value)),
							});
						}}
					/>
				</div>
				<div className="flex items-center gap-2 self-end pb-2">
					<Checkbox
						id="csv-has-header"
						checked={mapping.hasHeader}
						onCheckedChange={(checked) => change({ hasHeader: checked === true })}
					/>
					<Label htmlFor="csv-has-header">{t("imports.csv.hasHeader")}</Label>
				</div>
				<ChoiceField
					id="csv-date-format"
					label={t("imports.csv.dateFormat")}
					value={mapping.dateFormat}
					options={CSV_DATE_FORMATS.map((value) => ({
						value,
						label: t(`imports.csv.dateFormats.${value}`),
					}))}
					onChange={(dateFormat) => change({ dateFormat })}
				/>
				<ChoiceField
					id="csv-decimal"
					label={t("imports.csv.decimal")}
					value={mapping.decimal}
					options={CSV_DECIMALS.map((value) => ({
						value,
						label: t(`imports.csv.decimals.${DECIMAL_KEYS[value]}`),
					}))}
					onChange={(decimal) => change({ decimal })}
				/>
				<ChoiceField
					id="csv-sign"
					label={t("imports.csv.sign")}
					value={mapping.sign}
					options={CSV_SIGNS.map((value) => ({ value, label: t(`imports.csv.signs.${value}`) }))}
					onChange={(sign) => change({ sign })}
				/>
			</div>
		</div>
	);
}
