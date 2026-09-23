import type { CategoryData } from "@/hooks/useCategories";
import type { FilterKind, TransactionFilters as Filters } from "@/lib/transaction-filters";
import type { FormEvent, ReactNode } from "react";

import { ListFilterIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
	UNCATEGORISED,
	compareAmountBounds,
	parseAmountBound,
} from "@archant/api/schemas/transactions";

import { CategoryDot } from "@/components/CategoryDot";
import { DateField } from "@/components/DateField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { categoryTree } from "@/lib/category-tree";
import { FILTER_KINDS, filterChips } from "@/lib/transaction-filters";

/**
 * An account as the filters know it. An inactive one is not offered in the
 * editor, but its chip, from an older link, still shows its name.
 */
export type FilterAccount = { id: string; name: string; active: boolean };

/** What an editor sets: its own params, `undefined` to clear one. */
export type FilterChange = Partial<Filters>;

type EditorProps = {
	filters: Filters;
	onApply: (change: FilterChange) => void;
};

function FieldError({ id, code }: { id: string; code: string | null }) {
	const { t } = useTranslation();

	if (code === null) {
		return null;
	}

	return (
		<p id={id} className="text-xs text-destructive">
			{t(
				`errors.fields.${code === "before_from" || code === "below_min" ? code : "invalid_amount"}`,
			)}
		</p>
	);
}

function EditorForm({ onSubmit, children }: { onSubmit: () => void; children: ReactNode }) {
	const { t } = useTranslation();

	return (
		<form
			noValidate
			className="flex flex-col gap-3"
			onSubmit={(event: FormEvent) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			{children}
			<Button type="submit" size="sm" className="self-end">
				{t("operations.editor.apply")}
			</Button>
		</form>
	);
}

/** A checkbox list's toggle: the set with `id` added or removed. */
function toggled(selected: ReadonlySet<string>, id: string, checked: boolean): Set<string> {
	const next = new Set(selected);

	if (checked) {
		next.add(id);
	} else {
		next.delete(id);
	}

	return next;
}

function CategoryCheckbox({
	id,
	label,
	color,
	child = false,
	selected,
	onChange,
}: {
	id: string;
	label: string;
	color: string | null;
	child?: boolean;
	selected: ReadonlySet<string>;
	onChange: (next: Set<string>) => void;
}) {
	return (
		<label className={`flex min-h-6 items-center gap-2 ${child ? "pl-6" : ""}`}>
			<input
				type="checkbox"
				className="size-4 accent-primary"
				checked={selected.has(id)}
				onChange={(event) => onChange(toggled(selected, id, event.target.checked))}
			/>
			<CategoryDot color={color} />
			<span className="truncate">{label}</span>
		</label>
	);
}

/**
 * « Sans catégorie » first, then each parent and its children. Checking a
 * parent is enough to see its children's rows: the API expands it.
 */
function CategoryEditor({
	filters,
	categories,
	onApply,
}: EditorProps & { categories: readonly CategoryData[] }) {
	const { t } = useTranslation();
	// An id from an old link that names no category any more is left out, so
	// Appliquer drops it instead of keeping a filter no checkbox can clear.
	const [selected, setSelected] = useState(() => {
		const known = new Set(categories.map((category) => category.id));

		return new Set((filters.category ?? []).filter((id) => id === UNCATEGORISED || known.has(id)));
	});

	return (
		<EditorForm
			onSubmit={() => onApply({ category: selected.size === 0 ? undefined : [...selected] })}
		>
			<fieldset className="flex flex-col gap-2">
				<legend className="mb-1 text-xs font-medium text-muted-foreground">
					{t("operations.editor.categories")}
				</legend>
				<div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
					<CategoryCheckbox
						id={UNCATEGORISED}
						label={t("operations.chips.uncategorised")}
						color={null}
						selected={selected}
						onChange={setSelected}
					/>
					{categoryTree(categories).flatMap(({ parent, children }) => [
						<CategoryCheckbox
							key={parent.id}
							id={parent.id}
							label={parent.name}
							color={parent.color}
							selected={selected}
							onChange={setSelected}
						/>,
						...children.map((child) => (
							<CategoryCheckbox
								key={child.id}
								id={child.id}
								label={child.name}
								color={child.color}
								child
								selected={selected}
								onChange={setSelected}
							/>
						)),
					])}
				</div>
			</fieldset>
		</EditorForm>
	);
}

function AccountEditor({
	filters,
	accounts,
	onApply,
}: EditorProps & { accounts: readonly FilterAccount[] }) {
	const { t } = useTranslation();
	const [selected, setSelected] = useState(() => new Set(filters.account ?? []));
	// An inactive account already in the filter stays offered, so it can be
	// unchecked; read from the initial selection so it does not vanish once it is.
	const [initial] = useState(() => new Set(filters.account ?? []));
	const offered = accounts.filter((account) => account.active || initial.has(account.id));

	return (
		<EditorForm
			onSubmit={() => onApply({ account: selected.size === 0 ? undefined : [...selected] })}
		>
			<fieldset className="flex flex-col gap-2">
				<legend className="mb-1 text-xs font-medium text-muted-foreground">
					{t("operations.editor.accounts")}
				</legend>
				{offered.length === 0 && (
					<p className="text-muted-foreground">{t("operations.editor.noAccount")}</p>
				)}
				{/* Scrolls on its own, so Appliquer stays in view however many accounts there are. */}
				<div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
					{offered.map((account) => (
						<label key={account.id} className="flex min-h-6 items-center gap-2">
							<input
								type="checkbox"
								className="size-4 accent-primary"
								checked={selected.has(account.id)}
								onChange={(event) =>
									setSelected(toggled(selected, account.id, event.target.checked))
								}
							/>
							<span className="truncate">{account.name}</span>
						</label>
					))}
				</div>
			</fieldset>
		</EditorForm>
	);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function PeriodEditor({ filters, onApply }: EditorProps) {
	const { t } = useTranslation();
	const [from, setFrom] = useState(filters.from ?? "");
	const [to, setTo] = useState(filters.to ?? "");
	const [errors, setErrors] = useState<{ from: string | null; to: string | null }>({
		from: null,
		to: null,
	});

	const apply = () => {
		const fromError = from === "" || ISO_DATE.test(from) ? null : "invalid_format";
		const toError =
			to !== "" && !ISO_DATE.test(to)
				? "invalid_format"
				: from !== "" && to !== "" && to < from
					? "before_from"
					: null;

		setErrors({ from: fromError, to: toError });

		if (fromError === null && toError === null) {
			onApply({ from: from === "" ? undefined : from, to: to === "" ? undefined : to });
		}
	};

	return (
		<EditorForm onSubmit={apply}>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="filter-from">{t("operations.editor.from")}</Label>
				<DateField
					id="filter-from"
					value={from}
					onChange={setFrom}
					invalid={errors.from !== null}
					{...(errors.from === null ? {} : { describedBy: "filter-from-error" })}
				/>
				{errors.from !== null && (
					<p id="filter-from-error" className="text-xs text-destructive">
						{t("errors.fields.invalid_format")}
					</p>
				)}
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="filter-to">{t("operations.editor.to")}</Label>
				<DateField
					id="filter-to"
					value={to}
					onChange={setTo}
					invalid={errors.to !== null}
					{...(errors.to === null ? {} : { describedBy: "filter-to-error" })}
				/>
				{errors.to !== null && (
					<p id="filter-to-error" className="text-xs text-destructive">
						{t(
							errors.to === "before_from"
								? "errors.fields.before_from"
								: "errors.fields.invalid_format",
						)}
					</p>
				)}
			</div>
		</EditorForm>
	);
}

function AmountEditor({ filters, onApply }: EditorProps) {
	const { t } = useTranslation();
	const [min, setMin] = useState(filters.amountMin ?? "");
	const [max, setMax] = useState(filters.amountMax ?? "");
	const [errors, setErrors] = useState<{ min: string | null; max: string | null }>({
		min: null,
		max: null,
	});

	const apply = () => {
		const low = min.trim() === "" ? undefined : parseAmountBound(min);
		const high = max.trim() === "" ? undefined : parseAmountBound(max);
		const minError = low === null ? "invalid_amount" : null;
		const maxError =
			high === null
				? "invalid_amount"
				: low !== null &&
					  low !== undefined &&
					  high !== undefined &&
					  compareAmountBounds(low, high) > 0
					? "below_min"
					: null;

		setErrors({ min: minError, max: maxError });

		if (minError === null && maxError === null) {
			onApply({
				amountMin: low === undefined ? undefined : min.trim(),
				amountMax: high === undefined ? undefined : max.trim(),
			});
		}
	};

	return (
		<EditorForm onSubmit={apply}>
			<p className="text-xs text-muted-foreground">{t("operations.editor.amountHint")}</p>
			<div className="grid grid-cols-2 gap-2">
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="filter-amount-min">{t("operations.editor.min")}</Label>
					<Input
						id="filter-amount-min"
						value={min}
						inputMode="decimal"
						autoComplete="off"
						className="text-right tabular-nums"
						aria-invalid={errors.min !== null}
						{...(errors.min === null ? {} : { "aria-describedby": "filter-amount-min-error" })}
						onChange={(event) => setMin(event.target.value)}
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="filter-amount-max">{t("operations.editor.max")}</Label>
					<Input
						id="filter-amount-max"
						value={max}
						inputMode="decimal"
						autoComplete="off"
						className="text-right tabular-nums"
						aria-invalid={errors.max !== null}
						{...(errors.max === null ? {} : { "aria-describedby": "filter-amount-max-error" })}
						onChange={(event) => setMax(event.target.value)}
					/>
				</div>
			</div>
			<FieldError id="filter-amount-min-error" code={errors.min} />
			<FieldError id="filter-amount-max-error" code={errors.max} />
		</EditorForm>
	);
}

type TransactionFiltersProps = {
	filters: Filters;
	accounts: readonly FilterAccount[];
	categories: readonly CategoryData[];
	onChange: (change: FilterChange) => void;
	onRemove: (kind: FilterKind) => void;
};

/**
 * The « Filtrer » menu and one removable chip per filter set (EXPERIENCE.md).
 * The menu lists the filters, then shows the chosen one's editor in place; a
 * chip reopens its own editor.
 */
export function TransactionFilters({
	filters,
	accounts,
	categories,
	onChange,
	onRemove,
}: TransactionFiltersProps) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const [pane, setPane] = useState<FilterKind | null>(null);
	const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
	const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
	const chips = filterChips(
		filters,
		{ account: (id) => accountNames.get(id), category: (id) => categoryNames.get(id) },
		(key, values) => t(key, { replace: values ?? {} }),
	);

	const edit = (kind: FilterKind | null) => {
		setPane(kind);
		setOpen(true);
	};
	const apply = (change: FilterChange) => {
		setOpen(false);
		onChange(change);
	};

	return (
		<div className="flex flex-wrap items-center gap-2">
			<Popover
				open={open}
				onOpenChange={(next) => {
					setOpen(next);
					if (next) {
						setPane(null);
					}
				}}
			>
				<PopoverTrigger asChild>
					<Button variant="outline" size="sm">
						<ListFilterIcon />
						{t("operations.filter")}
					</Button>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-80">
					{pane === null && (
						<ul aria-label={t("operations.filter")} className="flex flex-col">
							{FILTER_KINDS.map((kind) => (
								<li key={kind}>
									<Button
										variant="ghost"
										size="sm"
										className="w-full justify-start"
										onClick={() => setPane(kind)}
									>
										{t(`operations.kinds.${kind}`)}
									</Button>
								</li>
							))}
						</ul>
					)}
					{pane !== null && (
						<div className="flex flex-col gap-2">
							<div className="flex items-center justify-between">
								<p className="font-medium">{t(`operations.kinds.${pane}`)}</p>
								<Button variant="ghost" size="sm" onClick={() => setPane(null)}>
									{t("operations.editor.back")}
								</Button>
							</div>
							{pane === "account" && (
								<AccountEditor filters={filters} accounts={accounts} onApply={apply} />
							)}
							{pane === "category" && (
								<CategoryEditor filters={filters} categories={categories} onApply={apply} />
							)}
							{pane === "period" && <PeriodEditor filters={filters} onApply={apply} />}
							{pane === "amount" && <AmountEditor filters={filters} onApply={apply} />}
						</div>
					)}
				</PopoverContent>
			</Popover>

			{chips.map((chip) => (
				<Badge key={chip.kind} variant="outline" className="h-7 gap-0.5 pr-0.5 pl-0">
					<button
						type="button"
						className="h-full rounded-l-4xl pr-1 pl-2.5 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
						onClick={() => edit(chip.kind)}
					>
						{chip.label}
					</button>
					<button
						type="button"
						aria-label={t("operations.removeFilter", { label: chip.label })}
						className="grid size-6 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
						onClick={() => onRemove(chip.kind)}
					>
						<XIcon aria-hidden="true" />
					</button>
				</Badge>
			))}
		</div>
	);
}
