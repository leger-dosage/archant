import type { RuleData, RuleRunData } from "@/hooks/useRules";
import type { SummaryNames } from "@/lib/rule-summary";

import { createFileRoute } from "@tanstack/react-router";
import { EllipsisIcon, FunnelIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";

import { DEFAULT_CURRENCY, isCurrencyCode } from "@archant/data/money";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Page } from "@/components/Page";
import { Pagination } from "@/components/Pagination";
import { RuleDialog } from "@/components/RuleDialog";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useAccounts } from "@/hooks/useAccounts";
import { useCategories } from "@/hooks/useCategories";
import { pageCountOf, useClampPage } from "@/hooks/useClampPage";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useMerchants } from "@/hooks/useMerchants";
import {
	useApplyRules,
	useDeleteRule,
	useFetchRulePreview,
	useRuleRuns,
	useRules,
	useSetRuleEnabled,
} from "@/hooks/useRules";
import { useTags } from "@/hooks/useTags";
import { errorCodeOf } from "@/lib/api";
import { formatShortDate } from "@/lib/balance-change";
import { toIsoDate } from "@/lib/dates";
import { showErrorToast } from "@/lib/error-toast";
import { pageSearch } from "@/lib/page-search";
import { ruleSummary } from "@/lib/rule-summary";

// Absent means the first page of runs; a value from an old or hand-edited
// link that no longer exists falls back to it rather than failing the page.
const searchSchema = z.object({
	runsPage: z.number().int().min(1).optional().catch(undefined),
});

export const Route = createFileRoute("/_authed/rules")({
	validateSearch: searchSchema,
	component: RulesPage,
});

// Below this width a condition row, its operator and its value do not fit
// (EXPERIENCE.md): the page says so instead, as the import dialog does.
const DESKTOP_QUERY = "(min-width: 768px)";

/**
 * The dialog open, kept while it closes so its content does not vanish
 * mid-animation. An id, not the rule: the dialog reads it from the current
 * list, so a rule edited elsewhere since opening is fresh.
 */
type Opened = { action: "add" } | { action: "edit" | "delete"; id: string };

/**
 * An application waiting for its confirmation: one rule, or every enabled
 * one for a `null` id, with the count its preview read.
 */
type Applying = {
	ruleId: string | null;
	name: string | null;
	changed: number;
	/** Offered right after a save, where declining postpones: « Plus tard ». */
	afterSave: boolean;
};

// The API stores instants; the user reads the day it ran, in their zone.
const dayOf = (epochMs: number) => formatShortDate(toIsoDate(new Date(epochMs)));

function RuleRow({
	rule,
	summary,
	onEdit,
	onApply,
	applyDisabled,
	onDelete,
}: {
	rule: RuleData;
	summary: string;
	onEdit: () => void;
	onApply: () => void;
	/** A preview is being read: a second one would replace its dialog. */
	applyDisabled: boolean;
	onDelete: () => void;
}) {
	const { t } = useTranslation();
	const setEnabled = useSetRuleEnabled();
	const title = rule.name ?? summary;

	return (
		<div className="flex min-h-14 items-center gap-3 py-2">
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="truncate">{title}</span>
				{rule.name !== null && (
					<span className="truncate text-sm text-muted-foreground">{summary}</span>
				)}
			</div>
			<Switch
				checked={rule.enabled}
				disabled={setEnabled.isPending}
				aria-label={t("rules.toggle", { name: title })}
				onCheckedChange={(enabled) =>
					setEnabled.mutate(
						{ id: rule.id, enabled },
						{
							onSuccess: () => toast.success(t(enabled ? "rules.enabled" : "rules.disabled")),
							onError: (error) => showErrorToast(errorCodeOf(error)),
						},
					)
				}
			/>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon" aria-label={t("rules.actions", { name: title })}>
						<EllipsisIcon />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onSelect={onEdit}>{t("rules.edit")}</DropdownMenuItem>
					<DropdownMenuItem disabled={applyDisabled} onSelect={onApply}>
						{t("rules.apply.one")}
					</DropdownMenuItem>
					<DropdownMenuItem variant="destructive" onSelect={onDelete}>
						{t("rules.delete")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

/**
 * The recorded applications, the latest first: the day, the rule as it was
 * then, labelled with today's names, and its counts.
 */
function RuleRuns({ page, names }: { page: number; names: SummaryNames }) {
	const { t } = useTranslation();
	const runs = useRuleRuns(page);
	const navigate = Route.useNavigate();
	const data = runs.data;
	const pageCount = pageCountOf(data);
	const goTo = useCallback(
		(lastPage: number) =>
			void navigate({
				to: "/rules",
				search: (previous) => ({ ...previous, ...pageSearch("runsPage", lastPage) }),
				replace: true,
			}),
		[navigate],
	);

	useClampPage(page, runs.isPlaceholderData ? undefined : data, goTo);

	const labelOf = (run: RuleRunData) => run.rule.name ?? ruleSummary(run.rule, names, t);

	return (
		<section aria-labelledby="rule-runs" className="flex max-w-3xl flex-col gap-3">
			<h2 id="rule-runs" className="text-lg font-semibold">
				{t("rules.runs.title")}
			</h2>

			{runs.isPending && <Skeleton className="h-9 w-full" />}

			{runs.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-8">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(runs.error)}`)}</p>
					<Button variant="outline" onClick={() => void runs.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{data !== undefined && data.total === 0 && (
				<p className="text-sm text-muted-foreground">{t("rules.runs.empty")}</p>
			)}

			{data !== undefined && data.total > 0 && (
				<Table aria-labelledby="rule-runs">
					<TableHeader>
						<TableRow>
							<TableHead scope="col">{t("rules.runs.columns.date")}</TableHead>
							<TableHead scope="col">{t("rules.runs.columns.rule")}</TableHead>
							<TableHead scope="col" className="text-right">
								{t("rules.runs.columns.matched")}
							</TableHead>
							<TableHead scope="col" className="text-right">
								{t("rules.runs.columns.changed")}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.items.map((run) => (
							<TableRow key={run.id} className="h-9">
								<TableCell className="whitespace-nowrap">{dayOf(run.executedAt)}</TableCell>
								<TableCell className="max-w-96 truncate">{labelOf(run)}</TableCell>
								<TableCell className="text-right tabular-nums">{run.matchedCount}</TableCell>
								<TableCell className="text-right tabular-nums">{run.changedCount}</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}

			{data !== undefined && pageCount > 1 && (
				<Pagination
					target={{ to: "/rules", param: "runsPage" }}
					page={page}
					pageCount={pageCount}
					label={t("rules.runs.paginationLabel")}
				/>
			)}
		</section>
	);
}

/**
 * The rules, in the order they apply, each with its switch and its menu. New
 * transactions go through the enabled ones as they arrive; existing ones
 * only through an application the user confirms, listed under the rules.
 */
function RulesPage() {
	const { t } = useTranslation();
	const { runsPage = 1 } = Route.useSearch();
	const desktop = useMediaQuery(DESKTOP_QUERY);
	const rules = useRules();
	const accounts = useAccounts();
	const categories = useCategories();
	const merchants = useMerchants();
	const tags = useTags();
	const deleteRule = useDeleteRule();
	const fetchPreview = useFetchRulePreview();
	const applyRules = useApplyRules();
	const [opened, setOpened] = useState<Opened | null>(null);
	const [open, setOpen] = useState(false);
	// Kept while the confirmation closes, so its count does not change mid-animation.
	const [applying, setApplying] = useState<Applying | null>(null);
	const [applyOpen, setApplyOpen] = useState(false);
	const [previewing, setPreviewing] = useState(false);
	// The state lags a render behind; this guard holds from the first click.
	const previewPending = useRef(false);
	const list = rules.data ?? [];
	const accountList = useMemo(
		() => (accounts.data?.groups ?? []).flatMap((group) => group.accounts),
		[accounts.data],
	);
	const options = useMemo(
		() => ({
			accounts: accountList,
			categories: categories.data ?? [],
			merchants: merchants.data ?? [],
			tags: tags.data ?? [],
		}),
		[accountList, categories.data, merchants.data, tags.data],
	);
	const reported = accounts.data?.reportingCurrency ?? DEFAULT_CURRENCY;
	const reportingCurrency = isCurrencyCode(reported) ? reported : DEFAULT_CURRENCY;
	const names: SummaryNames = useMemo(
		() => ({
			accounts: new Map(accountList.map((account) => [account.id, account.name])),
			categories: new Map(options.categories.map((category) => [category.id, category.name])),
			merchants: new Map(options.merchants.map((merchant) => [merchant.id, merchant.name])),
			tags: new Map(options.tags.map((tag) => [tag.id, tag.name])),
			reportingCurrency,
		}),
		[accountList, options, reportingCurrency],
	);
	const rule =
		opened === null || opened.action === "add"
			? undefined
			: list.find((candidate) => candidate.id === opened.id);
	// Deleted elsewhere since it opened: nothing left to act on.
	const gone = opened !== null && opened.action !== "add" && rule === undefined;
	const queries = [rules, accounts, categories, merchants, tags];
	const ready = queries.every((query) => query.data !== undefined);
	const failed = queries.find((query) => query.isError);

	useEffect(() => {
		if (gone) {
			setOpen(false);
			setOpened(null);
		}
	}, [gone]);

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("rules.title"), app: t("app.name") });
	}, [t]);

	const openDialog = (next: Opened) => {
		setOpened(next);
		setOpen(true);
	};

	const summaryOf = (item: RuleData) => ruleSummary(item, names, t);
	const hasEnabled = list.some((item) => item.enabled);

	/** Reads the count, then asks: a rule's own, or every enabled rule's for `null`. */
	const askToApply = async (item: RuleData | null, afterSave = false) => {
		if (previewPending.current) {
			return;
		}

		previewPending.current = true;
		setPreviewing(true);

		try {
			const { changed } = await fetchPreview(item?.id ?? null);
			setApplying({
				ruleId: item?.id ?? null,
				name: item === null ? null : (item.name ?? summaryOf(item)),
				changed,
				afterSave,
			});
			setApplyOpen(true);
		} catch (error) {
			showErrorToast(errorCodeOf(error));
		} finally {
			previewPending.current = false;
			setPreviewing(false);
		}
	};

	return (
		<Page
			icon={FunnelIcon}
			title={t("rules.title")}
			actions={
				desktop ? (
					<>
						<Button
							variant="outline"
							disabled={!hasEnabled || previewing}
							onClick={() => void askToApply(null)}
						>
							{t("rules.apply.all")}
						</Button>
						<Button onClick={() => openDialog({ action: "add" })}>{t("rules.add")}</Button>
					</>
				) : undefined
			}
		>
			<p className="max-w-2xl text-sm text-muted-foreground">{t("rules.description")}</p>

			{!desktop && (
				<p className="rounded-lg border border-dashed p-8 text-muted-foreground">
					{t("rules.mobile")}
				</p>
			)}

			{desktop && !ready && failed === undefined && (
				<div className="flex max-w-3xl flex-col gap-2">
					<Skeleton className="h-14 w-full" />
					<Skeleton className="h-14 w-full" />
				</div>
			)}

			{desktop && failed !== undefined && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-8">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(failed.error)}`)}</p>
					<Button
						variant="outline"
						onClick={() => {
							for (const query of queries) {
								void query.refetch();
							}
						}}
					>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{desktop &&
				ready &&
				failed === undefined &&
				(list.length === 0 ? (
					<p className="text-sm text-muted-foreground">{t("rules.empty")}</p>
				) : (
					<ul aria-label={t("rules.title")} className="max-w-3xl divide-y">
						{list.map((item) => (
							<li key={item.id}>
								<RuleRow
									rule={item}
									summary={summaryOf(item)}
									onEdit={() => openDialog({ action: "edit", id: item.id })}
									onApply={() => void askToApply(item)}
									applyDisabled={previewing}
									onDelete={() => openDialog({ action: "delete", id: item.id })}
								/>
							</li>
						))}
					</ul>
				))}

			{desktop && ready && (opened?.action === "add" || opened?.action === "edit") && (
				<RuleDialog
					open={open}
					onOpenChange={setOpen}
					rule={rule}
					options={options}
					reportingCurrency={reportingCurrency}
					onSaved={(saved) => void askToApply(saved, true)}
				/>
			)}
			{desktop && ready && failed === undefined && <RuleRuns page={runsPage} names={names} />}
			{applying !== null && (
				<ConfirmDialog
					open={applyOpen}
					onOpenChange={(next) => {
						// The application commits whatever the dialog does; it closes once it has.
						if (!next && !applyRules.isPending) {
							setApplyOpen(false);
						}
					}}
					title={
						applying.changed === 0
							? t("rules.apply.nothing")
							: t("rules.apply.count", { count: applying.changed })
					}
					description={
						applying.name === null
							? t("rules.apply.descriptionAll")
							: t("rules.apply.description", { name: applying.name })
					}
					confirmLabel={t("rules.apply.confirm")}
					cancelLabel={applying.afterSave ? t("rules.apply.later") : undefined}
					pending={applyRules.isPending}
					onConfirm={() =>
						applyRules.mutate(applying.ruleId, {
							// What was written, each row once: the runs' own counts would add
							// up a row two rules both change.
							onSuccess: ({ changed }) => {
								toast.success(
									changed === 0
										? t("rules.apply.doneNothing")
										: t("rules.apply.done", { count: changed }),
								);
								setApplyOpen(false);
							},
							onError: (error) => {
								showErrorToast(errorCodeOf(error));
								setApplyOpen(false);
							},
						})
					}
				/>
			)}
			{opened?.action === "delete" && rule !== undefined && (
				<ConfirmDialog
					open={open}
					onOpenChange={setOpen}
					title={t("rules.deleteDialog.title", { name: rule.name ?? summaryOf(rule) })}
					description={t("rules.deleteDialog.description")}
					confirmLabel={t("rules.deleteDialog.action")}
					destructive
					pending={deleteRule.isPending}
					onConfirm={() =>
						deleteRule.mutate(rule.id, {
							onSuccess: () => {
								toast.success(t("rules.deleteDialog.deleted"));
								setOpen(false);
							},
							onError: (error) => showErrorToast(errorCodeOf(error)),
						})
					}
				/>
			)}
		</Page>
	);
}
