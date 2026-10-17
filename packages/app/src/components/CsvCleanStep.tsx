import type { CsvImportPreviewData } from "@/hooks/useCsvImport";

import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { CleanKey } from "@archant/api/schemas/csv-imports";
import { CSV_ISSUE_CODES } from "@archant/api/schemas/csv-imports";

import { Button } from "@/components/ui/button";
import { fileIssuesOf, isCleaned } from "@/lib/csv-clean";
import { cn } from "@/lib/utils";

type Preview = CsvImportPreviewData;
type Issue = Preview["errors"][number];
type Row = Preview["clean"]["rows"][number];

/** Sure's `per_page` default of « Nettoyer ». */
const ROWS_PER_PAGE = 10;

const FIELDS = [
	"entity_type",
	"name",
	"amount",
	"currency",
	"date",
	"qty",
	"ticker",
	"price",
	"resource_type",
	"conditions",
	"actions",
] as const;

/** One refusal in French; a value it names is never an amount. */
export function useIssueText() {
	const { t } = useTranslation();

	return (issue: Issue) => {
		const code = CSV_ISSUE_CODES.find((known) => known === issue.code) ?? "unknown";
		const param = (name: string) => issue.params[name] ?? "";
		const field = FIELDS.find((known) => known === param("field"));
		const key = param("key");

		return t(`csvImport.issues.${code}`, {
			line: param("line"),
			field: field === undefined ? param("field") : t(`csvImport.fields.${field}`),
			format: param("format"),
			min: param("min"),
			max: param("max"),
			value: param("value"),
			currency: param("currency"),
			account: param("account"),
			ticker: param("ticker"),
			name: param("name"),
			columns: param("columns"),
			resource_type: param("resource_type"),
			key: key === "" ? t("csvImport.map.unassigned") : key,
		});
	};
}

/**
 * One cell of Sure's `import/rows/_form`: the value, saved when the field is
 * left, red with its reasons when the row's refusals name it.
 */
function Cell({
	row,
	column,
	columnKey,
	onEdit,
}: {
	row: Row;
	column: number;
	columnKey: CleanKey;
	onEdit: (line: number, key: CleanKey, value: string) => void;
}) {
	const { t } = useTranslation();
	const issueText = useIssueText();
	const value = row.values[column] ?? "";
	const [text, setText] = useState(value);
	const reasons = row.issues.filter((cell) => cell.column === column);
	const id = `csv-clean-${row.line}-${columnKey}`;

	return (
		<td className="min-w-[150px] border-l p-0 align-top first:border-l-0">
			<input
				id={id}
				value={text}
				aria-label={t("csvImport.clean.cell", {
					column: t(`csvImport.clean.columns.${columnKey}`),
					line: row.line,
				})}
				aria-invalid={reasons.length > 0}
				{...(reasons.length > 0 ? { "aria-describedby": `${id}-reason` } : {})}
				className={cn(
					"w-full border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
					reasons.length > 0 ? "border-destructive" : "border-transparent",
				)}
				onChange={(event) => setText(event.target.value)}
				onBlur={() => {
					if (text !== value) {
						onEdit(row.line, columnKey, text);
					}
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.currentTarget.blur();
					}
				}}
			/>
			{reasons.length > 0 && (
				<p id={`${id}-reason`} className="px-3 pb-2 text-xs break-words text-destructive">
					{reasons.map((reason) => issueText(reason.issue)).join(" ")}
				</p>
			)}
		</td>
	);
}

/**
 * Sure's « Nettoyez vos données », `import/cleans/show`: the rows ten per
 * page, « Toutes les lignes » or « Lignes d'erreur », each cell saved and
 * the row validated again when it is left, then « Étape suivante » once
 * every row is valid.
 */
export function CsvCleanStep({
	preview,
	reading,
	error,
	invalidNotice,
	onEdit,
	onNext,
}: {
	preview: Preview;
	reading: boolean;
	error: string | null;
	/** Sure's `invalid_data`: « Confirmer » found the rows invalid and sent the user back. */
	invalidNotice: boolean;
	onEdit: (line: number, key: CleanKey, value: string) => void;
	onNext: () => void;
}) {
	const { t } = useTranslation();
	const issueText = useIssueText();
	// « Lignes d'erreur »: the lines invalid when it was chosen. A row fixed
	// there stays until the view is chosen again, as Sure's frame updates the
	// row in place, so the cell the user moves to is not taken away.
	const [errorLines, setErrorLines] = useState<ReadonlySet<number> | null>(null);
	const [page, setPage] = useState(1);
	const cleaned = isCleaned(preview);
	const fileIssues = fileIssuesOf(preview);
	// Once every row is valid, Sure offers no view but all the rows.
	const shown =
		errorLines !== null && !cleaned
			? preview.clean.rows.filter((row) => errorLines.has(row.line) || row.issues.length > 0)
			: preview.clean.rows;
	const pages = Math.max(1, Math.ceil(shown.length / ROWS_PER_PAGE));
	// The last error fixed in « Lignes d'erreur » shows every row from the first page.
	const current = errorLines !== null && cleaned ? 1 : Math.min(page, pages);
	const rows = shown.slice((current - 1) * ROWS_PER_PAGE, current * ROWS_PER_PAGE);
	const columns = preview.clean.columns;
	// Once every row is valid the view shows them all: a page turned there leaves « Lignes d'erreur ».
	const turn = (next: number) => {
		if (cleaned) {
			setErrorLines(null);
		}

		setPage(next);
	};

	return (
		<div className="flex flex-col gap-4">
			{invalidNotice && !cleaned && (
				<p role="alert" className="text-center text-sm text-destructive">
					{t("csvImport.clean.invalidData")}
				</p>
			)}
			{cleaned ? (
				<div className="flex flex-col items-start justify-between gap-2 rounded-lg border bg-card p-3 md:flex-row md:items-center">
					<p className="flex items-center gap-2 text-sm text-money-income">
						<CircleCheckIcon aria-hidden="true" className="size-4 shrink-0" />
						{t("csvImport.clean.cleaned")}
					</p>
					<Button type="button" className="w-full md:w-auto" disabled={reading} onClick={onNext}>
						{t("csvImport.clean.next")}
					</Button>
				</div>
			) : (
				<div className="flex flex-col items-start justify-between gap-3 rounded-lg border bg-card p-3 md:flex-row md:items-center">
					<p className="flex items-center gap-2 text-sm text-destructive">
						<CircleAlertIcon aria-hidden="true" className="size-4 shrink-0" />
						{t("csvImport.clean.errorsNotice")}
					</p>
					<div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">
						<div
							role="group"
							aria-label={t("csvImport.clean.view")}
							className="inline-flex w-full rounded-lg bg-muted p-1 text-sm font-medium md:w-auto"
						>
							{[false, true].map((only) => (
								<button
									key={String(only)}
									type="button"
									aria-pressed={(errorLines !== null) === only}
									className={cn(
										"flex-1 rounded-md px-3 py-1.5 whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex-auto",
										(errorLines !== null) === only ? "bg-card shadow-xs" : "text-muted-foreground",
									)}
									onClick={() => {
										setErrorLines(
											only
												? new Set(
														preview.clean.rows
															.filter((row) => row.issues.length > 0)
															.map((row) => row.line),
													)
												: null,
										);
										setPage(1);
									}}
								>
									{only ? t("csvImport.clean.errorRows") : t("csvImport.clean.allRows")}
								</button>
							))}
						</div>
						<Button type="button" disabled>
							{t("csvImport.clean.next")}
						</Button>
					</div>
				</div>
			)}
			{fileIssues.length > 0 && (
				<div
					role="alert"
					className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
				>
					<CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					<ul className="flex min-w-0 flex-col gap-1">
						{fileIssues.map((issue, index) => (
							// Two refusals may read alike: their place in the list tells them apart.
							<li key={index} className="break-words">
								{issueText(issue)}
							</li>
						))}
					</ul>
				</div>
			)}
			<div className="overflow-x-auto rounded-xl border bg-card">
				<table className="w-full border-collapse text-sm">
					<caption className="sr-only">{t("csvImport.clean.caption")}</caption>
					<thead>
						<tr className="border-b bg-muted/50">
							{columns.map((key) => (
								<th
									key={key}
									scope="col"
									className="min-w-[150px] px-3 py-2 text-left text-xs font-medium text-muted-foreground uppercase"
								>
									{t(`csvImport.clean.columns.${key}`)}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={row.line} className="border-b last:border-b-0">
								{columns.map((key, column) => (
									<Cell
										// The server's value replaces the field once the row is read again.
										key={`${key} ${row.values[column] ?? ""}`}
										row={row}
										column={column}
										columnKey={key}
										onEdit={onEdit}
									/>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<nav
				aria-label={t("csvImport.clean.pages")}
				className="flex items-center justify-between gap-4"
			>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={current <= 1}
					onClick={() => turn(current - 1)}
				>
					{t("pagination.previous")}
				</Button>
				<p className="text-sm text-muted-foreground">
					{t("pagination.status", { page: current, pages })}
				</p>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={current >= pages}
					onClick={() => turn(current + 1)}
				>
					{t("pagination.next")}
				</Button>
			</nav>
			{error !== null && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
		</div>
	);
}
