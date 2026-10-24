import type { RuleData, RuleRunData } from "@/hooks/useRules";
import type { FormValues } from "@/lib/rule-form";
import type { RuleSort, SortDirection } from "@/lib/rule-sort";
import type { SummaryNames } from "@/lib/rule-summary";

import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpDownIcon, EllipsisIcon, ListFilterIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";

import { DEFAULT_CURRENCY, isCurrencyCode } from "@archant/data/money";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyNote, EmptyState } from "@/components/EmptyState";
import { GROUP_TABLE_INSET, InsetGroup } from "@/components/InsetGroup";
import { ListCard } from "@/components/ListCard";
import { Page } from "@/components/Page";
import { Pagination } from "@/components/Pagination";
import { RuleDialog } from "@/components/RuleDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAccounts } from "@/hooks/useAccounts";
import { useCategories } from "@/hooks/useCategories";
import { pageCountOf, useClampPage } from "@/hooks/useClampPage";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useMerchants } from "@/hooks/useMerchants";
import {
	useApplyRules,
	useDeleteAllRules,
	useDeleteRule,
	useFetchRulePreview,
	useRuleRuns,
	useRules,
	useSetRuleEnabled,
} from "@/hooks/useRules";
import { useTags } from "@/hooks/useTags";
import { accountsByName } from "@/lib/account-list";
import { errorCodeOf, isErrorCode } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { pageSearch } from "@/lib/page-search";
import { amountStep, presetValues } from "@/lib/rule-form";
import { RULE_SORTS, SORT_DIRECTIONS, isRuleSort, sortRules } from "@/lib/rule-sort";
import { ruleSummary } from "@/lib/rule-summary";

// Absent means the first page of runs; a value from an old or hand-edited
// link that no longer exists falls back to it rather than failing the page.
const searchSchema = z.object({
	runsPage: z.number().int().min(1).optional().catch(undefined),
	// Sure's `sort_by` and `direction`: name ascending unless the link says otherwise.
	sortBy: z.enum(RULE_SORTS).optional().catch(undefined),
	direction: z.enum(SORT_DIRECTIONS).optional().catch(undefined),
	// Sure's `new_rule_path(name:, action_value:)` from the rule prompt: the
	// form opens preset with the line's label and the category chosen.
	name: z.string().optional().catch(undefined),
	categoryId: z.string().optional().catch(undefined),
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
type Opened =
	| { action: "add"; preset?: FormValues }
	| { action: "deleteAll" }
	| { action: "edit" | "delete"; id: string };

/**
 * An application waiting for its confirmation: one rule, or every rule for a
 * `null` id, with the lines its preview matched, each once, as Sure's
 * `affected_resource_count` and `total_affected_resource_count`.
 */
type Applying = {
	ruleId: string | null;
	name: string | null;
	matched: number;
	/** How many rules « Appliquer tout » runs, disabled ones included. */
	ruleCount: number;
};

// The API stores instants; the user reads when it ran, in their zone, as
// Sure's `%b %d, %Y %I:%M %p` in French.
const runTime = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

const RUN_STATUSES = {
	pending: "rulePending",
	success: "ruleSuccess",
	failed: "ruleFailed",
} as const;

/** A run's status, Sure's pill, with the failure's reason in a tooltip as Sure's. */
function RunStatus({ run }: { run: RuleRunData }) {
	const { t } = useTranslation();
	const badge = <StatusBadge status={RUN_STATUSES[run.status]} />;

	if (run.status !== "failed" || run.errorMessage === null) {
		return badge;
	}

	const reason = t(`errors.${isErrorCode(run.errorMessage) ? run.errorMessage : "INTERNAL_ERROR"}`);

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				{/* Focusable, so a keyboard reaches the reason the tooltip describes it with. */}
				<span tabIndex={0} className="inline-flex rounded-md">
					{badge}
				</span>
			</TooltipTrigger>
			<TooltipContent side="bottom">{reason}</TooltipContent>
		</Tooltip>
	);
}

/** A rule as a viewer reads it: no switch and no menu, « Désactivée » when it is. */
function RuleLine({ rule, summary }: { rule: RuleData; summary: string }) {
	const title = rule.name ?? summary;

	return (
		<div className="flex min-h-14 items-center gap-3 px-4 py-2">
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="truncate font-medium">{title}</span>
				{rule.name !== null && <span className="truncate text-muted-foreground">{summary}</span>}
			</div>
			{!rule.enabled && <StatusBadge status="ruleDisabled" />}
		</div>
	);
}

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
		<div className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-hover">
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="truncate font-medium">{title}</span>
				{rule.name !== null && <span className="truncate text-muted-foreground">{summary}</span>}
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
					{/* Sure's « Réappliquer la règle »: the confirmation, which enables it. */}
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
 * Sure's « Trier par : » and « Changer le sens du tri », kept in the URL as
 * Sure's query parameters; name ascending is the absent pair.
 */
function RuleSortControls({ sortBy, direction }: { sortBy: RuleSort; direction: SortDirection }) {
	const { t } = useTranslation();
	const navigate = Route.useNavigate();
	const labelId = useId();
	const sortTo = (next: { sortBy: RuleSort; direction: SortDirection }) =>
		void navigate({
			to: "/rules",
			search: (previous) => ({
				...previous,
				sortBy: next.sortBy === "name" ? undefined : next.sortBy,
				direction: next.direction === "asc" ? undefined : next.direction,
			}),
			replace: true,
		});

	return (
		<div className="flex items-center gap-1">
			<span id={labelId}>{t("rules.sort.label")}</span>
			<Select
				value={sortBy}
				onValueChange={(value) => {
					if (isRuleSort(value)) {
						sortTo({ sortBy: value, direction });
					}
				}}
			>
				<SelectTrigger
					size="sm"
					aria-labelledby={labelId}
					className="border-none bg-transparent text-foreground uppercase shadow-none dark:bg-transparent"
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="name">{t("rules.sort.name")}</SelectItem>
					<SelectItem value="updated_at">{t("rules.sort.updatedAt")}</SelectItem>
				</SelectContent>
			</Select>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={t("rules.sort.toggle")}
				title={t("rules.sort.toggle")}
				onClick={() => sortTo({ sortBy, direction: direction === "asc" ? "desc" : "asc" })}
			>
				<ArrowUpDownIcon />
			</Button>
		</div>
	);
}

/**
 * Sure's « Exécutions récentes », the latest first: when, how it started, its
 * status, the rule as it was then, labelled with today's names, and the rows
 * it processed and modified.
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
		<div className="flex flex-col gap-3">
			<ListCard>
				<InsetGroup
					level={2}
					id="rule-runs"
					title={t("rules.runs.title")}
					note={t("rules.runs.description")}
					{...(data === undefined ? {} : { count: data.total })}
				>
					{runs.isPending && (
						<div className="p-4">
							<Skeleton className="h-14 w-full" />
						</div>
					)}

					{runs.isError && (
						<div role="alert" className="flex flex-col items-start gap-3 p-4">
							<p className="text-muted-foreground">{t(`errors.${errorCodeOf(runs.error)}`)}</p>
							<Button variant="outline" onClick={() => void runs.refetch()}>
								{t("common.retry")}
							</Button>
						</div>
					)}

					{/* A secondary list: a sentence, no action, as in Sure. */}
					{data !== undefined && data.total === 0 && (
						<p className="px-4 py-4 text-muted-foreground">{t("rules.runs.empty")}</p>
					)}

					{data !== undefined && data.total > 0 && (
						<Table aria-labelledby="rule-runs" className={GROUP_TABLE_INSET}>
							<TableHeader>
								<TableRow className="border-line hover:bg-transparent">
									<TableHead scope="col" className="type-overline text-muted-foreground">
										{t("rules.runs.columns.dateTime")}
									</TableHead>
									<TableHead scope="col" className="type-overline text-muted-foreground">
										{t("rules.runs.columns.type")}
									</TableHead>
									<TableHead scope="col" className="type-overline text-muted-foreground">
										{t("rules.runs.columns.status")}
									</TableHead>
									<TableHead scope="col" className="type-overline text-muted-foreground">
										{t("rules.runs.columns.rule")}
									</TableHead>
									<TableHead scope="col" className="type-overline text-right text-muted-foreground">
										{t("rules.runs.columns.processed")}
									</TableHead>
									<TableHead scope="col" className="type-overline text-right text-muted-foreground">
										{t("rules.runs.columns.modified")}
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{/* No hover: a run opens nothing, and a failed one's tint keeps its contrast. */}
								{data.items.map((run) => (
									<TableRow key={run.id} className="h-14 border-line hover:bg-transparent">
										<TableCell className="whitespace-nowrap">
											{runTime.format(new Date(run.executedAt))}
										</TableCell>
										<TableCell className="whitespace-nowrap">
											{t(`rules.runs.types.${run.executionType}`)}
										</TableCell>
										<TableCell>
											<RunStatus run={run} />
										</TableCell>
										<TableCell className="max-w-96 truncate">{labelOf(run)}</TableCell>
										<TableCell className="text-right tabular-nums">
											{run.transactionsProcessed}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{run.transactionsModified}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</InsetGroup>
			</ListCard>

			{data !== undefined && pageCount > 1 && (
				<Pagination
					target={{ to: "/rules", param: "runsPage" }}
					page={page}
					pageCount={pageCount}
					label={t("rules.runs.paginationLabel")}
				/>
			)}
		</div>
	);
}

/**
 * The rules, sorted as the user picks, each with its switch and its menu.
 * After each sync or import the enabled ones run over every transaction, in
 * creation order, as Sure's post-sync; an application the user confirms runs
 * them at once, which a new rule offers once saved and which enables it, as
 * Sure's `rules#confirm`. A viewer reads the rules and their runs, and changes none.
 */
function RulesPage() {
	const { t } = useTranslation();
	const admin = useIsAdmin();
	const {
		runsPage = 1,
		sortBy = "name",
		direction = "asc",
		name: presetName,
		categoryId: presetCategory,
	} = Route.useSearch();
	const navigate = Route.useNavigate();
	const desktop = useMediaQuery(DESKTOP_QUERY);
	const rules = useRules();
	const accounts = useAccounts();
	const categories = useCategories();
	const merchants = useMerchants();
	const tags = useTags();
	const deleteRule = useDeleteRule();
	const deleteAll = useDeleteAllRules();
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
	const list = useMemo(() => rules.data ?? [], [rules.data]);
	const sorted = useMemo(() => sortRules(list, sortBy, direction), [list, sortBy, direction]);
	const accountList = useMemo(
		() => (accounts.data === undefined ? [] : accountsByName(accounts.data)),
		[accounts.data],
	);
	const reported = accounts.data?.reportingCurrency ?? DEFAULT_CURRENCY;
	const reportingCurrency = isCurrencyCode(reported) ? reported : DEFAULT_CURRENCY;
	const options = useMemo(
		() => ({
			amountStep: amountStep(reportingCurrency),
			accounts: accountList,
			categories: categories.data ?? [],
			merchants: merchants.data ?? [],
			tags: tags.data ?? [],
		}),
		[reportingCurrency, accountList, categories.data, merchants.data, tags.data],
	);
	const names: SummaryNames = useMemo(
		() => ({
			accounts: new Map(accountList.map((account) => [account.id, account.name])),
			categories: new Map(options.categories.map((category) => [category.id, category.name])),
			merchants: new Map(options.merchants.map((merchant) => [merchant.id, merchant.name])),
			tags: new Map(options.tags.map((tag) => [tag.id, tag.name])),
		}),
		[accountList, options],
	);
	const rule =
		opened === null || !("id" in opened)
			? undefined
			: list.find((candidate) => candidate.id === opened.id);
	// Deleted elsewhere since it opened: nothing left to act on.
	const gone = opened !== null && "id" in opened && rule === undefined;
	const queries = [rules, accounts, categories, merchants, tags];
	const ready = queries.every((query) => query.data !== undefined);
	const failed = queries.find((query) => query.isError);

	useEffect(() => {
		if (gone) {
			setOpen(false);
			setOpened(null);
		}
	}, [gone]);

	// Opened once from the prompt's link, which then leaves the address: a
	// reload or « Précédent » does not open it again.
	useEffect(() => {
		if (presetName === undefined || presetCategory === undefined) {
			return;
		}

		if (!ready && failed === undefined) {
			return;
		}

		if (desktop && admin && failed === undefined) {
			setOpened({ action: "add", preset: presetValues(presetName, presetCategory) });
			setOpen(true);
		}
		void navigate({
			replace: true,
			search: ({ name: _name, categoryId: _categoryId, ...rest }) => rest,
		});
	}, [presetName, presetCategory, ready, failed, desktop, admin, navigate]);

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("rules.title"), app: t("app.name") });
	}, [t]);

	const openDialog = (next: Opened) => {
		setOpened(next);
		setOpen(true);
	};

	const summaryOf = (item: RuleData) => ruleSummary(item, names, t);

	/** Reads the count, then asks: a rule's own, or every rule's for `null`. */
	const askToApply = async (item: RuleData | null) => {
		if (previewPending.current) {
			return;
		}

		previewPending.current = true;
		setPreviewing(true);

		try {
			const { matched } = await fetchPreview(item?.id ?? null);
			setApplying({
				ruleId: item?.id ?? null,
				name: item?.name ?? null,
				matched,
				ruleCount: list.length,
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
			title={t("rules.title")}
			description={t("rules.description")}
			actions={
				desktop && admin ? (
					<>
						{/* As Sure's index, only once a rule exists: its page menu, then « Appliquer tout ». */}
						{list.length > 0 && (
							<>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											variant="outline"
											size="icon"
											disabled={previewing}
											aria-label={t("rules.menu")}
										>
											<EllipsisIcon />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end" className="w-auto">
										<DropdownMenuItem
											variant="destructive"
											onSelect={() => openDialog({ action: "deleteAll" })}
										>
											<Trash2Icon />
											{t("rules.deleteAll.action")}
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
								<Button
									variant="outline"
									disabled={previewing}
									onClick={() => void askToApply(null)}
								>
									{t("rules.apply.all")}
								</Button>
							</>
						)}
						{/* An empty list offers its own, the one way forward. */}
						{!(ready && failed === undefined && list.length === 0) && (
							<Button onClick={() => openDialog({ action: "add" })}>{t("rules.add")}</Button>
						)}
					</>
				) : undefined
			}
		>
			{!desktop && <EmptyNote>{t("rules.mobile")}</EmptyNote>}

			{desktop && !ready && failed === undefined && (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-14 w-full" />
					<Skeleton className="h-14 w-full" />
				</div>
			)}

			{desktop && failed !== undefined && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border bg-card p-4">
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
					<EmptyState
						level={2}
						icon={{ kind: "transfer", icon: ListFilterIcon }}
						title={t("rules.empty.title")}
						description={t("rules.empty.description")}
						action={
							admin ? (
								<Button onClick={() => openDialog({ action: "add" })}>{t("rules.add")}</Button>
							) : null
						}
					/>
				) : (
					<ListCard>
						<InsetGroup
							level={2}
							title={t("rules.list")}
							count={list.length}
							total={<RuleSortControls sortBy={sortBy} direction={direction} />}
						>
							<ul aria-label={t("rules.title")} className="divide-y divide-line">
								{sorted.map((item) => (
									<li key={item.id}>
										{!admin ? (
											<RuleLine rule={item} summary={summaryOf(item)} />
										) : (
											<RuleRow
												rule={item}
												summary={summaryOf(item)}
												onEdit={() => openDialog({ action: "edit", id: item.id })}
												onApply={() => void askToApply(item)}
												applyDisabled={previewing}
												onDelete={() => openDialog({ action: "delete", id: item.id })}
											/>
										)}
									</li>
								))}
							</ul>
						</InsetGroup>
					</ListCard>
				))}

			{desktop && ready && (opened?.action === "add" || opened?.action === "edit") && (
				<RuleDialog
					open={open}
					onOpenChange={setOpen}
					rule={rule}
					preset={opened.action === "add" ? opened.preset : undefined}
					options={options}
					// Sure confirms a new rule only; an edit keeps the switch and asks nothing.
					onSaved={opened.action === "add" ? (saved) => void askToApply(saved) : undefined}
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
						applying.ruleId === null
							? t("rules.apply.allTitle")
							: applying.name === null
								? t("rules.apply.title")
								: t("rules.apply.titleNamed", { name: applying.name })
					}
					description={
						applying.ruleId === null
							? t("rules.apply.allDescription", {
									count: applying.ruleCount,
									rows: t("rules.apply.uniqueRows", { count: applying.matched }),
								})
							: t("rules.apply.description", { count: applying.matched })
					}
					confirmLabel={
						applying.ruleId === null ? t("rules.apply.allConfirm") : t("rules.apply.confirm")
					}
					pending={applyRules.isPending}
					onConfirm={() =>
						applyRules.mutate(applying.ruleId, {
							// What was written, each row once: the runs' own counts would add
							// up a row two rules both change.
							onSuccess: ({ changed, runs }) => {
								const failedRuns = runs.filter((run) => run.status === "failed").length;

								// A rule that failed wrote nothing; « Exécutions récentes » says which.
								if (failedRuns > 0) {
									toast.error(t("rules.apply.failed", { count: failedRuns }));
								} else {
									toast.success(
										changed === 0
											? t("rules.apply.doneNothing")
											: t("rules.apply.done", { count: changed }),
									);
								}
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
			{opened?.action === "deleteAll" && (
				<ConfirmDialog
					open={open}
					onOpenChange={setOpen}
					destructive
					title={t("rules.deleteAll.title")}
					description={t("rules.deleteAll.description")}
					confirmLabel={t("rules.deleteAll.confirm")}
					pending={deleteAll.isPending}
					onConfirm={() =>
						deleteAll.mutate(undefined, {
							onSuccess: () => {
								toast.success(t("rules.deleteAll.deleted"));
								setOpen(false);
							},
							onError: (error) => showErrorToast(errorCodeOf(error)),
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
