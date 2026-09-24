import type {
	BankAccountData,
	BankAccountLink,
	BankConnectionData,
} from "@/hooks/useBankConnections";
import type { AccountKindId } from "@/lib/account-kinds";

import { useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2Icon, RefreshCwIcon, UnplugIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";

import { BANK_ACCOUNT_TARGETS } from "@archant/data/account-types";

import { ConfirmDialog } from "@/components/ConfirmDialog";
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
	useDisconnectBankConnection,
	useLinkBankAccounts,
	useRenewBankConnection,
	useSyncBankConnection,
} from "@/hooks/useBankConnections";
import { kindOf } from "@/lib/account-kinds";
import { errorCodeOf, isErrorCode } from "@/lib/api";
import { showFailureToast } from "@/lib/error-toast";
import { queryKeys } from "@/lib/query-keys";

// `sync`: set by the return page, so a renewed consent syncs once on arrival.
const searchSchema = z.object({ sync: z.boolean().optional().catch(undefined) });

// `banks_`: a page of its own under the settings layout, as the return page.
export const Route = createFileRoute("/_authed/settings/banks_/$connectionId")({
	validateSearch: searchSchema,
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

const JUST_NOW_MS = 60_000;

const syncTime = new Intl.DateTimeFormat("fr-FR", {
	day: "numeric",
	month: "long",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
});

/**
 * The connection's last successful sync and latest error, with its
 * « Synchroniser » button. A click while a sync runs is refused as the server
 * would refuse it, without asking again.
 */
function SyncStatus({
	connection,
	sync,
}: {
	connection: BankConnectionData;
	sync: ReturnType<typeof useSyncBankConnection>;
}) {
	const { t } = useTranslation();
	const { lastSyncedAt, lastError } = connection;

	const start = () => {
		if (sync.isPending) {
			toast.error(t("errors.SYNC_IN_PROGRESS"));
			return;
		}

		sync.mutate(undefined, {
			onSuccess: (status) => {
				if (status.lastError === null) {
					toast.success(t("banks.sync.done"));
				} else {
					toast.error(t("banks.sync.failed"));
				}
			},
			onError: showFailureToast,
		});
	};

	return (
		<div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center">
			<div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
				<p>
					{lastSyncedAt === null
						? t("banks.sync.never")
						: t("banks.sync.last", {
								when:
									Date.now() - lastSyncedAt < JUST_NOW_MS
										? t("banks.sync.justNow")
										: syncTime.format(new Date(lastSyncedAt)),
							})}
				</p>
				{lastError !== null && (
					<p role="status" className="text-destructive">
						{t("banks.sync.lastError", {
							error: t(`errors.${isErrorCode(lastError) ? lastError : "INTERNAL_ERROR"}`),
						})}
					</p>
				)}
			</div>
			<Button
				variant="outline"
				onClick={start}
				aria-disabled={sync.isPending}
				aria-busy={sync.isPending}
			>
				{sync.isPending ? (
					<Loader2Icon className="animate-spin" aria-hidden />
				) : (
					<RefreshCwIcon aria-hidden />
				)}
				{t("banks.sync.submit")}
			</Button>
		</div>
	);
}

/**
 * Sure's `reauthorize` and `destroy`: a new consent at the bank, the same
 * connection coming back; or the connection gone, its accounts kept as
 * manual ones after a confirmation that says so.
 */
function ConnectionActions({
	connection,
	linkedCount,
	disconnect,
	onDisconnect,
}: {
	connection: BankConnectionData;
	linkedCount: number;
	disconnect: ReturnType<typeof useDisconnectBankConnection>;
	/** `onFailure` closes the confirmation; on success the page leaves. */
	onDisconnect: (onFailure: () => void) => void;
}) {
	const { t } = useTranslation();
	const renew = useRenewBankConnection();
	const [confirming, setConfirming] = useState(false);
	const bank = connection.institutionName;

	const renewNow = () => {
		renew.mutate(connection.id, {
			onSuccess: ({ url }) => window.location.assign(url),
			onError: showFailureToast,
		});
	};

	return (
		<div className="flex flex-wrap gap-2">
			<Button
				variant="outline"
				disabled={renew.isPending}
				aria-busy={renew.isPending}
				onClick={renewNow}
			>
				{renew.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
				{t("banks.renew")}
			</Button>
			<Button variant="outline" onClick={() => setConfirming(true)}>
				<UnplugIcon aria-hidden />
				{t("banks.disconnect.submit")}
			</Button>
			<ConfirmDialog
				open={confirming}
				onOpenChange={setConfirming}
				title={t("banks.disconnect.title", { bank })}
				description={t("banks.disconnect.description", { count: linkedCount })}
				confirmLabel={t("banks.disconnect.submit")}
				onConfirm={() => onDisconnect(() => setConfirming(false))}
				destructive
				pending={disconnect.isPending}
			/>
		</div>
	);
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
	const { sync: syncOnArrival } = Route.useSearch();
	const navigate = useNavigate();
	const connections = useBankConnections(true);
	const accounts = useBankAccounts(connectionId);
	const link = useLinkBankAccounts(connectionId);
	const sync = useSyncBankConnection(connectionId);
	// Here rather than in the actions, which go with the connection: the
	// answer still has to reach this page to leave it.
	const disconnect = useDisconnectBankConnection();
	const queryClient = useQueryClient();
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

	const linkedCount = rows.filter((row) => row.account !== null).length;
	// Once per arrival: strict mode's second effect must not sync again.
	const arrived = useRef(false);
	const { mutate: syncNow } = sync;

	useEffect(() => {
		document.title = t("app.pageTitle", { page: title, app: t("app.name") });
	}, [t, title]);

	// Back from the bank. A renewed consent syncs once, as a new link does, so
	// the page shows it works; a new connection has nothing linked to read.
	useEffect(() => {
		if (syncOnArrival !== true || accounts.data === undefined || arrived.current) {
			return;
		}

		arrived.current = true;
		void navigate({
			to: "/settings/banks/$connectionId",
			params: { connectionId },
			search: {},
			replace: true,
		});

		if (accounts.data.some((row) => row.account !== null)) {
			syncNow(undefined, {
				onError: (error) => {
					if (!["SYNC_TOO_RECENT", "SYNC_IN_PROGRESS"].includes(errorCodeOf(error))) {
						showFailureToast(error);
					}
				},
			});
		}
	}, [syncOnArrival, accounts.data, connectionId, navigate, syncNow]);

	const disconnectNow = (bank: string, onFailure: () => void) => {
		disconnect.mutate(connectionId, {
			onSuccess: () => {
				toast.success(t("banks.disconnect.done", { bank }));
				void navigate({ to: "/settings/banks", replace: true }).then(() =>
					queryClient.removeQueries({ queryKey: queryKeys.bankConnections.accounts(connectionId) }),
				);
			},
			onError: (error) => {
				onFailure();
				showFailureToast(error);
			},
		});
	};

	const submit = () => {
		link.mutate(links, {
			onSuccess: () => {
				setChoices({});
				toast.success(t("banks.accounts.linked", { count: links.length }));
				// Sure's `complete_account_setup`: the new links bring their history
				// at once. Quiet on success, and when a sync ran within the hour:
				// the new link then waits for the next one, as the page shows.
				sync.mutate(undefined, {
					onError: (error) => {
						if (!["SYNC_TOO_RECENT", "SYNC_IN_PROGRESS"].includes(errorCodeOf(error))) {
							showFailureToast(error);
						}
					},
				});
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

			{connection !== undefined && <SyncStatus connection={connection} sync={sync} />}

			{connection !== undefined && (
				<ConnectionActions
					connection={connection}
					linkedCount={linkedCount}
					disconnect={disconnect}
					onDisconnect={(onFailure) => disconnectNow(connection.institutionName, onFailure)}
				/>
			)}

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
