import type { MapKind } from "@/components/CsvMapStep";
import type { CsvImportDraft, CsvImportPreviewData } from "@/hooks/useCsvImport";
import type { DragEvent } from "react";

import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { CircleAlertIcon, CircleCheckIcon, FileSpreadsheetIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
	AmountTypeStrategy,
	ColumnKey,
	CsvImportConfigurationInput,
	CsvImportMappingsInput,
	CsvImportType,
	CsvSeparator,
	NumberFormat,
	SignageConvention,
	ToolImportType,
} from "@archant/api/schemas/csv-imports";
import {
	AMOUNT_TYPE_STRATEGIES,
	COLUMN_KEYS,
	COLUMN_KEY_LIST,
	CSV_IMPORT_TYPES,
	CSV_ISSUE_CODES,
	CSV_SEPARATORS,
	MAX_ROWS_TO_SKIP,
	NUMBER_FORMATS,
	SIGNAGE_CONVENTIONS,
	dateFormatsOf,
	isToolImport,
} from "@archant/api/schemas/csv-imports";
import { supportsTrades } from "@archant/data/account-types";

import { ChoiceField } from "@/components/ChoiceField";
import { CsvMapStep } from "@/components/CsvMapStep";
import { Page } from "@/components/Page";
import { Button } from "@/components/ui/button";
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
import { useAccounts } from "@/hooks/useAccounts";
import { useCsvImportPreview, usePublishCsvImport } from "@/hooks/useCsvImport";
import { accountsByName } from "@/lib/account-list";
import { errorCodeOf } from "@/lib/api";
import { errorMessage } from "@/lib/error-toast";
import { cn } from "@/lib/utils";

const isCsvImportType = (kind: string): kind is CsvImportType =>
	CSV_IMPORT_TYPES.some((type) => type === kind);

export const Route = createFileRoute("/_authed/settings/imports_/$kind")({
	beforeLoad: ({ params }) => {
		if (!isCsvImportType(params.kind)) {
			throw notFound();
		}
	},
	component: CsvImportRoute,
});

type Step = "upload" | "configure" | "map" | "confirm";

type Preview = CsvImportPreviewData;
type Issue = Preview["errors"][number];

/** A file broken on every line would otherwise list 10,000 of them. */
const SHOWN_ERRORS = 50;

/** No column chosen, « Laisser vide »: a value no header takes. */
const NONE = "__none__";

/** A blank cell of the type column, which a select cannot hold as its value. */
const BLANK = "__blank__";

/** Sure's `required_column_keys` of the forms that map columns. */
const REQUIRED_COLUMNS: Partial<Record<CsvImportType, readonly ColumnKey[]>> = {
	transactions: ["date", "amount"],
	accounts: ["name", "amount"],
	trades: ["date", "ticker", "qty", "price"],
	mint: ["date", "amount"],
	// YNAB's amount comes from its own columns, which the form does not map.
	ynab: ["date"],
	actual: ["date", "amount"],
};

/** The optional columns each tool's form shows last, in Sure's order: Mint's has tags, not notes. */
const TOOL_FIELDS: Record<ToolImportType, readonly ColumnKey[]> = {
	mint: ["account", "name", "category", "tags"],
	ynab: ["account", "name", "category", "notes"],
	actual: ["account", "name", "category", "notes"],
};

/** Sure's `csv_template` of each import, offered as « Téléchargez un exemple de fichier CSV ». */
const TEMPLATES: Record<CsvImportType, string> = {
	transactions: [
		"date*,amount*,name,currency,category,tags,account,notes",
		"2024-05-15,-45.99,Grocery Store,USD,Food,groceries|essentials,Checking Account,Monthly grocery run",
		"2024-05-16,1500.00,Salary,,Income,,Main Account,",
		"2024-05-17,-12.50,Coffee Shop,,,coffee,,",
	].join("\n"),
	accounts: [
		"Account type*,Name*,Balance*,Currency,Balance Date",
		"Checking,Main Checking Account,1000.00,USD,2024-01-01",
		"Savings,Emergency Fund,5000.00,USD,2024-01-15",
		"Credit Card,Rewards Card,-500.00,USD,2024-02-01",
	].join("\n"),
	categories: [
		"name*,color,parent_category,lucide_icon",
		"Food & Drink,#f97316,,carrot",
		"Groceries,#407706,Food & Drink,shopping-basket",
		"Salary,#22c55e,,briefcase",
	].join("\n"),
	merchants: [
		"name*,color,website_url",
		"Coffee Shop,#e99537,https://coffeeshop.com",
		"Pizza Palace,#4da568,https://pizzapalace.com",
		"Bookstore,,",
	].join("\n"),
	rules: [
		"name,resource_type*,active,effective_date,conditions*,actions*",
		'Categorize groceries,transaction,true,2024-01-01,"[{""condition_type"":""transaction_name"",""operator"":""like"",""value"":""grocery""}]","[{""action_type"":""set_transaction_category"",""value"":""Groceries""}]"',
		'Auto-categorize transactions,transaction,true,,"[{""condition_type"":""transaction_name"",""operator"":""like"",""value"":""amazon""}]","[{""action_type"":""auto_categorize""}]"',
	].join("\n"),
	trades: [
		"date*,ticker*,exchange_operating_mic,currency,qty*,price*,account,name",
		"2024-05-15,AAPL,XNAS,USD,10,150.00,Trading Account,Apple Inc. Purchase",
		"2024-05-16,GOOGL,XNAS,USD,-5,2500.00,Investment Account,Alphabet Inc. Sale",
		"2024-05-17,TSLA,XNAS,USD,2,700.50,Retirement Account,Tesla Inc. Purchase",
	].join("\n"),
	mint: [
		"Date,Amount,Account Name,Description,Category,Labels,Currency,Notes,Transaction Type",
		"01/01/2024,8.55,Checking,Starbucks,Food & Drink,Coffee|Breakfast,USD,Morning coffee,debit",
		"04/15/2024,2000,Savings,Paycheck,Income,,USD,Bi-weekly salary,credit",
	].join("\n"),
	ynab: [
		"Account,Flag,Date,Payee,Category Group/Category,Category Group,Category,Memo,Outflow,Inflow,Cleared",
		"Checking,,01/01/2024,Employer,Income: Paycheck,Income,Paycheck,Monthly salary,$0.00,$2500.00,Cleared",
		"Credit Card,,01/03/2024,Coffee Shop,Dining Out: Coffee,Dining Out,Coffee,Morning coffee,$4.25,$0.00,Uncleared",
	].join("\n"),
	actual: [
		"Account,Date,Payee,Notes,Category_Group,Category,Amount,Split_Amount,Cleared",
		"Checking Account,2024-01-01,Employer,Monthly salary,Income,Paycheck,2500.00,0,Reconciled",
		"Credit Card,2024-01-03,Coffee Shop,Morning coffee,Food,Coffee,-4.25,0,Cleared",
	].join("\n"),
};

/** The choices the preview read the file with, kept for the next post. */
function configurationOf(resolved: Preview["configuration"]): CsvImportConfigurationInput {
	const columns: Partial<Record<ColumnKey, string | null>> = {};

	for (const [key, value] of Object.entries(resolved.columns)) {
		const known = COLUMN_KEY_LIST.find((column) => column === key);

		if (known !== undefined && value !== undefined) {
			columns[known] = value;
		}
	}

	return { ...resolved, columns };
}

/**
 * Sure's `mapping_steps` of `type`: account types; the accounts of a
 * multi-account trade file; the categories and tags of a transaction file,
 * and its accounts when it names them; a Mint file's categories, tags and
 * accounts; a YNAB or Actual file's categories and accounts.
 */
function mapStepsOf(type: CsvImportType, accountId: string | null | undefined): MapKind[] {
	const multiAccount = (accountId ?? null) === null;

	switch (type) {
		case "accounts":
			return ["accountTypes"];
		case "trades":
			return multiAccount ? ["accounts"] : [];
		case "transactions":
			return multiAccount ? ["categories", "tags", "accounts"] : ["categories", "tags"];
		case "mint":
			return ["categories", "tags", "accounts"];
		case "ynab":
		case "actual":
			return ["categories", "accounts"];
		default:
			return [];
	}
}

/** Whether an import of `type` names its account at upload, « Compte (facultatif) ». */
const choosesAccount = (type: CsvImportType) => type === "trades" || type === "transactions";

/**
 * The accounts an import of `type` writes into: for trades those Sure's
 * `supports_trades?` accepts; for transactions any active one at upload, as
 * Sure's `accessible_accounts.visible`, and in « Attribuez vos comptes » only
 * those no bank feeds, as Sure's `accounts.manual`.
 */
function useImportAccounts(type: CsvImportType, step: "upload" | "map") {
	const accounts = useAccounts({ select: accountsByName });

	return (accounts.data ?? []).filter(
		(account) =>
			account.active &&
			(type === "trades" ? supportsTrades(account) : step === "upload" || !account.linked),
	);
}

/** One page per import type: another type starts from an empty upload, never the last one's file. */
function CsvImportRoute() {
	const { kind } = Route.useParams();

	return <CsvImportPage key={kind} />;
}

/**
 * Sure's raw-data imports: « Téléverser », « Configurer », « Mapper » where
 * the type needs it, « Confirmer », then « Importation réussie ». The page
 * keeps the file and its choices and posts them at each step: nothing is
 * stored on the server in between.
 */
function CsvImportPage() {
	const { t } = useTranslation();
	const { kind } = Route.useParams();
	const type = isCsvImportType(kind) ? kind : "categories";
	const [step, setStep] = useState<Step>("upload");
	// Which of Sure's mapping steps « Mapper » shows, as its `step` parameter.
	const [mapIndex, setMapIndex] = useState(0);
	const [file, setFile] = useState<File | null>(null);
	const [configuration, setConfiguration] = useState<CsvImportConfigurationInput>({});
	const [mappings, setMappings] = useState<CsvImportMappingsInput | undefined>(undefined);
	const [preview, setPreview] = useState<Preview | null>(null);
	const [done, setDone] = useState(false);
	const read = useCsvImportPreview();
	const publish = usePublishCsvImport();
	const mapAccounts = useImportAccounts(type, "map");

	useEffect(() => {
		document.title = t("app.pageTitle", {
			page: t(`csvImport.sources.${type}`),
			app: t("app.name"),
		});
	}, [t, type]);

	const draft = (patch: Partial<CsvImportDraft> = {}): CsvImportDraft | null =>
		file === null ? null : { type, file, configuration, mappings, ...patch };

	/** Posts the draft to the preview, then moves to `next` with what it read. */
	const advance = (next: Step, patch: Partial<CsvImportDraft> = {}) => {
		const posted = draft(patch);

		if (posted === null) {
			return;
		}

		read.mutate(posted, {
			onSuccess: (data) => {
				setPreview(data);
				setConfiguration(configurationOf(data.configuration));
				setMappings({
					accountTypes: data.mappings.accountTypes.map(({ key, type: mapped, subtype }) => ({
						key,
						type: mapped,
						subtype,
					})),
					accounts: data.mappings.accounts.map(({ key, value }) => ({ key, value })),
					categories: data.mappings.categories.map(({ key, value }) => ({ key, value })),
					tags: data.mappings.tags.map(({ key, value }) => ({ key, value })),
				});
				setMapIndex(0);
				setStep(next);
			},
		});
	};

	if (done) {
		return (
			<Page
				centred
				title={t("csvImport.success.title")}
				description={t("csvImport.success.description")}
			>
				<div className="flex flex-col items-center gap-4 py-6">
					<CircleCheckIcon aria-hidden="true" className="size-10 text-money-income" />
					<Button asChild>
						<Link to="/">{t("csvImport.success.dashboard")}</Link>
					</Button>
				</div>
			</Page>
		);
	}

	const mapSteps = mapStepsOf(type, configuration.accountId);
	const mapKind = mapSteps[mapIndex] ?? mapSteps[0] ?? "accounts";
	const steps: Step[] =
		mapSteps.length > 0
			? ["upload", "configure", "map", "confirm"]
			: ["upload", "configure", "confirm"];
	const error = read.error === null ? null : errorMessage(read.error);
	const stepTitles: Record<Step, string> = {
		upload: t("csvImport.upload.title"),
		configure: t("csvImport.configure.title"),
		map: t(`csvImport.map.titles.${mapKind}`),
		confirm: t("csvImport.confirm.title"),
	};
	const stepDescriptions: Record<Step, string> = {
		upload: t("csvImport.upload.description"),
		configure: t("csvImport.configure.description"),
		map: t(`csvImport.map.descriptions.${mapKind}`),
		confirm: t("csvImport.confirm.description"),
	};

	return (
		<Page centred title={stepTitles[step]} description={stepDescriptions[step]}>
			<div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
				<Steps
					steps={steps}
					current={step}
					onBack={(target) => {
						read.reset();
						publish.reset();
						setMapIndex(0);
						setStep(target);
					}}
				/>
				{step === "upload" && (
					<UploadStep
						type={type}
						file={file}
						separator={configuration.separator ?? ","}
						accountId={configuration.accountId ?? null}
						reading={read.isPending}
						error={error}
						onFile={(chosen) => {
							read.reset();
							setFile(chosen);
							// Another file has other headers and values: its columns are
							// preselected again and its values mapped again.
							setConfiguration({
								separator: configuration.separator,
								accountId: configuration.accountId,
							});
							setMappings(undefined);
						}}
						onChoices={(choices) => {
							read.reset();
							// Another file or separator reads other headers: the columns start over.
							setConfiguration({ ...choices });
						}}
						onSubmit={() => {
							advance("configure");
						}}
					/>
				)}
				{step === "configure" && preview !== null && (
					<ConfigureStep
						type={type}
						preview={preview}
						configuration={configuration}
						onChange={(next) => {
							// Another date column reads other dates: the file is read again so
							// the server guesses its format, as Sure's `detect_date_format`,
							// and shows its first date.
							if (next.columns?.date !== configuration.columns?.date) {
								const { dateFormat: _guessedAgain, ...rest } = next;

								setConfiguration(rest);
								advance("configure", { configuration: rest });
							} else {
								setConfiguration(next);
							}
						}}
						onReread={(next) => {
							// Other lines skipped read other headers, another type column
							// other values: the file is read again with them, as Sure's
							// `refreshForm`. The choice is kept once the file reads with it.
							advance("configure", { configuration: next });
						}}
						reading={read.isPending}
						error={error}
						onSubmit={() => {
							// The values to map depend on the columns: chosen again after them.
							advance(mapSteps.length > 0 ? "map" : "confirm", { mappings: undefined });
						}}
					/>
				)}
				{step === "map" && preview !== null && mappings !== undefined && (
					<CsvMapStep
						key={mapKind}
						kind={mapKind}
						preview={preview}
						mappings={mappings}
						accounts={mapAccounts}
						onChange={setMappings}
						reading={read.isPending}
						error={error}
						onSubmit={() => {
							if (mapIndex < mapSteps.length - 1) {
								setMapIndex(mapIndex + 1);
							} else {
								advance("confirm");
							}
						}}
					/>
				)}
				{step === "confirm" && preview !== null && (
					<ConfirmStep
						preview={preview}
						publishing={publish.isPending}
						error={publish.error === null ? null : errorMessage(publish.error)}
						onPublish={() => {
							const posted = draft();

							if (posted !== null) {
								publish.mutate(posted, {
									onSuccess: () => setDone(true),
									// The file was read again and refused: show the lines it refuses now.
									onError: (failure) => {
										if (errorCodeOf(failure) === "CSV_IMPORT_INVALID") {
											advance("confirm");
										}
									},
								});
							}
						}}
					/>
				)}
			</div>
		</Page>
	);
}

/** Sure's `imports/_nav`: the steps in order, the current one marked, the done ones to go back to. */
function Steps({
	steps,
	current,
	onBack,
}: {
	steps: readonly Step[];
	current: Step;
	onBack: (step: Step) => void;
}) {
	const { t } = useTranslation();
	const currentIndex = steps.indexOf(current);

	return (
		<nav aria-label={t("csvImport.steps.label")}>
			<ol className="flex flex-wrap items-center justify-center gap-2 text-sm">
				{steps.map((step, index) => {
					const content = (
						<>
							<span
								className={cn(
									"inline-flex size-7 shrink-0 items-center justify-center rounded-full border",
									index === currentIndex ? "bg-muted font-medium" : "bg-card",
								)}
							>
								{index + 1}
							</span>
							<span className={cn(index === currentIndex && "font-medium")}>
								{t(`csvImport.steps.${step}`)}
							</span>
						</>
					);

					return (
						<li key={step} className="flex items-center gap-2">
							{index < currentIndex ? (
								<button
									type="button"
									className="flex items-center gap-2 rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
									onClick={() => onBack(step)}
								>
									{content}
								</button>
							) : (
								<span
									className={cn(
										"flex items-center gap-2",
										index > currentIndex && "text-muted-foreground",
									)}
									{...(index === currentIndex ? { "aria-current": "step" as const } : {})}
								>
									{content}
								</span>
							)}
							{index < steps.length - 1 && <span aria-hidden="true" className="h-px w-8 bg-line" />}
						</li>
					);
				})}
			</ol>
		</nav>
	);
}

function ErrorLine({ id, error }: { id?: string; error: string | null }) {
	return error === null ? null : (
		<p id={id} role="alert" className="text-sm text-destructive">
			{error}
		</p>
	);
}

/**
 * Sure's upload page: « Séparateur de colonnes », a trade or transaction import's account,
 * the dashed drop zone and « Téléverser le CSV », then the sample file.
 */
function UploadStep({
	type,
	file,
	separator,
	accountId,
	reading,
	error,
	onFile,
	onChoices,
	onSubmit,
}: {
	type: CsvImportType;
	file: File | null;
	separator: CsvSeparator;
	accountId: string | null;
	reading: boolean;
	error: string | null;
	onFile: (file: File | null) => void;
	onChoices: (choices: CsvImportConfigurationInput) => void;
	onSubmit: () => void;
}) {
	const { t } = useTranslation();
	const [dragging, setDragging] = useState(false);
	const offered = useImportAccounts(type, "upload");
	// Sure's `csv_template` drops its account column once the account is chosen.
	const lines = TEMPLATES[type].split("\n");
	const accountColumn = (lines[0] ?? "").split(",").indexOf("account");
	const template =
		choosesAccount(type) && accountId !== null && accountColumn !== -1
			? lines.map((line) => line.split(",").toSpliced(accountColumn, 1).join(",")).join("\n")
			: TEMPLATES[type];

	const onDrop = (event: DragEvent<HTMLLabelElement>) => {
		event.preventDefault();
		setDragging(false);
		onFile(event.dataTransfer.files[0] ?? null);
	};

	return (
		<form
			className="mx-auto flex w-full max-w-md flex-col gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			<ChoiceField
				id="csv-import-separator"
				label={t("csvImport.upload.separator")}
				value={separator}
				options={CSV_SEPARATORS.map((value) => ({
					value,
					label: t(`csvImport.upload.separators.${value === "," ? "comma" : "semicolon"}`),
				}))}
				onChange={(value) => onChoices({ separator: value, accountId })}
			/>
			{choosesAccount(type) && (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="csv-import-account">{t("csvImport.upload.account")}</Label>
					<Select
						value={accountId ?? NONE}
						onValueChange={(value) =>
							onChoices({ separator, accountId: value === NONE ? null : value })
						}
					>
						<SelectTrigger id="csv-import-account" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={NONE}>{t("csvImport.upload.multiAccount")}</SelectItem>
							{offered.map((account) => (
								<SelectItem key={account.id} value={account.id}>
									{account.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			)}
			<input
				id="csv-import-file"
				type="file"
				accept=".csv,text/csv,text/plain"
				className="peer sr-only"
				disabled={reading}
				aria-invalid={error !== null}
				{...(error === null ? {} : { "aria-describedby": "csv-import-error" })}
				onChange={(event) => {
					onFile(event.target.files?.[0] ?? null);
					// The same file chosen again must fire a change.
					event.target.value = "";
				}}
			/>
			<label
				htmlFor="csv-import-file"
				onDragOver={(event) => {
					event.preventDefault();
					setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={onDrop}
				className={cn(
					"flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-10 text-center text-sm peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
					dragging && "border-primary bg-muted",
				)}
			>
				<FileSpreadsheetIcon aria-hidden="true" className="size-6 text-muted-foreground" />
				<span>
					<span className="font-medium">{t("csvImport.upload.browse")}</span>{" "}
					<span className="text-muted-foreground">{t("csvImport.upload.browseHint")}</span>
				</span>
				{file !== null && (
					<span className="font-medium">{t("csvImport.upload.chosen", { name: file.name })}</span>
				)}
			</label>
			<Button type="submit" disabled={file === null || reading}>
				{reading ? t("csvImport.upload.reading") : t("csvImport.upload.submit")}
			</Button>
			<ErrorLine id="csv-import-error" error={error} />
			<p className="text-center text-xs text-muted-foreground">
				<a
					className="text-foreground underline"
					href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`}
					download={`${type}.csv`}
				>
					{t("csvImport.upload.sample")}
				</a>{" "}
				{t("csvImport.upload.sampleHint")}
			</p>
		</form>
	);
}

/** Sure's `imports/_table`: the file's first two rows under its headers. */
function SampleTable({ preview }: { preview: Preview }) {
	const { t } = useTranslation();

	return (
		<div className="overflow-hidden rounded-xl border bg-card">
			<Table>
				<caption className="caption-top px-4 py-2 text-left text-xs text-muted-foreground">
					{t("csvImport.configure.sampleCaption")}
				</caption>
				<TableHeader>
					<TableRow>
						{preview.headers.map((header, column) => (
							// Two headers may read alike: their place tells them apart.
							<TableHead key={column} scope="col" className="px-3">
								{header}
							</TableHead>
						))}
					</TableRow>
				</TableHeader>
				<TableBody>
					{preview.sample.map((row, index) => (
						<TableRow key={index}>
							{row.map((cell, column) => (
								<TableCell key={column} className="max-w-48 truncate px-3">
									{cell}
								</TableCell>
							))}
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

/** Each key's label in « Configurer », as Sure's transaction, account and trade forms word them. */
function useColumnLabel(type: CsvImportType) {
	const { t } = useTranslation();

	return (key: ColumnKey) => {
		const transactionKey = COLUMN_KEYS.transactions.find((known) => known === key);
		const accountKey = COLUMN_KEYS.accounts.find((known) => known === key);
		const tradeKey = COLUMN_KEYS.trades.find((known) => known === key);

		const mintKey = COLUMN_KEYS.mint.find((known) => known === key);
		const ynabKey = COLUMN_KEYS.ynab.find((known) => known === key);
		const actualKey = COLUMN_KEYS.actual.find((known) => known === key);

		if (type === "mint" && mintKey !== undefined) {
			return t(`csvImport.configure.mint.${mintKey}`);
		}

		if (type === "ynab" && ynabKey !== undefined) {
			return t(`csvImport.configure.ynab.${ynabKey}`);
		}

		if (type === "actual" && actualKey !== undefined) {
			return t(`csvImport.configure.actual.${actualKey}`);
		}

		if (type === "transactions" && transactionKey !== undefined) {
			return t(`csvImport.configure.transactions.${transactionKey}`);
		}

		if (type === "accounts" && accountKey !== undefined) {
			return t(`csvImport.configure.accounts.${accountKey}`);
		}

		return tradeKey === undefined ? key : t(`csvImport.configure.trades.${tradeKey}`);
	};
}

/**
 * Sure's « Ignorer les n premières lignes »: applied when the field is left
 * or Enter is pressed, as Sure's `change` event, since each value reads the
 * file again.
 */
function RowsToSkipField({
	value,
	onCommit,
}: {
	value: number;
	onCommit: (value: number) => void;
}) {
	const { t } = useTranslation();
	const [text, setText] = useState(String(value));
	const commit = () => {
		const next = Number.parseInt(text, 10);

		if (Number.isInteger(next) && next >= 0 && next <= MAX_ROWS_TO_SKIP && next !== value) {
			onCommit(next);
		} else {
			setText(String(value));
		}
	};

	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor="csv-import-rows-to-skip">
				{t("csvImport.configure.transactions.rowsToSkip")}
			</Label>
			<Input
				id="csv-import-rows-to-skip"
				type="number"
				inputMode="numeric"
				min={0}
				max={MAX_ROWS_TO_SKIP}
				step={1}
				value={text}
				onChange={(event) => setText(event.target.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						commit();
					}
				}}
			/>
		</div>
	);
}

/**
 * Sure's « Configurez votre importation »: a column for each key with the
 * formats for transactions, accounts and trades, a short notice for the
 * others, then the file's first rows.
 */
function ConfigureStep({
	type,
	preview,
	configuration,
	onChange,
	onReread,
	reading,
	error,
	onSubmit,
}: {
	type: CsvImportType;
	preview: Preview;
	configuration: CsvImportConfigurationInput;
	onChange: (configuration: CsvImportConfigurationInput) => void;
	/** A choice that changes what the file reads as: the lines skipped, the type column. */
	onReread: (configuration: CsvImportConfigurationInput) => void;
	reading: boolean;
	error: string | null;
	onSubmit: () => void;
}) {
	const { t } = useTranslation();
	const columnLabel = useColumnLabel(type);
	const tool = isToolImport(type) ? type : null;
	// The form whose labels « Format de date » and « Format numérique » use.
	const form = tool ?? (type === "trades" || type === "transactions" ? type : "accounts");
	const columns = configuration.columns ?? {};
	const keys: readonly ColumnKey[] =
		type === "accounts"
			? COLUMN_KEYS.accounts
			: type === "trades" || type === "transactions"
				? COLUMN_KEYS[type].filter(
						(key) => key !== "account" || (configuration.accountId ?? null) === null,
					)
				: [];
	const headers = [...new Set(preview.headers.filter((header) => header.trim() !== ""))];
	const required = REQUIRED_COLUMNS[type] ?? [];
	const strategy = configuration.amountTypeStrategy ?? "signed_amount";
	const typeColumn = columns.entity_type ?? null;
	// Sure's `custom_column_import_requires_identifier`: the column, its value and what it marks.
	const missing =
		required.some((key) => (columns[key] ?? null) === null) ||
		(type === "transactions" &&
			strategy === "custom_column" &&
			(typeColumn === null ||
				(configuration.amountTypeIdentifier ?? null) === null ||
				(configuration.amountTypeInflow ?? null) === null));
	const set = (patch: CsvImportConfigurationInput) => onChange({ ...configuration, ...patch });
	const dateUnchanged =
		preview.configuration.dateFormat === configuration.dateFormat &&
		preview.configuration.columns.date === columns.date;

	const columnField = (key: ColumnKey) => {
		const needed = required.includes(key);

		return (
			<ChoiceField
				key={key}
				id={`csv-import-column-${key}`}
				label={columnLabel(key)}
				value={columns[key] ?? NONE}
				options={[
					{
						value: NONE,
						label:
							key === "currency"
								? t("csvImport.configure.default")
								: needed
									? t("csvImport.configure.selectColumn")
									: t("csvImport.configure.leaveEmpty"),
					},
					...headers.map((header) => ({ value: header, label: header })),
				]}
				onChange={(value) => set({ columns: { ...columns, [key]: value === NONE ? null : value } })}
			/>
		);
	};

	const dateFormatField = (
		<div className="flex flex-col gap-1.5">
			<ChoiceField
				id="csv-import-date-format"
				label={t(`csvImport.configure.${form}.dateFormat`)}
				value={configuration.dateFormat ?? "%Y-%m-%d"}
				options={dateFormatsOf(type).map(([label, format]) => ({ value: format, label }))}
				onChange={(value) => set({ dateFormat: value })}
			/>
			{dateUnchanged && preview.dates !== null && (
				<p className="text-xs text-muted-foreground">
					{preview.dates.first !== null
						? t("csvImport.configure.firstDate", { date: preview.dates.first })
						: preview.dates.detected
							? t("csvImport.configure.dateUnread")
							: t("csvImport.configure.dateUndetected")}
				</p>
			)}
		</div>
	);

	const numberFormatField = (
		<ChoiceField<NumberFormat>
			id="csv-import-number-format"
			label={t(`csvImport.configure.${form}.numberFormat`)}
			value={configuration.numberFormat ?? "1,234.56"}
			options={NUMBER_FORMATS.map((value) => ({ value, label: value }))}
			onChange={(value) => set({ numberFormat: value })}
		/>
	);

	return (
		<form
			className="flex flex-col gap-6"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			<div className="mx-auto flex w-full max-w-lg flex-col gap-4">
				{type === "accounts" && (
					<>
						{keys.filter((key) => key !== "date").map(columnField)}
						<div className="grid gap-4 sm:grid-cols-2">
							{columnField("date")}
							{dateFormatField}
						</div>
						{numberFormatField}
					</>
				)}
				{type === "transactions" && (
					<>
						<RowsToSkipField
							// A refused value comes back to the one the file was read with.
							key={`${configuration.rowsToSkip ?? 0} ${reading}`}
							value={configuration.rowsToSkip ?? 0}
							onCommit={(rowsToSkip) => onReread({ ...configuration, rowsToSkip })}
						/>
						<div className="grid gap-4 sm:grid-cols-2">
							{columnField("date")}
							{dateFormatField}
						</div>
						<div className="grid gap-4 sm:grid-cols-3">
							{columnField("amount")}
							{columnField("currency")}
							{numberFormatField}
						</div>
						<ChoiceField<AmountTypeStrategy>
							id="csv-import-amount-type-strategy"
							label={t("csvImport.configure.transactions.amountTypeStrategy")}
							value={strategy}
							options={AMOUNT_TYPE_STRATEGIES.map((value) => ({
								value,
								label: t(`csvImport.configure.transactions.strategies.${value}`),
							}))}
							onChange={(value) => set({ amountTypeStrategy: value })}
						/>
						{strategy === "signed_amount" ? (
							<ChoiceField<SignageConvention>
								id="csv-import-signage"
								label={t("csvImport.configure.transactions.amountType")}
								value={configuration.signage ?? "inflows_positive"}
								options={SIGNAGE_CONVENTIONS.map((value) => ({
									value,
									label: t(`csvImport.configure.transactions.signages.${value}`),
								}))}
								onChange={(value) => set({ signage: value })}
							/>
						) : (
							<fieldset className="flex flex-col gap-4 border-l-2 pl-4">
								<legend className="sr-only">
									{t("csvImport.configure.transactions.amountTypeStrategy")}
								</legend>
								<ChoiceField
									id="csv-import-type-column"
									label={t("csvImport.configure.transactions.typeColumn")}
									value={typeColumn ?? NONE}
									options={[
										{ value: NONE, label: t("csvImport.configure.selectColumn") },
										...headers.map((header) => ({ value: header, label: header })),
									]}
									onChange={(value) =>
										onReread({
											...configuration,
											columns: { ...columns, entity_type: value === NONE ? null : value },
											amountTypeIdentifier: null,
										})
									}
								/>
								{typeColumn !== null &&
									preview.configuration.columns.entity_type === typeColumn && (
										<ChoiceField
											id="csv-import-type-value"
											label={t("csvImport.configure.transactions.typeValue")}
											value={
												configuration.amountTypeIdentifier === ""
													? BLANK
													: (configuration.amountTypeIdentifier ?? NONE)
											}
											options={[
												{ value: NONE, label: t("csvImport.configure.transactions.selectValue") },
												...preview.typeValues.map((value) => ({
													value: value === "" ? BLANK : value,
													label: value === "" ? t("csvImport.map.unassigned") : value,
												})),
											]}
											onChange={(value) =>
												set({
													amountTypeIdentifier:
														value === NONE ? null : value === BLANK ? "" : value,
												})
											}
										/>
									)}
								{(configuration.amountTypeIdentifier ?? null) !== null && (
									<ChoiceField
										id="csv-import-type-inflow"
										label={t("csvImport.configure.transactions.treatAs", {
											value:
												configuration.amountTypeIdentifier === ""
													? t("csvImport.map.unassigned")
													: configuration.amountTypeIdentifier,
										})}
										value={configuration.amountTypeInflow ?? NONE}
										options={[
											{ value: NONE, label: t("csvImport.configure.transactions.selectType") },
											...SIGNAGE_CONVENTIONS.map((value) => ({
												value,
												label: t(`csvImport.configure.transactions.inflows.${value}`),
											})),
										]}
										onChange={(value) =>
											set({
												amountTypeInflow:
													SIGNAGE_CONVENTIONS.find((known) => known === value) ?? null,
											})
										}
									/>
								)}
							</fieldset>
						)}
						{keys
							.filter((key) => ["account", "name", "category", "tags", "notes"].includes(key))
							.map(columnField)}
					</>
				)}
				{type === "trades" && (
					<>
						<div className="grid gap-4 sm:grid-cols-2">
							{columnField("date")}
							{dateFormatField}
						</div>
						{columnField("qty")}
						<ChoiceField<SignageConvention>
							id="csv-import-signage"
							label={t("csvImport.configure.trades.signage")}
							value={configuration.signage ?? "inflows_positive"}
							options={SIGNAGE_CONVENTIONS.map((value) => ({
								value,
								label: t(`csvImport.configure.trades.signages.${value}`),
							}))}
							onChange={(value) => set({ signage: value })}
						/>
						<div className="grid gap-4 sm:grid-cols-2">
							{columnField("currency")}
							{numberFormatField}
						</div>
						{keys.filter((key) => !["date", "qty", "currency"].includes(key)).map(columnField)}
					</>
				)}
				{tool !== null && (
					<>
						<div className="flex items-center gap-3 rounded-lg border bg-card p-4">
							<CircleCheckIcon aria-hidden="true" className="size-5 shrink-0 text-money-income" />
							<p className="text-sm italic">{t(`csvImport.configure.${tool}.notice`)}</p>
						</div>
						<div className="grid gap-4 sm:grid-cols-2">
							{columnField("date")}
							{dateFormatField}
						</div>
						{tool === "ynab" ? (
							<>
								<p className="text-xs text-muted-foreground">
									{t("csvImport.configure.ynab.amountNotice")}
								</p>
								{numberFormatField}
							</>
						) : (
							<div className="grid gap-4 sm:grid-cols-2">
								{columnField("amount")}
								<ChoiceField<SignageConvention>
									id="csv-import-signage"
									label={t(`csvImport.configure.${tool}.signage`)}
									value={configuration.signage ?? "inflows_positive"}
									options={SIGNAGE_CONVENTIONS.map((value) => ({
										value,
										label: t(`csvImport.configure.transactions.signages.${value}`),
									}))}
									onChange={(value) => set({ signage: value })}
								/>
							</div>
						)}
						{tool === "mint" && (
							<div className="grid gap-4 sm:grid-cols-2">
								{columnField("currency")}
								{numberFormatField}
							</div>
						)}
						{tool === "actual" && numberFormatField}
						{TOOL_FIELDS[tool].map(columnField)}
					</>
				)}
				{(type === "categories" || type === "merchants" || type === "rules") && (
					<div className="flex flex-col gap-3 text-sm text-muted-foreground">
						<p>{t(`csvImport.configure.${type}.description`)}</p>
						<p>{t(`csvImport.configure.${type}.instructions`)}</p>
					</div>
				)}
				<Button type="submit" disabled={missing || reading}>
					{reading
						? t("csvImport.configure.applying")
						: type === "transactions" ||
							  type === "accounts" ||
							  type === "trades" ||
							  isToolImport(type)
							? t("csvImport.configure.apply")
							: t(`csvImport.configure.${type}.button`)}
				</Button>
				<ErrorLine error={error} />
			</div>
			<SampleTable preview={preview} />
		</form>
	);
}

const ISSUE_CODES = CSV_ISSUE_CODES;

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

const RESOURCES = [
	"transactions",
	"accounts",
	"categories",
	"tags",
	"merchants",
	"rules",
	"trades",
] as const;

/** One refusal in French; a value it names is never an amount. */
function useIssueText() {
	const { t } = useTranslation();

	return (issue: Issue) => {
		const code = ISSUE_CODES.find((known) => known === issue.code) ?? "unknown";
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
 * Sure's « Confirmez vos données d'importation »: every refusal, the counts
 * under « Élément » and « Nombre », then « Publier l'importation », which
 * waits while a refusal stands.
 */
function ConfirmStep({
	preview,
	publishing,
	error,
	onPublish,
}: {
	preview: Preview;
	publishing: boolean;
	error: string | null;
	onPublish: () => void;
}) {
	const { t } = useTranslation();
	const issueText = useIssueText();
	const rows = Object.entries(preview.counts).flatMap(([key, count]) => {
		const resource = RESOURCES.find((known) => known === key);

		return resource === undefined || count === 0 ? [] : [{ resource, count }];
	});

	return (
		<div className="flex flex-col gap-4">
			{preview.errors.length > 0 && (
				<div
					role="alert"
					className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
				>
					<CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					<div className="flex min-w-0 flex-col gap-1">
						<p className="font-medium">{t("csvImport.confirm.errorsTitle")}</p>
						<ul className="flex flex-col gap-1">
							{preview.errors.slice(0, SHOWN_ERRORS).map((issue, index) => (
								// Two refusals may read alike: their place in the list tells them apart.
								<li key={index} className="break-words">
									{issueText(issue)}
								</li>
							))}
							{preview.errors.length > SHOWN_ERRORS && (
								<li>
									{t("csvImport.confirm.moreErrors", {
										count: preview.errors.length - SHOWN_ERRORS,
									})}
								</li>
							)}
						</ul>
					</div>
				</div>
			)}
			<div className="overflow-hidden rounded-xl border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead scope="col" className="px-4">
								{t("csvImport.confirm.item")}
							</TableHead>
							<TableHead scope="col" className="px-4 text-right">
								{t("csvImport.confirm.count")}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.length === 0 ? (
							<TableRow>
								<TableCell colSpan={2} className="px-4 py-6 text-center text-muted-foreground">
									{t("csvImport.confirm.empty")}
								</TableCell>
							</TableRow>
						) : (
							rows.map(({ resource, count }) => (
								<TableRow key={resource}>
									<TableCell className="px-4">{t(`csvImport.resources.${resource}`)}</TableCell>
									<TableCell className="px-4 text-right tabular-nums">{count}</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>
			{rows.length === 0 ? (
				<Button asChild variant="secondary">
					<Link to="/settings/imports">{t("csvImport.confirm.back")}</Link>
				</Button>
			) : (
				<Button
					type="button"
					disabled={preview.errors.length > 0 || publishing}
					onClick={onPublish}
				>
					{publishing ? t("csvImport.confirm.publishing") : t("csvImport.confirm.publish")}
				</Button>
			)}
			<ErrorLine error={error} />
		</div>
	);
}
