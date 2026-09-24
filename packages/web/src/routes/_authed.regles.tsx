import type { RuleData } from "@/hooks/useRules";
import type { SummaryNames } from "@/lib/rule-summary";

import { createFileRoute } from "@tanstack/react-router";
import { EllipsisIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { DEFAULT_CURRENCY, isCurrencyCode } from "@archant/data/money";

import { ConfirmDialog } from "@/components/ConfirmDialog";
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
import { useAccounts } from "@/hooks/useAccounts";
import { useCategories } from "@/hooks/useCategories";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useMerchants } from "@/hooks/useMerchants";
import { useDeleteRule, useRules, useSetRuleEnabled } from "@/hooks/useRules";
import { useTags } from "@/hooks/useTags";
import { errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { ruleSummary } from "@/lib/rule-summary";

export const Route = createFileRoute("/_authed/regles")({
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

function RuleRow({
	rule,
	summary,
	onEdit,
	onDelete,
}: {
	rule: RuleData;
	summary: string;
	onEdit: () => void;
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
					<DropdownMenuItem variant="destructive" onSelect={onDelete}>
						{t("rules.delete")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

/**
 * The rules, in the order they apply, each with its switch and its menu. New
 * transactions go through the enabled ones as they arrive.
 */
function RulesPage() {
	const { t } = useTranslation();
	const desktop = useMediaQuery(DESKTOP_QUERY);
	const rules = useRules();
	const accounts = useAccounts();
	const categories = useCategories();
	const merchants = useMerchants();
	const tags = useTags();
	const deleteRule = useDeleteRule();
	const [opened, setOpened] = useState<Opened | null>(null);
	const [open, setOpen] = useState(false);
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

	return (
		<div className="flex w-full max-w-[1200px] flex-col gap-6 p-6">
			<div className="flex items-center justify-between gap-4">
				<h1 className="text-3xl font-semibold tracking-tight">{t("rules.title")}</h1>
				{desktop && <Button onClick={() => openDialog({ action: "add" })}>{t("rules.add")}</Button>}
			</div>
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
		</div>
	);
}
