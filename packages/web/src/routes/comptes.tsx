import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { AccountGroups, AccountGroupsSkeleton } from "@/components/AccountGroups";
import { CreateAccountDialog } from "@/components/CreateAccountDialog";
import { Button } from "@/components/ui/button";
import { useAccounts } from "@/hooks/useAccounts";
import { errorCodeOf } from "@/lib/api";

export const Route = createFileRoute("/comptes")({ component: AccountsPage });

function AccountsPage() {
	const { t } = useTranslation();
	const accounts = useAccounts();
	const [creating, setCreating] = useState(false);
	const hasAccounts = accounts.data?.groups.some((group) => group.accounts.length > 0) ?? false;

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("accounts.title"), app: t("app.name") });
	}, [t]);

	return (
		<div className="flex w-full max-w-[1200px] flex-col gap-6 p-6">
			<div className="flex items-center justify-between gap-4">
				<h1 className="text-3xl font-semibold tracking-tight">{t("accounts.title")}</h1>
				{hasAccounts && <Button onClick={() => setCreating(true)}>{t("accounts.add")}</Button>}
			</div>

			{accounts.isPending && <AccountGroupsSkeleton />}

			{accounts.isError && (
				<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-8">
					<p className="text-muted-foreground">{t(`errors.${errorCodeOf(accounts.error)}`)}</p>
					<Button variant="outline" onClick={() => void accounts.refetch()}>
						{t("common.retry")}
					</Button>
				</div>
			)}

			{accounts.data !== undefined && hasAccounts && <AccountGroups list={accounts.data} />}

			{accounts.data !== undefined && !hasAccounts && (
				<div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
					<p className="text-muted-foreground">{t("accounts.empty")}</p>
					<Button onClick={() => setCreating(true)}>{t("accounts.add")}</Button>
				</div>
			)}

			<CreateAccountDialog open={creating} onOpenChange={setCreating} />
		</div>
	);
}
