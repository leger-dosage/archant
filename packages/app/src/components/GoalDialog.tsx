import type { AccountSummaryData } from "@/hooks/useAccounts";
import type { GoalData } from "@/hooks/useGoals";
import type { Path, Resolver } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRef } from "react";
import { useController, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { GoalFormInput } from "@archant/api/schemas/goals";
import { goalSchema } from "@archant/api/schemas/goals";
import type { GoalKind, GoalTargetMode } from "@archant/data/goals";
import {
	DEFAULT_GOAL_COLOR,
	DEFAULT_GOAL_ICON,
	GOAL_KINDS,
	GOAL_TARGET_MODES,
} from "@archant/data/goals";
import type { CurrencyCode } from "@archant/data/money";
import { isCurrencyCode } from "@archant/data/money";

import { DateField } from "@/components/DateField";
import { FieldMessage } from "@/components/FieldMessage";
import { Money } from "@/components/Money";
import { TintedIcon } from "@/components/TintedIcon";
import { ColorPicker, IconPicker } from "@/components/TintPickers";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateGoal, useUpdateGoal } from "@/hooks/useGoals";
import { amountToText } from "@/lib/amount-sign";
import { ApiError } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors, errorAt } from "@/lib/form-errors";

type Link = GoalFormInput["accounts"][number];

const FIELD_NAMES = [
	"name",
	"kind",
	"targetMode",
	"targetAmount",
	"targetMonths",
	"targetDate",
	"color",
	"icon",
	"notes",
	"accounts",
] as const satisfies readonly Path<GoalFormInput>[];

/** Every field an API error may name, each linked account's included. */
function fieldNames(links: readonly Link[]): Path<GoalFormInput>[] {
	return [
		...FIELD_NAMES,
		...links.flatMap((_, index) => [
			`accounts.${index}.accountId` as const,
			`accounts.${index}.allocatedAmount` as const,
		]),
	];
}

const errorId = (path: string) => `goal-${path.replaceAll(".", "-")}-error`;

function blank(): GoalFormInput {
	return {
		name: "",
		kind: "one_off",
		targetMode: "fixed",
		targetAmount: "",
		targetMonths: "",
		targetDate: "",
		color: DEFAULT_GOAL_COLOR,
		icon: DEFAULT_GOAL_ICON,
		notes: "",
		accounts: [],
	};
}

/**
 * The goal as the form shows it. A link to an account no longer offered,
 * deactivated since, is left out: saving drops it, as the server would
 * refuse it.
 */
function valuesOf(goal: GoalData, offered: ReadonlySet<string>): GoalFormInput {
	return {
		name: goal.name,
		kind: goal.kind,
		targetMode: goal.targetMode,
		targetAmount: amountToText(goal.targetAmount, goal.currency),
		targetMonths: goal.targetMonths === null ? "" : String(goal.targetMonths),
		targetDate: goal.targetDate ?? "",
		color: goal.color,
		icon: goal.icon,
		notes: goal.notes ?? "",
		accounts: goal.accounts
			.filter((link) => offered.has(link.accountId))
			.map((link) => ({
				accountId: link.accountId,
				allocatedAmount:
					link.allocatedAmount === null ? "" : amountToText(link.allocatedAmount, goal.currency),
			})),
	};
}

/**
 * What the form sends: a reserve has no date, and only a reserve counts in
 * months of expenses, so what the hidden fields still hold never fails it.
 */
function sent(values: GoalFormInput): GoalFormInput {
	return values.kind === "maintained"
		? { ...values, targetDate: "" }
		: { ...values, targetMode: "fixed" };
}

/** A radio drawn as a card, as `DuplicateDialog`'s, its hint read as its description. */
function RadioCard({
	name,
	value,
	checked,
	label,
	hint,
	onChange,
}: {
	name: string;
	value: string;
	checked: boolean;
	label: string;
	hint?: string;
	onChange: () => void;
}) {
	const id = `${name}-${value}`;

	return (
		<label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-md border px-3 py-2 hover:bg-muted has-checked:border-ring has-checked:bg-muted has-focus-visible:ring-2 has-focus-visible:ring-ring">
			<input
				type="radio"
				name={name}
				value={value}
				checked={checked}
				onChange={onChange}
				aria-labelledby={`${id}-label`}
				{...(hint === undefined ? {} : { "aria-describedby": `${id}-hint` })}
				className="mt-0.5 size-4 shrink-0 accent-primary outline-none"
			/>
			<span className="flex min-w-0 flex-col gap-0.5">
				<span id={`${id}-label`} className="text-sm">
					{label}
				</span>
				{hint !== undefined && (
					<span id={`${id}-hint`} className="text-xs text-muted-foreground">
						{hint}
					</span>
				)}
			</span>
		</label>
	);
}

type GoalDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The goal to edit; absent to create one. Mount a fresh dialog per opening. */
	goal?: GoalData | undefined;
	/** The active accounts that may back a goal, in the order the list shows them. */
	accounts: readonly AccountSummaryData[];
	/** What amounts are read in before an account is ticked. */
	reportingCurrency: CurrencyCode;
};

/**
 * Creates or edits a goal, as Sure's form: a name, a one-off goal or a
 * reserve, a target and, for a one-off goal, an optional date, a colour and
 * an icon, the accounts that hold the money, each ticked with a fixed amount
 * or, left blank, its whole balance, and notes. A reserve's target is an
 * amount or a number of months of expenses, which the server multiplies. A
 * new goal takes its first account's currency; an edited one keeps its own.
 */
export function GoalDialog({
	open,
	onOpenChange,
	goal,
	accounts,
	reportingCurrency,
}: GoalDialogProps) {
	const { t } = useTranslation();
	const createGoal = useCreateGoal();
	const updateGoal = useUpdateGoal(goal?.id ?? "");
	/** The currency amounts are read in: the goal's, else its first account's. */
	const currencyOf = (values: GoalFormInput): CurrencyCode => {
		const code =
			goal?.currency ??
			accounts.find((account) => account.id === values.accounts[0]?.accountId)?.currency;

		return code !== undefined && isCurrencyCode(code) ? code : reportingCurrency;
	};
	// `raw` hands the typed text to the API as is: the same schema parses it
	// there, in the goal's currency. Read through a ref, since that currency
	// follows the accounts ticked.
	const resolve: Resolver<GoalFormInput> = async (values, context, options) =>
		zodResolver(goalSchema(currencyOf(values)), undefined, { raw: true })(
			sent(values),
			context,
			options,
		);
	const resolver = useRef(resolve);
	resolver.current = resolve;
	const form = useForm<GoalFormInput>({
		resolver: async (values, context, options) => resolver.current(values, context, options),
		defaultValues:
			goal === undefined ? blank() : valuesOf(goal, new Set(accounts.map((account) => account.id))),
	});
	const { errors, isSubmitting } = form.formState;
	const color = useController({ control: form.control, name: "color" });
	const icon = useController({ control: form.control, name: "icon" });
	const targetDate = useController({ control: form.control, name: "targetDate" });
	const kind = useController({ control: form.control, name: "kind" });
	const targetMode = useController({ control: form.control, name: "targetMode" });
	const reserve = kind.field.value === "maintained";
	const inMonths = reserve && targetMode.field.value === "months_of_expenses";
	const links = useController({ control: form.control, name: "accounts" });
	const linked = links.field.value;
	// A goal's accounts share its currency: once one is ticked, or for a goal
	// being edited, an account in another currency cannot be.
	const linkedCurrency =
		goal?.currency ??
		accounts.find((account) => linked.some((link) => link.accountId === account.id))?.currency;
	const offered =
		goal === undefined
			? accounts
			: accounts.filter((account) => account.currency === goal.currency);

	const toggle = (accountId: string, checked: boolean) => {
		const next = checked
			? accounts
					.filter(
						(account) =>
							account.id === accountId || linked.some((link) => link.accountId === account.id),
					)
					.map(
						(account) =>
							linked.find((link) => link.accountId === account.id) ?? {
								accountId: account.id,
								allocatedAmount: "",
							},
					)
			: linked.filter((link) => link.accountId !== accountId);

		form.clearErrors("accounts");
		links.field.onChange(next);
	};

	const setAmount = (index: number, allocatedAmount: string) => {
		links.field.onChange(
			linked.map((link, position) => (position === index ? { ...link, allocatedAmount } : link)),
		);
	};

	// The resolver hands `sent`'s values over, so a reserve's date never leaves.
	const submit = form.handleSubmit(async (values) => {
		try {
			if (goal === undefined) {
				const created = await createGoal.mutateAsync(values);
				toast.success(t("goals.form.created", { name: created.name }));
			} else {
				const saved = await updateGoal.mutateAsync(values);
				toast.success(t("goals.form.saved", { name: saved.name }));
			}

			onOpenChange(false);
		} catch (error) {
			const apiError = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR");
			const unplaced = applyFieldErrors(
				apiError.fields,
				fieldNames(values.accounts),
				form.setError,
			);

			if (
				apiError.code !== "VALIDATION_ERROR" ||
				unplaced.length > 0 ||
				apiError.fields.length === 0
			) {
				showErrorToast(apiError.code);
			}
		}
	});

	const described = (path: string) =>
		errorAt(errors, path) === undefined ? {} : { "aria-describedby": errorId(path) };
	const message = (path: string) => (
		<FieldMessage id={errorId(path)} error={errorAt(errors, path)} />
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent showCloseButton={false} className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>
						{t(goal === undefined ? "goals.form.addTitle" : "goals.form.editTitle")}
					</DialogTitle>
					<DialogDescription>{t("goals.form.description")}</DialogDescription>
				</DialogHeader>
				<form
					id="goal-form"
					noValidate
					className="flex flex-col gap-4"
					onSubmit={(event) => void submit(event)}
				>
					<fieldset className="flex flex-col gap-2" {...described("kind")}>
						<legend className="mb-1 text-sm font-medium">{t("goals.form.kind")}</legend>
						<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
							{GOAL_KINDS.map((value: GoalKind) => (
								<RadioCard
									key={value}
									name="goal-kind"
									value={value}
									checked={kind.field.value === value}
									label={t(`goals.form.kinds.${value}.label`)}
									hint={t(`goals.form.kinds.${value}.hint`)}
									onChange={() => kind.field.onChange(value)}
								/>
							))}
						</div>
						{message("kind")}
					</fieldset>

					<div className="flex items-end gap-3">
						{/* Sure's form previews the goal as the cards will draw it. */}
						<div role="img" aria-label={t("goals.form.preview")} className="py-0.5">
							<TintedIcon
								subject={{ kind: "category", color: color.field.value, icon: icon.field.value }}
								size="lg"
							/>
						</div>
						<div className="flex min-w-0 flex-1 flex-col gap-1.5">
							<Label htmlFor="goal-name">{t("goals.form.name")}</Label>
							<Input
								id="goal-name"
								autoComplete="off"
								aria-invalid={errorAt(errors, "name") !== undefined}
								{...described("name")}
								{...form.register("name")}
							/>
						</div>
					</div>
					{message("name")}

					{reserve && (
						<fieldset className="flex flex-col gap-2" {...described("targetMode")}>
							<legend className="mb-1 text-sm font-medium">{t("goals.form.targetMode")}</legend>
							<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
								{GOAL_TARGET_MODES.map((value: GoalTargetMode) => (
									<RadioCard
										key={value}
										name="goal-targetMode"
										value={value}
										checked={targetMode.field.value === value}
										label={t(`goals.form.targetModes.${value}`)}
										onChange={() => targetMode.field.onChange(value)}
									/>
								))}
							</div>
							{message("targetMode")}
						</fieldset>
					)}

					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						{inMonths ? (
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="goal-targetMonths">{t("goals.form.targetMonths")}</Label>
								<Input
									id="goal-targetMonths"
									inputMode="numeric"
									autoComplete="off"
									className="text-right tabular-nums"
									aria-invalid={errorAt(errors, "targetMonths") !== undefined}
									aria-describedby={
										errorAt(errors, "targetMonths") === undefined
											? "goal-targetMonths-hint"
											: `goal-targetMonths-hint ${errorId("targetMonths")}`
									}
									{...form.register("targetMonths")}
								/>
								<p id="goal-targetMonths-hint" className="text-xs text-muted-foreground">
									{t("goals.form.targetMonthsHint")}
								</p>
								{message("targetMonths")}
							</div>
						) : (
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="goal-targetAmount">{t("goals.form.target")}</Label>
								<Input
									id="goal-targetAmount"
									inputMode="decimal"
									autoComplete="off"
									className="text-right tabular-nums"
									aria-invalid={errorAt(errors, "targetAmount") !== undefined}
									{...described("targetAmount")}
									{...form.register("targetAmount")}
								/>
								{message("targetAmount")}
							</div>
						)}
						{!reserve && (
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="goal-targetDate">{t("goals.form.date")}</Label>
								<DateField
									id="goal-targetDate"
									value={targetDate.field.value ?? ""}
									onChange={targetDate.field.onChange}
									onBlur={targetDate.field.onBlur}
									invalid={errorAt(errors, "targetDate") !== undefined}
									{...(errorAt(errors, "targetDate") === undefined
										? {}
										: { describedBy: errorId("targetDate") })}
								/>
								{message("targetDate")}
							</div>
						)}
					</div>

					<fieldset className="flex flex-col gap-2" {...described("accounts")}>
						<legend className="mb-1 text-sm font-medium">{t("goals.form.accounts")}</legend>
						{offered.length === 0 ? (
							<p className="text-sm text-muted-foreground">{t("goals.form.noAccounts")}</p>
						) : (
							<>
								<p className="text-xs text-muted-foreground">{t("goals.form.accountsHint")}</p>
								<ul className="flex flex-col divide-y divide-line rounded-lg border">
									{offered.map((account) => {
										const index = linked.findIndex((link) => link.accountId === account.id);
										const link = linked[index];
										const checkboxId = `goal-account-${account.id}`;
										const accountPath = `accounts.${index}.accountId`;
										const amountPath = `accounts.${index}.allocatedAmount`;

										return (
											<li key={account.id} className="flex flex-col gap-1 px-3 py-2">
												<div className="flex flex-wrap items-center gap-3">
													<Checkbox
														id={checkboxId}
														checked={link !== undefined}
														disabled={
															link === undefined &&
															linkedCurrency !== undefined &&
															account.currency !== linkedCurrency
														}
														onCheckedChange={(checked) => toggle(account.id, checked === true)}
														{...(link === undefined ? {} : described(accountPath))}
													/>
													<Label htmlFor={checkboxId} className="min-w-0 flex-1 font-normal">
														<span className="truncate">{account.name}</span>
														<Money
															amount={account.balance}
															currency={account.currency}
															className="ml-auto font-normal text-muted-foreground"
														/>
													</Label>
													<Input
														aria-label={t("goals.form.amountFor", { name: account.name })}
														placeholder={t("goals.form.wholeBalance")}
														inputMode="decimal"
														autoComplete="off"
														className="w-36 text-right tabular-nums"
														disabled={link === undefined}
														value={link?.allocatedAmount ?? ""}
														aria-invalid={
															link !== undefined && errorAt(errors, amountPath) !== undefined
														}
														{...(link === undefined ? {} : described(amountPath))}
														onChange={(event) => setAmount(index, event.target.value)}
													/>
												</div>
												{link !== undefined && (
													<>
														{message(accountPath)}
														{message(amountPath)}
													</>
												)}
											</li>
										);
									})}
								</ul>
							</>
						)}
						{message("accounts")}
					</fieldset>

					<ColorPicker
						form="goal"
						legend={t("goals.form.color")}
						value={color.field.value}
						onChange={color.field.onChange}
						error={errorAt(errors, "color")}
					/>

					<IconPicker
						form="goal"
						legend={t("goals.form.icon")}
						value={icon.field.value}
						onChange={icon.field.onChange}
						error={errorAt(errors, "icon")}
					/>

					<div className="flex flex-col gap-1.5">
						<Label htmlFor="goal-notes">{t("goals.form.notes")}</Label>
						<Textarea
							id="goal-notes"
							aria-invalid={errorAt(errors, "notes") !== undefined}
							{...described("notes")}
							{...form.register("notes")}
						/>
						{message("notes")}
					</div>
				</form>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
						{t("common.cancel")}
					</Button>
					<Button type="submit" form="goal-form" disabled={isSubmitting}>
						{t(goal === undefined ? "goals.form.create" : "goals.form.save")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
