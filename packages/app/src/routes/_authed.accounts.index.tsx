import { createFileRoute } from "@tanstack/react-router";
import { LandmarkIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { AccountGroups, AccountGroupsSkeleton } from "@/components/AccountGroups";
import { EmptyState } from "@/components/EmptyState";
import { LazyCreateAccountDialog } from "@/components/LazyCreateAccountDialog";
import { Page } from "@/components/Page";
import { Button } from "@/components/ui/button";
import { useAccounts } from "@/hooks/useAccounts";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { errorCodeOf } from "@/lib/api";

export const Route = createFileRoute("/_authed/accounts/")({
	component: AccountsPage,
});

function AccountsPage() {
	const { t } = useTranslation();
	const accounts = useAccounts();
	const admin = useIsAdmin();
	const [creatingAccount, setCreatingAccount] = useState(false);
	const hasAccounts = accounts.data?.groups.some((group) => group.accounts.length > 0) ?? false;

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("accounts.title"), app: t("app.name") });
	}, [t]);

	return (
		<Page
			title={t("accounts.title")}
			actions={
				hasAccounts && admin ? (
					<Button onClick={() => setCreatingAccount(true)}>{t("accounts.add")}</Button>
				) : undefined
			}
		>
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
				<EmptyState
					level={2}
					icon={{ kind: "transfer", icon: LandmarkIcon }}
					title={t("accounts.empty.title")}
					description={t("accounts.empty.description")}
					action={
						admin ? (
							<Button onClick={() => setCreatingAccount(true)}>{t("accounts.add")}</Button>
						) : null
					}
				/>
			)}
			{admin && (
				<LazyCreateAccountDialog open={creatingAccount} onOpenChange={setCreatingAccount} />
			)}
		</Page>
	);
}
