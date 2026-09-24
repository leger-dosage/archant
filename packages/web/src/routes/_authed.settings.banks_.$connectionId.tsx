import type { BankAccountData, BankAccountLink } from "@/hooks/useBankConnections";
import type { AccountKindId } from "@/lib/account-kinds";

import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { BANK_ACCOUNT_TARGETS } from "@archant/data/account-types";

import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	useBankAccounts,
	useBankConnections,
	useLinkBankAccounts,
} from "@/hooks/useBankConnections";
import { kindOf } from "@/lib/account-kinds";
import { errorCodeOf } from "@/lib/api";
import { showFailureToast } from "@/lib/error-toast";

// `banks_`: a page of its own under the settings layout, as the return page.
export const Route = createFileRoute("/_authed/settings/banks_/$connectionId")({
	component: BankConnectionPage,
});

const SKIP = "skip";

/** What a new account from the bank can be, in Sure's map order. */
const TARGETS = BANK_ACCOUNT_TARGETS.map((target) => ({
	...target,
	kind: kindOf(target.type, target.subtype),
}));

/** A select's value: `skip`, `create:<kind>` or `link:<account id>`. */
type Choice = string;

function defaultChoice(row: BankAccountData): Choice {
	return row.suggestion === null
		? SKIP
		: `create:${kindOf(row.suggestion.type, row.suggestion.subtype)}`;
}

/** The link a choice asks for, `null` for a skipped row. */
function linkOf(row: BankAccountData, choice: Choice): BankAccountLink | null {
	if (choice.startsWith("link:")) {
		return { bankAccountId: row.id, action: "link", accountId: choice.slice("link:".length) };
	}

	const target = TARGETS.find((item) => `create:${item.kind}` === choice);

	return target === undefined
		? null
		: { bankAccountId: row.id, action: "create", type: target.type, subtype: target.subtype };
}

function BankAccountRow({
	row,
	choice,
	onChoose,
}: {
	row: BankAccountData;
	choice: Choice;
	onChoose: (choice: Choice) => void;
}) {
	const { t } = useTranslation();
	const kindLabel = (kind: AccountKindId) => t(`accounts.subtypes.${kind}`);

	return (
		<li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="truncate font-medium">{row.name}</span>
				<span className="flex items-center gap-2 text-sm text-muted-foreground">
					{row.ibanLast4 !== null && (
						<code className="font-mono text-[13px]">•••• {row.ibanLast4}</code>
					)}
					<span>{row.currency}</span>
				</span>
			</div>
			{row.account === null ? (
				<Select value={choice} onValueChange={onChoose}>
					<SelectTrigger
						aria-label={t("banks.accounts.choice", { name: row.name })}
						className="w-full sm:w-64"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={SKIP}>{t("banks.accounts.skip")}</SelectItem>
						<SelectGroup>
							<SelectLabel>{t("banks.accounts.create")}</SelectLabel>
							{TARGETS.map((target) => (
								<SelectItem key={target.kind} value={`create:${target.kind}`}>
									{t("banks.accounts.createAs", { type: kindLabel(target.kind) })}
								</SelectItem>
							))}
						</SelectGroup>
						{row.candidates.length > 0 && (
							<SelectGroup>
								<SelectLabel>{t("banks.accounts.linkTo")}</SelectLabel>
								{row.candidates.map((candidate) => (
									<SelectItem key={candidate.id} value={`link:${candidate.id}`}>
										{candidate.name}
									</SelectItem>
								))}
							</SelectGroup>
						)}
					</SelectContent>
				</Select>
			) : (
				<span className="text-sm">
					{t("banks.accounts.linkedTo")}{" "}
					<Link
						to="/accounts/$accountId"
						params={{ accountId: row.account.id }}
						className="font-medium underline underline-offset-4"
					>
						{row.account.name}
					</Link>
				</span>
			)}
		</li>
	);
}

/**
 * Sure's `setup_accounts`: each bank account the consent shares, skipped,
 * turned into a new account, or linked to an existing one, whose balance
 * then comes from the bank.
 */
function BankConnectionPage() {
	const { t } = useTranslation();
	const { connectionId } = Route.useParams();
	const connections = useBankConnections(true);
	const accounts = useBankAccounts(connectionId);
	const link = useLinkBankAccounts(connectionId);
	// Only the rows the user changed: the others follow their suggestion.
	const [choices, setChoices] = useState<Record<string, Choice>>({});
	const connection = connections.data?.find((item) => item.id === connectionId);
	const title = connection?.institutionName ?? t("banks.title");
	const rows = accounts.data ?? [];
	const choiceOf = (row: BankAccountData) => choices[row.id] ?? defaultChoice(row);
	const links = rows
		.filter((row) => row.account === null)
		.flatMap((row) => {
			const chosen = linkOf(row, choiceOf(row));

			return chosen === null ? [] : [chosen];
		});

	useEffect(() => {
		document.title = t("app.pageTitle", { page: title, app: t("app.name") });
	}, [t, title]);

	const submit = () => {
		link.mutate(links, {
			onSuccess: () => {
				setChoices({});
				toast.success(t("banks.accounts.linked", { count: links.length }));
			},
			onError: showFailureToast,
		});
	};

	return (
		<div className="flex max-w-2xl flex-col gap-6">
			<div className="flex flex-col gap-1">
				<h2 className="text-lg font-semibold">{title}</h2>
				<p className="text-sm text-muted-foreground">{t("banks.accounts.description")}</p>
			</div>

			{accounts.isPending && (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-16 w-full" />
					<Skeleton className="h-16 w-full" />
				</div>
			)}

			{accounts.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-6">
					<p className="text-muted-foreground">
						{errorCodeOf(accounts.error) === "NOT_FOUND"
							? t("banks.accounts.notFound")
							: t(`errors.${errorCodeOf(accounts.error)}`)}
					</p>
					<Link to="/settings/banks" className="text-sm font-medium underline underline-offset-4">
						{t("banks.return.back")}
					</Link>
				</div>
			)}

			{accounts.data !== undefined &&
				(rows.length === 0 ? (
					<p className="text-sm text-muted-foreground">{t("banks.accounts.empty")}</p>
				) : (
					<form
						className="flex flex-col items-start gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							submit();
						}}
					>
						<ul aria-label={t("banks.accounts.list")} className="w-full divide-y rounded-lg border">
							{rows.map((row) => (
								<BankAccountRow
									key={row.id}
									row={row}
									choice={choiceOf(row)}
									onChoose={(choice) => setChoices((current) => ({ ...current, [row.id]: choice }))}
								/>
							))}
						</ul>
						{rows.some((row) => row.account === null) && (
							<Button type="submit" disabled={link.isPending || links.length === 0}>
								{t("banks.accounts.submit")}
							</Button>
						)}
					</form>
				))}
		</div>
	);
}
