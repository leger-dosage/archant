import type { GoalData } from "@/hooks/useGoals";

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { GoalSpend } from "@archant/api/schemas/goals";

import { Money } from "@/components/Money";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useGoalOutflows, useSpendGoal } from "@/hooks/useGoals";
import { ApiError } from "@/lib/api";
import { formatShortDate } from "@/lib/balance-change";
import { errorMessage } from "@/lib/error-toast";

export function GoalSpending({ goal }: { goal: GoalData }) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const [amount, setAmount] = useState("");
	const [accountId, setAccountId] = useState<string>();
	const [failure, setFailure] = useState<string>();
	const amountId = useId();
	const accountFieldId = useId();
	const { accounts } = goal;
	const outflows = useGoalOutflows(goal.id);
	const spend = useSpendGoal(goal.id);

	function changeOpen(next: boolean) {
		setOpen(next);

		if (next) {
			setAmount("");
			setAccountId(undefined);
			setFailure(undefined);
		}
	}

	async function save(input: GoalSpend) {
		setFailure(undefined);

		try {
			await spend.mutateAsync(input);
			setOpen(false);
			toast.success(t("goals.spend.success"));
		} catch (error) {
			const reason =
				error instanceof ApiError && error.code === "GOAL_SPEND_REFUSED"
					? error.params["reason"]
					: undefined;
			const message =
				reason === undefined
					? errorMessage(error)
					: t(`goals.spend.errors.${reason}`, { defaultValue: errorMessage(error) });

			if ("entryId" in input) {
				toast.error(message);
			} else {
				setFailure(message);
			}
		}
	}

	return (
		<>
			{goal.saved > 0 && goal.consumedAmount < goal.targetAmount && (
				<div>
					<Button variant="outline" disabled={spend.isPending} onClick={() => changeOpen(true)}>
						{t("goals.spend.open")}
					</Button>
				</div>
			)}
			{outflows.isError && (
				<div className="flex items-center gap-2" role="alert">
					<span>{errorMessage(outflows.error)}</span>
					<Button variant="outline" onClick={() => void outflows.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}
			{outflows.data !== undefined && outflows.data.length > 0 && (
				<Section title={t("goals.spend.outflows")}>
					<ul className="divide-y divide-line">
						{outflows.data.map((outflow) => (
							<li
								key={outflow.id}
								className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
							>
								<div>
									<p>{outflow.label}</p>
									<p className="text-sm text-muted-foreground">
										{accounts.find((account) => account.accountId === outflow.accountId)?.name}
										{" · "}
										{formatShortDate(outflow.date)}
									</p>
								</div>
								<div className="flex items-center gap-3">
									<Money amount={outflow.amount} currency={goal.currency} />
									<Button
										variant="outline"
										disabled={spend.isPending}
										onClick={() => void save({ entryId: outflow.id })}
									>
										{t("goals.spend.claim")}
									</Button>
								</div>
							</li>
						))}
					</ul>
				</Section>
			)}
			<Dialog open={open} onOpenChange={changeOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("goals.spend.title")}</DialogTitle>
						<DialogDescription>{goal.name}</DialogDescription>
					</DialogHeader>
					<form
						className="grid gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							void save({ amount, ...(accountId === undefined ? {} : { accountId }) });
						}}
					>
						<div className="grid gap-2">
							<Label htmlFor={amountId}>{t("goals.spend.amount")}</Label>
							<Input
								id={amountId}
								inputMode="decimal"
								value={amount}
								onChange={(event) => setAmount(event.target.value)}
							/>
						</div>
						{accounts.length > 1 && (
							<div className="grid gap-2">
								<Label htmlFor={accountFieldId}>{t("goals.spend.account")}</Label>
								<Select value={accountId ?? ""} onValueChange={setAccountId}>
									<SelectTrigger id={accountFieldId} className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{accounts.map((account) => (
											<SelectItem key={account.accountId} value={account.accountId}>
												{account.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						)}
						{failure !== undefined && (
							<p role="alert" className="text-sm text-destructive">
								{failure}
							</p>
						)}
						<DialogFooter>
							<Button variant="outline" type="button" onClick={() => changeOpen(false)}>
								{t("common.cancel")}
							</Button>
							<Button type="submit" disabled={spend.isPending}>
								{t("goals.spend.submit")}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}
