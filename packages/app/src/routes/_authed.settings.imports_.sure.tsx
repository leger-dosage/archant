import type { SurePreflightData } from "@/hooks/useSureImport";
import type { DragEvent } from "react";

import { Link, createFileRoute } from "@tanstack/react-router";
import {
	CircleAlertIcon,
	CircleCheckIcon,
	FileBracesIcon,
	InfoIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { Page } from "@/components/Page";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { useStartSureImport, useSurePreflight } from "@/hooks/useSureImport";
import { errorMessage } from "@/lib/error-toast";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/settings/imports_/sure")({
	component: SureImportPage,
});

type Preflight = SurePreflightData;
type Issue = Preflight["errors"][number];
type CountKey = keyof Preflight["counts"];

/** Sure's `IMPORTABLE_NDJSON_TYPES` order, which « Résumé de l'importation » follows. */
const RESOURCES: readonly CountKey[] = [
	"accounts",
	"balances",
	"categories",
	"tags",
	"merchants",
	"recurring_transactions",
	"transactions",
	"transfers",
	"rejected_transfers",
	"trades",
	"holdings",
	"valuations",
	"budgets",
	"budget_categories",
	"rules",
];

/** A file broken on every line would otherwise list 100,000 of them. */
const SHOWN_ERRORS = 50;

const ISSUE_CODES = [
	"invalid_json",
	"invalid_ndjson_record",
	"unsupported_record_type",
	"duplicate_taxonomy_name",
	"duplicate_source_id",
	"missing_required_fields",
	"invalid_split_lines",
	"invalid_split_line",
	"split_amount_mismatch",
	"missing_reference",
	"duplicate_valuation",
	"invalid_import_record",
] as const;

/** One finding of the preflight, in French; an amount is never among its values. */
function useIssueText() {
	const { t } = useTranslation();

	return (issue: Issue) => {
		const code = ISSUE_CODES.find((known) => known === issue.code) ?? "unknown";
		const param = (name: string) => issue.params[name] ?? "";
		const values = {
			line: param("line"),
			type: param("type"),
			field: param("field"),
			fields: param("fields"),
			value: param("value"),
			name: param("name"),
			lines: param("lines"),
			kind: param("kind"),
			id: param("id"),
			index: param("index"),
			account: param("account"),
			date: param("date"),
			first: param("first"),
		};

		if (code === "invalid_import_record" && issue.params["value"] === undefined) {
			return t("sureImport.issues.invalid_import_record_unnamed", values);
		}

		return t(`sureImport.issues.${code}`, values);
	};
}

/** How many warnings of `code` the preflight gave, as Sure's rollups count them. */
const countOf = (preflight: Preflight, code: string) =>
	preflight.warnings.filter((warning) => warning.code === code).length;

/**
 * « Importer depuis l'export », then « Confirmer votre importation », then
 * « Importation réussie », as Sure's upload, confirm and success pages. The
 * page keeps the chosen file and sends it twice, once to read it and once to
 * import it: nothing is stored in between.
 */
function SureImportPage() {
	const { t } = useTranslation();
	const [file, setFile] = useState<File | null>(null);
	const [preflight, setPreflight] = useState<Preflight | null>(null);
	const [done, setDone] = useState(false);
	const read = useSurePreflight();
	const start = useStartSureImport();

	const title = done
		? t("sureImport.success.title")
		: preflight === null
			? t("sureImport.upload.title")
			: t("sureImport.confirm.title");

	useEffect(() => {
		document.title = t("app.pageTitle", { page: title, app: t("app.name") });
	}, [t, title]);

	if (done) {
		return (
			<Page centred title={title} description={t("sureImport.success.description")}>
				<div className="flex flex-col items-center gap-4 py-6">
					<CircleCheckIcon aria-hidden="true" className="size-10 text-money-income" />
					<Button asChild>
						<Link to="/">{t("sureImport.success.dashboard")}</Link>
					</Button>
				</div>
			</Page>
		);
	}

	if (preflight === null || file === null) {
		return (
			<Page centred title={title} description={t("sureImport.upload.description")}>
				<UploadForm
					file={file}
					onFile={(chosen) => {
						read.reset();
						setFile(chosen);
					}}
					reading={read.isPending}
					error={read.error === null ? null : errorMessage(read.error)}
					onSubmit={(chosen) => {
						read.mutate(chosen, { onSuccess: setPreflight });
					}}
				/>
			</Page>
		);
	}

	return (
		<Page centred title={title} description={t("sureImport.confirm.description")}>
			<Confirmation
				preflight={preflight}
				starting={start.isPending}
				error={start.error === null ? null : errorMessage(start.error)}
				onStart={() => {
					start.mutate(file, { onSuccess: () => setDone(true) });
				}}
				onCancel={() => {
					start.reset();
					setPreflight(null);
					setFile(null);
				}}
			/>
		</Page>
	);
}

/** Sure's upload page: a dashed drop zone, its hint, and « Téléverser le NDJSON ». */
function UploadForm({
	file,
	onFile,
	reading,
	error,
	onSubmit,
}: {
	file: File | null;
	onFile: (file: File | null) => void;
	reading: boolean;
	error: string | null;
	onSubmit: (file: File) => void;
}) {
	const { t } = useTranslation();
	const [dragging, setDragging] = useState(false);

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

				if (file !== null) {
					onSubmit(file);
				}
			}}
		>
			<input
				id="sure-import-file"
				type="file"
				accept=".ndjson,.json"
				className="peer sr-only"
				disabled={reading}
				aria-invalid={error !== null}
				{...(error === null ? {} : { "aria-describedby": "sure-import-error" })}
				onChange={(event) => {
					onFile(event.target.files?.[0] ?? null);
					// The same file chosen again must fire a change.
					event.target.value = "";
				}}
			/>
			<label
				htmlFor="sure-import-file"
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
				<FileBracesIcon aria-hidden="true" className="size-6 text-muted-foreground" />
				<span>
					<span className="font-medium">{t("sureImport.upload.browse")}</span>{" "}
					<span className="text-muted-foreground">{t("sureImport.upload.browseHint")}</span>
				</span>
				{file !== null && (
					<span className="font-medium">{t("sureImport.upload.chosen", { name: file.name })}</span>
				)}
			</label>
			<Button type="submit" disabled={file === null || reading}>
				{reading ? t("sureImport.upload.reading") : t("sureImport.upload.submit")}
			</Button>
			{error !== null && (
				<p id="sure-import-error" role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
			<p className="text-center text-xs text-muted-foreground">
				<Trans i18nKey="sureImport.upload.hint" components={{ strong: <strong /> }} />
			</p>
		</form>
	);
}

/** Sure's warning rollups: missing merchants and skipped series, then names reused. */
function Rollups({ preflight }: { preflight: Preflight }) {
	const { t } = useTranslation();
	const missing = countOf(preflight, "skipped_missing_merchant_reference");
	const skipped = countOf(preflight, "skipped_unnamed_recurring");
	const reused = countOf(preflight, "existing_taxonomy_collision");

	return (
		<>
			{(missing > 0 || skipped > 0) && (
				<div
					role="status"
					className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning"
				>
					<TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					<div className="flex flex-col gap-1">
						<p className="font-medium">{t("sureImport.warnings.missingMerchantTitle")}</p>
						<p>
							{[
								missing > 0 ? t("sureImport.warnings.missingMerchant", { count: missing }) : null,
								skipped > 0 ? t("sureImport.warnings.skippedRecurring", { count: skipped }) : null,
							]
								.filter((text) => text !== null)
								.join(" ")}
						</p>
					</div>
				</div>
			)}
			{reused > 0 && (
				<div role="status" className="flex gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
					<InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					<div className="flex flex-col gap-1">
						<p className="font-medium">{t("sureImport.warnings.reusedTitle")}</p>
						<p className="text-muted-foreground">
							{t("sureImport.warnings.reused", { count: reused })}
						</p>
					</div>
				</div>
			)}
		</>
	);
}

/**
 * Sure's confirm page: « Résumé de l'importation », a row per type found,
 * each error, the warnings rolled up, « Démarrer l'importation » and
 * « Annuler ». An error leaves nothing to start.
 */
function Confirmation({
	preflight,
	starting,
	error,
	onStart,
	onCancel,
}: {
	preflight: Preflight;
	starting: boolean;
	error: string | null;
	onStart: () => void;
	onCancel: () => void;
}) {
	const { t } = useTranslation();
	const issueText = useIssueText();
	const rows = RESOURCES.filter((key) => preflight.counts[key] > 0);
	const blocked = preflight.errors.length > 0 || rows.length === 0;

	return (
		<div className="mx-auto flex w-full max-w-md flex-col gap-4">
			{preflight.errors.length > 0 && (
				<div
					role="alert"
					className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
				>
					<CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					<div className="flex min-w-0 flex-col gap-1">
						<p className="font-medium">{t("sureImport.confirm.errorsTitle")}</p>
						<ul className="flex flex-col gap-1">
							{preflight.errors.slice(0, SHOWN_ERRORS).map((issue, index) => (
								// Two findings may read alike: their place in the list tells them apart.
								<li key={index} className="break-words">
									{issueText(issue)}
								</li>
							))}
							{preflight.errors.length > SHOWN_ERRORS && (
								<li>
									{t("sureImport.confirm.moreErrors", {
										count: preflight.errors.length - SHOWN_ERRORS,
									})}
								</li>
							)}
						</ul>
					</div>
				</div>
			)}
			<Rollups preflight={preflight} />
			<Section title={t("sureImport.confirm.summary")}>
				{rows.length === 0 ? (
					<p className="px-4 py-6 text-center text-sm text-muted-foreground">
						{t("sureImport.confirm.empty")}
					</p>
				) : (
					<ul className="divide-y divide-line">
						{rows.map((key) => (
							<li key={key} className="flex items-center justify-between px-4 py-3 text-sm">
								<span>{t(`sureImport.resources.${key}`)}</span>
								<span className="font-medium tabular-nums">{preflight.counts[key]}</span>
							</li>
						))}
					</ul>
				)}
			</Section>
			<div className="flex flex-col gap-2">
				<Button type="button" disabled={blocked || starting} onClick={onStart}>
					{starting ? t("sureImport.confirm.starting") : t("sureImport.confirm.start")}
				</Button>
				<Button type="button" variant="ghost" disabled={starting} onClick={onCancel}>
					{t("sureImport.confirm.cancel")}
				</Button>
				{error !== null && (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				)}
			</div>
		</div>
	);
}
