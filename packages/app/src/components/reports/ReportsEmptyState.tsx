import { ChartColumnIcon } from "lucide-react";
import { Suspense, lazy, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { EmptyState } from "@/components/EmptyState";
import { LazyCreateAccountDialog } from "@/components/LazyCreateAccountDialog";
import { Button } from "@/components/ui/button";
import { useAccounts } from "@/hooks/useAccounts";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { accountChoiceOf } from "@/lib/account-choice";

const TransactionSheet = lazy(async () => ({
	default: (await import("@/components/TransactionSheet")).TransactionSheet,
}));

/**
 * Sure's `_empty_state`, while the household holds no transaction: « Ajouter
 * une transaction » opens the sheet the operations list opens, once an
 * account can take it, and « Ajouter un compte » the account dialog. A
 * viewer, who adds neither, reads the sentence alone.
 */
export function ReportsEmptyState() {
	const { t } = useTranslation();
	const admin = useIsAdmin();
	const accounts = useAccounts();
	const [adding, setAdding] = useState(false);
	const [sheetMounted, setSheetMounted] = useState(false);
	const [creatingAccount, setCreatingAccount] = useState(false);
	const choice = useMemo(
		() => (accounts.data === undefined ? null : accountChoiceOf(accounts.data)),
		[accounts.data],
	);
	const canAddTransaction = choice !== null && choice.accounts.length > 0;

	return (
		<>
			<EmptyState
				labelled
				level={2}
				icon={{ kind: "transfer", icon: ChartColumnIcon }}
				title={t("reports.emptyState.title")}
				description={t("reports.emptyState.description")}
				action={
					admin ? (
						<div className="flex flex-wrap justify-center gap-3">
							{canAddTransaction && (
								<Button
									onClick={() => {
										setSheetMounted(true);
										setAdding(true);
									}}
								>
									{t("reports.emptyState.addTransaction")}
								</Button>
							)}
							<Button variant="outline" onClick={() => setCreatingAccount(true)}>
								{t("reports.emptyState.addAccount")}
							</Button>
						</div>
					) : null
				}
			/>
			{admin && sheetMounted && choice !== null && (
				<Suspense fallback={null}>
					<TransactionSheet
						account={choice}
						open={adding}
						transaction={null}
						onOpenChange={setAdding}
					/>
				</Suspense>
			)}
			{admin && (
				<LazyCreateAccountDialog open={creatingAccount} onOpenChange={setCreatingAccount} />
			)}
		</>
	);
}
