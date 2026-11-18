import type { GoalData } from "@/hooks/useGoals";
import type { FormEvent } from "react";

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { balanceTypeOf } from "@archant/data/account-types";
import { parseAmount, toMinorUnits } from "@archant/data/money";

import { FieldMessage } from "@/components/FieldMessage";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateGoalPledge } from "@/hooks/useGoals";
import { ApiError, errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { formatMoney } from "@/lib/format-money";
import { formatWholePercent } from "@/lib/percent";

export function GoalPledgeDialog({ goal }: { goal: GoalData }) {
	const { t } = useTranslation();
	const fieldId = useId();
	const create = useCreateGoalPledge(goal.id);
	const [open, setOpen] = useState(false);
	const [amount, setAmount] = useState("");
	const linkedAccounts = goal.accounts.filter((account) => account.active);
	const [accountId, setAccountId] = useState(linkedAccounts[0]?.accountId ?? "");

	if (goal.state !== "active" || linkedAccounts.length === 0) {
		return null;
	}

	const transfer = goal.accounts.some(
		(account) => account.bankLinked || balanceTypeOf(account.type) === "investment",
	);
	const title = t(transfer ? "goals.pledge.transfer" : "goals.pledge.save");
	const minorAmount = parseAmount(amount, goal.currency);
	const validAmount = minorAmount !== null && minorAmount > 0;
	const selected =
		linkedAccounts.find((account) => account.accountId === accountId) ?? linkedAccounts[0];
	const total = toMinorUnits(goal.saved + (validAmount ? minorAmount : 0));
	const percent = formatWholePercent(Math.min(100, Math.round((total / goal.targetAmount) * 100)));
	const money = (value: GoalData["saved"]) =>
		formatMoney({ amount: value, currency: goal.currency });

	const apiError = create.error instanceof ApiError ? create.error : null;
	const fieldError = (path: string) => {
		const issue = apiError?.fields.find((field) => field.path === path);

		return issue === undefined ? undefined : { type: issue.code };
	};
	const amountError = fieldError("amount");
	const accountError = fieldError("accountId");

	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();

		if (!validAmount || selected === undefined || create.isPending) {
			return;
		}

		try {
			await create.mutateAsync({ amount, accountId: selected.accountId });
			setOpen(false);
		} catch (error) {
			if (
				!(error instanceof ApiError && error.code === "VALIDATION_ERROR" && error.fields.length > 0)
			) {
				showErrorToast(errorCodeOf(error));
			}
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (create.isPending) {
					return;
				}
				if (next) {
					create.reset();
					setAmount("");
					setAccountId(linkedAccounts[0]?.accountId ?? "");
				}
				setOpen(next);
			}}
		>
			<DialogTrigger asChild>
				<Button variant="outline">{title}</Button>
			</DialogTrigger>
			<DialogContent showCloseButton={false} aria-describedby={undefined}>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
				</DialogHeader>
				<form className="grid gap-4" onSubmit={(event) => void submit(event)}>
					<div className="grid gap-2">
						<Label htmlFor={`${fieldId}-amount`}>{t("goals.pledge.amount")}</Label>
						<Input
							id={`${fieldId}-amount`}
							value={amount}
							onChange={(event) => setAmount(event.target.value)}
							inputMode="decimal"
							required
							aria-invalid={amountError !== undefined}
							aria-describedby={amountError === undefined ? undefined : `${fieldId}-amount-error`}
						/>
						<FieldMessage id={`${fieldId}-amount-error`} error={amountError} />
					</div>
					<div className="grid gap-2">
						<Label htmlFor={`${fieldId}-account`}>{t("goals.pledge.account")}</Label>
						<select
							id={`${fieldId}-account`}
							value={selected?.accountId ?? ""}
							onChange={(event) => setAccountId(event.target.value)}
							className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-ring"
							aria-invalid={accountError !== undefined}
							aria-describedby={accountError === undefined ? undefined : `${fieldId}-account-error`}
						>
							{linkedAccounts.map((account) => (
								<option key={account.accountId} value={account.accountId}>
									{account.name}
								</option>
							))}
						</select>
						<FieldMessage id={`${fieldId}-account-error`} error={accountError} />
					</div>
					{validAmount && (
						<p className="text-muted-foreground" role="status">
							{t("goals.pledge.preview", {
								percent,
								newTotal: money(total),
								target: money(goal.targetAmount),
							})}
						</p>
					)}
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline" disabled={create.isPending}>
								{t("common.cancel")}
							</Button>
						</DialogClose>
						<Button type="submit" disabled={!validAmount || create.isPending}>
							{t("goals.pledge.record")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
