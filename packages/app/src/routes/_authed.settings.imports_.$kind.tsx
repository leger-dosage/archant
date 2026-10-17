import type { CsvImportDraft, CsvImportPreviewData } from "@/hooks/useCsvImport";
import type { DragEvent, ReactNode } from "react";

import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { CircleAlertIcon, CircleCheckIcon, FileSpreadsheetIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
	ColumnKey,
	CsvImportConfigurationInput,
	CsvImportMappingsInput,
	CsvImportType,
	CsvSeparator,
	NumberFormat,
	SignageConvention,
} from "@archant/api/schemas/csv-imports";
import {
	COLUMN_KEYS,
	CREATE_NEW_ACCOUNT,
	CSV_IMPORT_TYPES,
	CSV_ISSUE_CODES,
	CSV_SEPARATORS,
	NUMBER_FORMATS,
	SIGNAGE_CONVENTIONS,
	dateFormatsOf,
} from "@archant/api/schemas/csv-imports";
import type { AccountSubtype, AccountType } from "@archant/data/account-types";
import {
	ACCOUNT_TYPES,
	ACCOUNT_TYPE_IDS,
	isSubtypeOf,
	supportsTrades,
} from "@archant/data/account-types";

import { AccountSubtypeSelect } from "@/components/AccountSubtypeSelect";
import { ChoiceField } from "@/components/ChoiceField";
import { Page } from "@/components/Page";
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
type AccountTypeChoice = Preview["mappings"]["accountTypes"][number];
type AccountChoice = Preview["mappings"]["accounts"][number];

/** A file broken on every line would otherwise list 10,000 of them. */
const SHOWN_ERRORS = 50;

/** No column chosen, « Laisser vide »: a value no header takes. */
const NONE = "__none__";

/** Sure's `required_column_keys` of the forms that map columns. */
const REQUIRED_COLUMNS: Partial<Record<CsvImportType, readonly ColumnKey[]>> = {
	accounts: ["name", "amount"],
	trades: ["date", "ticker", "qty", "price"],
};

/** Sure's `csv_template` of each import, offered as « Téléchargez un exemple de fichier CSV ». */
const TEMPLATES: Record<CsvImportType, string> = {
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
};

/** The choices the preview read the file with, kept for the next post. */
function configurationOf(resolved: Preview["configuration"]): CsvImportConfigurationInput {
	const columns: Partial<Record<ColumnKey, string | null>> = {};

	for (const [key, value] of Object.entries(resolved.columns)) {
		const known = [...COLUMN_KEYS.accounts, ...COLUMN_KEYS.trades].find((column) => column === key);

		if (known !== undefined && value !== undefined) {
			columns[known] = value;
		}
	}

	return { ...resolved, columns };
}

/** Whether `type` has Sure's « Mapper » step: account types, or the accounts of a multi-account trade file. */
const mapsValues = (type: CsvImportType, accountId: string | null | undefined) =>
	type === "accounts" || (type === "trades" && (accountId ?? null) === null);

/** The accounts a trade may go to, as Sure's `supports_trades?`. */
function useTradingAccounts() {
	const accounts = useAccounts({ select: accountsByName });

	return (accounts.data ?? []).filter((account) => account.active && supportsTrades(account));
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
	const [file, setFile] = useState<File | null>(null);
	const [configuration, setConfiguration] = useState<CsvImportConfigurationInput>({});
	const [mappings, setMappings] = useState<CsvImportMappingsInput | undefined>(undefined);
	const [preview, setPreview] = useState<Preview | null>(null);
	const [done, setDone] = useState(false);
	const read = useCsvImportPreview();
	const publish = usePublishCsvImport();

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
				});
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

	const steps: Step[] = mapsValues(type, configuration.accountId)
		? ["upload", "configure", "map", "confirm"]
		: ["upload", "configure", "confirm"];
	const error = read.error === null ? null : errorMessage(read.error);
	const stepTitles: Record<Step, string> = {
		upload: t("csvImport.upload.title"),
		configure: t("csvImport.configure.title"),
		map:
			type === "accounts" ? t("csvImport.map.accountTypesTitle") : t("csvImport.map.accountsTitle"),
		confirm: t("csvImport.confirm.title"),
	};
	const stepDescriptions: Record<Step, string> = {
		upload: t("csvImport.upload.description"),
		configure: t("csvImport.configure.description"),
		map:
			type === "accounts"
				? t("csvImport.map.accountTypesDescription")
				: t("csvImport.map.accountsDescription"),
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
							// Another date column reads other dates: the server guesses its
							// format again, as Sure's `detect_date_format`.
							if (next.columns?.date !== configuration.columns?.date) {
								const { dateFormat: _guessedAgain, ...rest } = next;

								setConfiguration(rest);
							} else {
								setConfiguration(next);
							}
						}}
						reading={read.isPending}
						error={error}
						onSubmit={() => {
							// The values to map depend on the columns: chosen again after them.
							advance(mapsValues(type, configuration.accountId) ? "map" : "confirm", {
								mappings: undefined,
							});
						}}
					/>
				)}
				{step === "map" && preview !== null && mappings !== undefined && (
					<MapStep
						type={type}
						preview={preview}
						mappings={mappings}
						onChange={setMappings}
						reading={read.isPending}
						error={error}
						onSubmit={() => {
							advance("confirm");
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
 * Sure's upload page: « Séparateur de colonnes », a trade import's account,
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
	const trading = useTradingAccounts();
	const template =
		type === "trades" && accountId !== null
			? TEMPLATES.trades
					.split("\n")
					.map((line) => line.split(",").toSpliced(6, 1).join(","))
					.join("\n")
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
			{type === "trades" && (
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
							{trading.map((account) => (
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

/** Each key's label in « Configurer », as Sure's account and trade forms word them. */
function useColumnLabel(type: CsvImportType) {
	const { t } = useTranslation();

	return (key: ColumnKey) => {
		const accountKey = COLUMN_KEYS.accounts.find((known) => known === key);
		const tradeKey = COLUMN_KEYS.trades.find((known) => known === key);

		if (type === "accounts" && accountKey !== undefined) {
			return t(`csvImport.configure.accounts.${accountKey}`);
		}

		return tradeKey === undefined ? key : t(`csvImport.configure.trades.${tradeKey}`);
	};
}

/**
 * Sure's « Configurez votre importation »: a column for each key with the
 * formats for accounts and trades, a short notice for the others, then the
 * file's first rows.
 */
function ConfigureStep({
	type,
	preview,
	configuration,
	onChange,
	reading,
	error,
	onSubmit,
}: {
	type: CsvImportType;
	preview: Preview;
	configuration: CsvImportConfigurationInput;
	onChange: (configuration: CsvImportConfigurationInput) => void;
	reading: boolean;
	error: string | null;
	onSubmit: () => void;
}) {
	const { t } = useTranslation();
	const columnLabel = useColumnLabel(type);
	const columns = configuration.columns ?? {};
	const keys: readonly ColumnKey[] =
		type === "accounts"
			? COLUMN_KEYS.accounts
			: type === "trades"
				? COLUMN_KEYS.trades.filter(
						(key) => key !== "account" || (configuration.accountId ?? null) === null,
					)
				: [];
	const headers = [...new Set(preview.headers.filter((header) => header.trim() !== ""))];
	const required = REQUIRED_COLUMNS[type] ?? [];
	const missing = required.some((key) => (columns[key] ?? null) === null);
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
				label={
					type === "accounts"
						? t("csvImport.configure.accounts.dateFormat")
						: t("csvImport.configure.trades.dateFormat")
				}
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
			label={
				type === "accounts"
					? t("csvImport.configure.accounts.numberFormat")
					: t("csvImport.configure.trades.numberFormat")
			}
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
				{(type === "categories" || type === "merchants" || type === "rules") && (
					<div className="flex flex-col gap-3 text-sm text-muted-foreground">
						<p>{t(`csvImport.configure.${type}.description`)}</p>
						<p>{t(`csvImport.configure.${type}.instructions`)}</p>
					</div>
				)}
				<Button type="submit" disabled={missing || reading}>
					{reading
						? t("csvImport.configure.applying")
						: type === "accounts" || type === "trades"
							? t("csvImport.configure.apply")
							: t(`csvImport.configure.${type}.button`)}
				</Button>
				<ErrorLine error={error} />
			</div>
			<SampleTable preview={preview} />
		</form>
	);
}

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

/**
 * Sure's « Attribuez vos types de comptes » and « Attribuez vos comptes »:
 * each value of the file mapped to an Archant type, a loan's or a property's
 * subtype included, or to an account that takes trades or a new one.
 * « Suivant » waits for every value to be mapped, as Sure's `publishable?`.
 */
function MapStep({
	type,
	preview,
	mappings,
	onChange,
	reading,
	error,
	onSubmit,
}: {
	type: CsvImportType;
	preview: Preview;
	mappings: CsvImportMappingsInput;
	onChange: (mappings: CsvImportMappingsInput) => void;
	reading: boolean;
	error: string | null;
	onSubmit: () => void;
}) {
	const { t } = useTranslation();
	const trading = useTradingAccounts();
	const counts = new Map(
		[...preview.mappings.accountTypes, ...preview.mappings.accounts].map((mapping) => [
			mapping.key,
			mapping.count,
		]),
	);
	const accountTypes = mappings.accountTypes ?? [];
	const accounts = mappings.accounts ?? [];
	const keyLabel = (key: string) => (key === "" ? t("csvImport.map.unassigned") : key);
	const complete =
		type === "accounts"
			? accountTypes.every(mappedType)
			: accounts.every((mapping) => mapping.value !== null);

	const setType = (key: string, patch: Partial<AccountTypeChoice>) =>
		onChange({
			...mappings,
			accountTypes: accountTypes.map((mapping) =>
				mapping.key === key ? { ...mapping, ...patch } : mapping,
			),
		});
	const setAccount = (key: string, value: AccountChoice["value"]) =>
		onChange({
			...mappings,
			accounts: accounts.map((mapping) => (mapping.key === key ? { ...mapping, value } : mapping)),
		});

	return (
		<form
			className="flex flex-col gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			<Section
				title={t("csvImport.map.csvColumn", {
					mapping:
						type === "accounts" ? t("csvImport.map.accountType") : t("csvImport.map.account"),
				})}
			>
				<ul className="divide-y divide-line">
					{type === "accounts"
						? accountTypes.map((mapping, index) => (
								<MappingRow
									key={mapping.key}
									label={keyLabel(mapping.key)}
									count={counts.get(mapping.key) ?? 0}
								>
									<div className="flex flex-col gap-1.5">
										<Label htmlFor={`csv-import-type-${index}`}>
											{t("csvImport.map.archantColumn", {
												mapping: t("csvImport.map.accountType"),
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
						: accounts.map((mapping, index) => (
								<MappingRow
									key={mapping.key}
									label={keyLabel(mapping.key)}
									count={counts.get(mapping.key) ?? 0}
								>
									<div className="flex flex-col gap-1.5">
										<Label htmlFor={`csv-import-account-${index}`}>
											{t("csvImport.map.archantColumn", { mapping: t("csvImport.map.account") })}
										</Label>
										<Select
											value={mapping.value ?? ""}
											onValueChange={(value) => setAccount(mapping.key, value)}
										>
											<SelectTrigger
												id={`csv-import-account-${index}`}
												className="w-full"
												aria-invalid={mapping.value === null}
											>
												<SelectValue placeholder={t("csvImport.map.select")} />
											</SelectTrigger>
											<SelectContent>
												{mapping.key.trim() !== "" && (
													<SelectItem value={CREATE_NEW_ACCOUNT}>
														{t("csvImport.map.createNew")}
													</SelectItem>
												)}
												{trading.map((account) => (
													<SelectItem key={account.id} value={account.id}>
														{account.name}
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
			<ErrorLine error={error} />
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

const RESOURCES = ["accounts", "categories", "merchants", "rules", "trades"] as const;

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
