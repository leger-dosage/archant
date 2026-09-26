import type { BankConnectionAlert, BankConnectionData } from "@/hooks/useBankConnections";

import { Link } from "@tanstack/react-router";
import { Loader2Icon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
	useBankConnections,
	useBankSetup,
	useRenewBankConnection,
} from "@/hooks/useBankConnections";
import { showFailureToast } from "@/lib/error-toast";

const alertDate = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" });

/**
 * Keyed by connection and alert: closing the expiring banner does not hide
 * the expired one that follows, nor the same banner of another bank.
 */
const storageKey = (connection: BankConnectionData, alert: BankConnectionAlert) =>
	`archant.bank-alert.${connection.id}.${alert}`;

// Session storage, not local: a banner closed today must come back tomorrow,
// as long as its cause stays.
function isDismissed(key: string): boolean {
	try {
		return sessionStorage.getItem(key) === "dismissed";
	} catch {
		return false;
	}
}

function remember(key: string) {
	try {
		sessionStorage.setItem(key, "dismissed");
	} catch {
		// Still hidden until the page reloads.
	}
}

function AlertStrip({
	connection,
	alert,
	onDismiss,
}: {
	connection: BankConnectionData;
	alert: BankConnectionAlert;
	onDismiss: () => void;
}) {
	const { t } = useTranslation();
	const renew = useRenewBankConnection();
	const bank = connection.institutionName;
	const date =
		alert === "consent_expiring" && connection.consentExpiresAt !== null
			? alertDate.format(new Date(connection.consentExpiresAt))
			: alert === "sync_stale" && connection.lastSyncedAt !== null
				? alertDate.format(new Date(connection.lastSyncedAt))
				: "";

	const renewNow = () => {
		renew.mutate(connection.id, {
			onSuccess: ({ url }) => window.location.assign(url),
			onError: showFailureToast,
		});
	};

	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
			<TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
			<p className="min-w-0 flex-1">{t(`banks.alerts.${alert}`, { bank, date })}</p>
			{alert === "sync_stale" ? (
				<Button asChild variant="outline" size="sm">
					<Link to="/settings/banks/$connectionId" params={{ connectionId: connection.id }}>
						{t("banks.alerts.view")}
					</Link>
				</Button>
			) : (
				<Button
					variant="outline"
					size="sm"
					disabled={renew.isPending}
					aria-busy={renew.isPending}
					onClick={renewNow}
				>
					{renew.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
					{t(alert === "consent_expired" ? "banks.alerts.reconnect" : "banks.alerts.renew")}
				</Button>
			)}
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={t("banks.alerts.dismiss", { bank })}
				onClick={onDismiss}
			>
				<XIcon aria-hidden />
			</Button>
		</div>
	);
}

/**
 * One warning strip per bank connection that needs the user, above every
 * page: a consent about to end, one that ended, a sync that stopped. The
 * server decides which; closing one hides it until the browser session ends.
 */
export function BankAlerts() {
	const { t } = useTranslation();
	const setup = useBankSetup();
	const connections = useBankConnections(setup.data?.available === true);
	const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
	const shown = (connections.data ?? []).flatMap((connection) => {
		if (connection.alert === null) {
			return [];
		}

		const key = storageKey(connection, connection.alert);

		return closed.has(key) || isDismissed(key) ? [] : [{ connection, alert: connection.alert }];
	});

	if (shown.length === 0) {
		return null;
	}

	return (
		<section aria-label={t("banks.alerts.label")} className="flex flex-col gap-2 px-6 pt-4">
			{shown.map(({ connection, alert }) => (
				<AlertStrip
					key={`${connection.id}.${alert}`}
					connection={connection}
					alert={alert}
					onDismiss={() => {
						const key = storageKey(connection, alert);

						remember(key);
						setClosed((current) => new Set([...current, key]));
					}}
				/>
			))}
		</section>
	);
}
