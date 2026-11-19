import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { BUDGET_PERMISSIONS } from "@archant/data/account-sharing";
import type { BudgetPermission } from "@archant/data/account-sharing";

import { ChoiceField } from "@/components/ChoiceField";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { useCanWrite } from "@/hooks/usePermissions";
import { api, errorCodeOf, unwrap } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";

const queryKey = ["budget-sharing"];

export function BudgetSharing({
	owner,
	changeOwner,
}: {
	owner: string | undefined;
	changeOwner: (owner: string | undefined) => void;
}) {
	const { t } = useTranslation();
	const id = useId();
	const canWrite = useCanWrite();
	const queryClient = useQueryClient();
	const sharing = useQuery({
		queryKey,
		queryFn: async () => (await unwrap(api.budgets.sharing.$get())).data,
	});
	const share = useMutation({
		mutationFn: async (json: { userId: string; permission: BudgetPermission | null }) =>
			(await unwrap(api.budgets.sharing.$put({ json }))).data,
		onSuccess: (result) => queryClient.setQueryData(queryKey, result),
		onError: (error) => showErrorToast(errorCodeOf(error)),
	});
	const data = sharing.data;
	if (data?.enabled !== true) {
		return null;
	}

	return (
		<div className="flex flex-wrap items-center gap-2">
			<ChoiceField
				id={id}
				label={t("sharing.chooseBudget")}
				value={owner ?? "mine"}
				options={[
					{ value: "mine", label: t("sharing.mine") },
					{ value: "shared", label: t("sharing.household") },
					...data.received.map(({ id: userId, name }) => ({ value: userId, label: name })),
				]}
				onChange={(value) => changeOwner(value === "mine" ? undefined : value)}
			/>
			{canWrite && owner === undefined && (
				<Dialog>
					<DialogTrigger asChild>
						<Button variant="outline">{t("sharing.budget")}</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>{t("sharing.budget")}</DialogTitle>
						</DialogHeader>
						{data.members.length === 0 && <p>{t("sharing.noMembers")}</p>}
						{data.members.map((member) => (
							<div key={member.id} className="flex items-center justify-between gap-4">
								<ChoiceField
									id={`${id}-${member.id}`}
									label={member.name}
									value={member.permission ?? "none"}
									options={[
										{ value: "none", label: t("sharing.none") },
										...BUDGET_PERMISSIONS.map((value) => ({
											value,
											label: t(`sharing.budgetPermission.${value}`),
										})),
									]}
									disabled={share.isPending}
									onChange={(value) =>
										share.mutate({ userId: member.id, permission: value === "none" ? null : value })
									}
								/>
							</div>
						))}
					</DialogContent>
				</Dialog>
			)}
		</div>
	);
}
