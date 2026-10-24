import type { CategoryData } from "@/hooks/useCategories";
import type { CategorizeGroup, CategorizeLine } from "@/hooks/useCategorize";

import { Link, Navigate, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon, CheckIcon, PencilIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";

import type { MinorUnits } from "@archant/data/money";
import { toMinorUnits } from "@archant/data/money";

import { CategoryPill } from "@/components/CategoryPill";
import { Money } from "@/components/Money";
import { Page } from "@/components/Page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategories } from "@/hooks/useCategories";
import {
	useCategorize,
	useCategorizePreview,
	useCategorizeStep,
	useRefreshCategorize,
} from "@/hooks/useCategorize";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { errorCodeOf } from "@/lib/api";
import { categoryTree } from "@/lib/category-tree";
import { isoToFrench } from "@/lib/dates";
import { matchesSearch } from "@/lib/search-match";

const searchSchema = z.object({
	position: z.coerce.number().int().min(0).optional().catch(undefined),
});

// `transactions_`: a page of its own, not a child rendered inside « Opérations ».
export const Route = createFileRoute("/_authed/transactions_/categorize")({
	validateSearch: searchSchema,
	component: CategorizePage,
});

/** A category as a pill and a select show it: a child after its parent, named « Parent > Enfant », as Sure's. */
type CategoryChoice = { category: CategoryData; label: string };

function choicesOf(categories: readonly CategoryData[]): CategoryChoice[] {
	return categoryTree(categories).flatMap(({ parent, children }) => [
		{ category: parent, label: parent.name },
		...children.map((child) => ({ category: child, label: `${parent.name} > ${child.name}` })),
	]);
}

/** Sure's total of a group, in absolute amounts, one per currency. */
function GroupTotal({ lines }: { lines: readonly CategorizeLine[] }) {
	const totals = new Map<string, MinorUnits>();

	for (const line of lines) {
		totals.set(
			line.currency,
			toMinorUnits((totals.get(line.currency) ?? 0) + Math.abs(line.amount)),
		);
	}

	return [...totals].map(([currency, amount], index) => (
		<span key={currency}>
			{index > 0 && " + "}
			<Money amount={amount} currency={currency} className="font-normal" />
		</span>
	));
}

/**
 * The rule's text, shown quoted with a pencil, typed in place once the pencil
 * is pressed, as Sure's `startFilterEdit`: `Enter` or the check confirms and
 * previews the lines it matches, `Escape` cancels.
 */
function RuleText({
	value,
	disabled,
	onConfirm,
}: {
	value: string;
	disabled: boolean;
	onConfirm: (value: string) => void;
}) {
	const { t } = useTranslation();
	const [draft, setDraft] = useState<string | null>(null);

	if (draft === null) {
		return (
			<span className="inline-flex items-center gap-1 align-middle">
				<span className="font-medium text-foreground">« {value} »</span>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="size-6"
					aria-label={t("categorize.editFilter")}
					disabled={disabled}
					onClick={() => setDraft(value)}
				>
					<PencilIcon />
				</Button>
			</span>
		);
	}

	const confirm = () => {
		const text = draft.trim();

		if (text !== "") {
			setDraft(null);
			onConfirm(text);
		}
	};

	return (
		<span className="inline-flex items-center gap-1 align-middle">
			<Input
				// oxlint-disable-next-line jsx-a11y/no-autofocus -- typed in as soon as the pencil is pressed, as Sure's
				autoFocus
				aria-label={t("categorize.filterLabel")}
				className="h-7 w-44"
				disabled={disabled}
				value={draft}
				onChange={(event) => setDraft(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						confirm();
					} else if (event.key === "Escape") {
						event.preventDefault();
						setDraft(null);
					}
				}}
			/>
			<Button
				type="button"
				size="icon"
				className="size-7"
				aria-label={t("categorize.confirmFilter")}
				disabled={disabled}
				onClick={confirm}
			>
				<CheckIcon />
			</Button>
		</span>
	);
}

/** One line: ticked to be categorised with the group, or given its own category at once. */
function LineRow({
	line,
	ticked,
	choices,
	disabled,
	onTick,
	onAssign,
}: {
	line: CategorizeLine;
	ticked: boolean;
	choices: readonly CategoryChoice[];
	disabled: boolean;
	onTick: (ticked: boolean) => void;
	onAssign: (categoryId: string) => void;
}) {
	const { t } = useTranslation();

	return (
		// Two rows, so the label keeps the width of the narrow column: the
		// line, then its date and its own category.
		<li className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3">
			<Checkbox
				checked={ticked}
				aria-label={t("categorize.include", { name: line.label })}
				onCheckedChange={(checked) => onTick(checked === true)}
			/>
			<span className="truncate font-medium">{line.label}</span>
			<Money amount={line.amount} currency={line.currency} signed className="text-right" />
			<span className="col-start-2 text-sm text-muted-foreground">{isoToFrench(line.date)}</span>
			<Select value="" onValueChange={onAssign} disabled={disabled}>
				<SelectTrigger
					size="sm"
					className="w-36"
					aria-label={t("categorize.assignLine", { name: line.label })}
				>
					<SelectValue placeholder={t("categorize.assignPrompt")} />
				</SelectTrigger>
				<SelectContent>
					{choices.map(({ category, label }) => (
						<SelectItem key={category.id} value={category.id}>
							{label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</li>
	);
}

/**
 * Sure's category pills under « Assigner une catégorie », filtered as typed;
 * `Enter` picks the only one left, as Sure's `selectFirst`.
 */
function CategoryPicker({
	choices,
	disabled,
	onPick,
}: {
	choices: readonly CategoryChoice[];
	disabled: boolean;
	onPick: (categoryId: string) => void;
}) {
	const { t } = useTranslation();
	const [search, setSearch] = useState("");
	const shown = choices.filter(({ label }) => matchesSearch(label, search));
	const pick = (categoryId: string) => {
		setSearch("");
		onPick(categoryId);
	};

	return (
		<section
			aria-labelledby="categorize-assign"
			className="flex flex-col gap-3 rounded-xl border bg-card p-4"
		>
			<h3 id="categorize-assign" className="text-sm font-medium text-muted-foreground">
				{t("categorize.assign")}
			</h3>
			<div className="relative">
				<SearchIcon
					aria-hidden="true"
					className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					type="search"
					// oxlint-disable-next-line jsx-a11y/no-autofocus -- Sure's field takes the focus, so a category is typed at once
					autoFocus
					aria-label={t("categorize.searchCategories")}
					placeholder={t("categorize.searchCategories")}
					className="pl-8"
					value={search}
					onChange={(event) => setSearch(event.target.value)}
					onKeyDown={(event) => {
						const [only, ...others] = shown;

						if (event.key === "Enter" && only !== undefined && others.length === 0 && !disabled) {
							event.preventDefault();
							pick(only.category.id);
						}
					}}
				/>
			</div>
			{shown.length === 0 ? (
				<p className="text-sm text-muted-foreground">{t("categorize.noCategories")}</p>
			) : (
				<ul className="flex flex-wrap gap-2">
					{shown.map(({ category, label }) => (
						<li key={category.id}>
							<button
								type="button"
								disabled={disabled}
								className="rounded-full outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
								onClick={() => pick(category.id)}
							>
								<CategoryPill
									category={{ name: label, color: category.color, icon: category.icon }}
									className="h-7 text-sm"
								/>
							</button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

/**
 * One group of Sure's `transactions/categorizes/show`. Keyed on the read
 * that gave it, so a new group starts with every line ticked again.
 */
function GroupStep({
	group,
	remaining,
	position,
}: {
	group: CategorizeGroup;
	remaining: number;
	position: number;
}) {
	const { t } = useTranslation();
	const categories = useCategories();
	const categorize = useCategorize();
	const refresh = useRefreshCategorize();
	const choices = useMemo(() => choicesOf(categories.data ?? []), [categories.data]);
	const [left, setLeft] = useState(remaining);
	const [done, setDone] = useState<ReadonlySet<string>>(new Set());
	const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
	const [ruleOn, setRuleOn] = useState(group.lines.length > 1);
	const [filter, setFilter] = useState<string | null>(null);
	const preview = useCategorizePreview(filter, group.type);
	const source = filter === null ? group.lines : (preview.data ?? []);
	const lines = source.filter((line) => !done.has(line.id));
	const ticked = lines.filter((line) => !unticked.has(line.id));
	const ruleText = filter ?? group.name;
	const busy = categorize.isPending;

	const send = (ids: string[], categoryId: string, withRule: boolean) =>
		categorize.mutate(
			{
				ids,
				categoryId,
				...(withRule ? { rule: { name: ruleText, type: group.type } } : {}),
			},
			{
				onSuccess: (result) => {
					if (result.rule === "failed") {
						toast.error(t("categorize.ruleFailed"));
					}

					setLeft(result.remaining);
					setDone((previous) => new Set([...previous, ...ids]));

					// Sure's redirect to the same position once the shown lines are all done.
					if (lines.every((line) => ids.includes(line.id))) {
						void refresh();
					}
				},
			},
		);

	const noLines = filter !== null && preview.isSuccess && lines.length === 0;

	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-center justify-between gap-4">
				<p aria-live="polite" className="text-sm text-muted-foreground">
					{t("categorize.remaining", { count: left })}
				</p>
				<div className="flex items-center gap-2">
					<Button variant="ghost" asChild>
						<Link to="/transactions">{t("categorize.exit")}</Link>
					</Button>
					<Button variant="outline" asChild>
						<Link to="/transactions/categorize" search={{ position: position + 1 }}>
							{t("categorize.skip")}
							<ArrowRightIcon />
						</Link>
					</Button>
				</div>
			</div>

			<div className="flex flex-col gap-1">
				<div className="flex items-center gap-2">
					<h2 className="text-lg font-semibold">{filter ?? group.name}</h2>
					<Badge variant={group.type === "income" ? "default" : "outline"}>
						{t(`categorize.types.${group.type}`)}
					</Badge>
				</div>
				<p className="text-sm text-muted-foreground">
					{t("categorize.lineCount", { count: lines.length })}
					{lines.length > 0 && (
						<>
							{" · "}
							<GroupTotal lines={lines} />
						</>
					)}
				</p>
			</div>

			<div className="grid items-start gap-4 lg:grid-cols-[3fr_2fr]">
				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
						<label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
							<Checkbox
								checked={ruleOn}
								onCheckedChange={(checked) => setRuleOn(checked === true)}
							/>
							{t("categorize.createRule")}
						</label>
						<p
							className={
								ruleOn
									? "text-sm text-muted-foreground"
									: "text-sm text-muted-foreground opacity-40"
							}
						>
							{t("categorize.ruleDescriptionPrefix", {
								type: t(`categorize.typesLower.${group.type}`),
							})}{" "}
							<RuleText value={ruleText} disabled={!ruleOn} onConfirm={setFilter} />{" "}
							{t("categorize.ruleDescriptionSuffix")}
						</p>
					</div>

					<section
						aria-label={t("categorize.linesLabel")}
						className="flex flex-col gap-3 rounded-xl border bg-card p-4"
					>
						<p className="text-xs text-muted-foreground">{t("categorize.linesHint")}</p>
						{filter !== null && preview.isPending ? (
							<Skeleton className="h-24 w-full" />
						) : filter !== null && preview.isError ? (
							<p role="alert" className="text-sm text-muted-foreground">
								{t(`errors.${errorCodeOf(preview.error)}`)}
							</p>
						) : noLines ? (
							<p className="text-sm text-muted-foreground">{t("categorize.noLines")}</p>
						) : (
							<ul className="max-h-[32rem] divide-y overflow-y-auto rounded-lg border">
								{lines.map((line) => (
									<LineRow
										key={line.id}
										line={line}
										ticked={!unticked.has(line.id)}
										choices={choices}
										disabled={busy}
										onTick={(checked) => {
											// Sure's `uncheckRule`: a line left out no longer fits the group's rule.
											if (!checked) {
												setRuleOn(false);
											}

											setUnticked((previous) => {
												const next = new Set(previous);

												if (checked) {
													next.delete(line.id);
												} else {
													next.add(line.id);
												}

												return next;
											});
										}}
										onAssign={(categoryId) => {
											setRuleOn(false);
											send([line.id], categoryId, false);
										}}
									/>
								))}
							</ul>
						)}
					</section>
				</div>

				<CategoryPicker
					choices={choices}
					disabled={busy || ticked.length === 0}
					onPick={(categoryId) =>
						send(
							ticked.map((line) => line.id),
							categoryId,
							ruleOn,
						)
					}
				/>
			</div>
		</div>
	);
}

/** Sure's quick-categorise wizard: one group of uncategorised lines at a time. */
function CategorizePage() {
	const { t } = useTranslation();
	const admin = useIsAdmin();
	const position = Route.useSearch().position ?? 0;
	const step = useCategorizeStep(position, admin);
	const navigate = useNavigate();
	const finished = step.data !== undefined && step.data.group === null;

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("categorize.title"), app: t("app.name") });
	}, [t]);

	// Sure's redirect to the transactions with « all_done » once no group is left.
	useEffect(() => {
		if (finished) {
			toast.success(t("categorize.allDone"));
			void navigate({ to: "/transactions", replace: true });
		}
	}, [finished, navigate, t]);

	if (!admin) {
		return <Navigate to="/transactions" replace />;
	}

	return (
		<Page title={t("categorize.title")}>
			{step.isPending && <Skeleton className="h-64 w-full" />}
			{step.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-8">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(step.error)}`)}</p>
					<Button variant="outline" onClick={() => void step.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}
			{step.data?.group !== undefined && step.data.group !== null && (
				<GroupStep
					key={step.dataUpdatedAt}
					group={step.data.group}
					remaining={step.data.remaining}
					position={position}
				/>
			)}
		</Page>
	);
}
