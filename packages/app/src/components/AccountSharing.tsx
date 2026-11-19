import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { ACCOUNT_PERMISSIONS } from "@archant/data/account-sharing";
import type { AccountPermission } from "@archant/data/account-sharing";

import { ChoiceField } from "@/components/ChoiceField";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api, errorCodeOf, unwrap } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";

export function AccountSharing({ accountId }: { accountId: string }) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const id = useId();
	const queryClient = useQueryClient();
	const param = { id: accountId };
	const endpoint = api.accounts[":id"];
	const queryKey = ["account-sharing", accountId];
	const sharing = useQuery({
		queryKey,
		queryFn: async () => (await unwrap(endpoint.sharing.$get({ param }))).data,
		enabled: open,
	});
	const save = useMutation({
		mutationFn: async (
			change:
				| { userId: string; permission: AccountPermission | null }
				| { includeInFinances: boolean },
		) => {
			if ("includeInFinances" in change) {
				await unwrap(endpoint["finance-inclusion"].$patch({ param, json: change }));
			} else {
				await unwrap(endpoint.sharing.$put({ param, json: change }));
			}
		},
		onSuccess: () => queryClient.invalidateQueries(),
		onError: (error) => showErrorToast(errorCodeOf(error)),
	});
	const members = sharing.data?.members;
	const data = sharing.data;

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="outline">{t("sharing.account")}</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("sharing.account")}</DialogTitle>
				</DialogHeader>
				{sharing.isPending && <p>{t("sharing.loading")}</p>}
				{sharing.isError && <p role="alert">{t(`errors.${errorCodeOf(sharing.error)}`)}</p>}
				{members?.length === 0 && <p>{t("sharing.noMembers")}</p>}
				{members?.map((member) => (
					<div key={member.id} className="flex items-center justify-between gap-4">
						<ChoiceField
							id={`${id}-${member.id}`}
							label={member.name}
							value={member.permission ?? "none"}
							options={[
								{ value: "none", label: t("sharing.none") },
								...ACCOUNT_PERMISSIONS.map((value) => ({
									value,
									label: t(`sharing.accountPermission.${value}`),
								})),
							]}
							disabled={save.isPending}
							onChange={(value) =>
								save.mutate({ userId: member.id, permission: value === "none" ? null : value })
							}
						/>
					</div>
				))}
				{typeof data?.includeInFinances === "boolean" && (
					<div className="flex items-center justify-between gap-4">
						<Label htmlFor={id}>{t("sharing.include")}</Label>
						<Switch
							id={id}
							checked={data.includeInFinances}
							disabled={save.isPending}
							onCheckedChange={(includeInFinances) => save.mutate({ includeInFinances })}
						/>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
