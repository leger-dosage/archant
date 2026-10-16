import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useUpdateAccount } from "@/hooks/useAccounts";
import { errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";

type ToggledAccount = { id: string; active: boolean; excludedFromReports: boolean };

/**
 * Deactivating and excluding, with the toasts both account menus show. No
 * confirmation for either: nothing is lost, and one click undoes it, as
 * Sure's `toggle_active` and `toggle_exclude_from_reports`.
 */
export function useAccountToggles(account: ToggledAccount) {
	const { t } = useTranslation();
	const updateAccount = useUpdateAccount(account.id);

	const save = async (
		input: { active: boolean } | { excludedFromReports: boolean },
		message: (saved: { name: string; active: boolean; excludedFromReports: boolean }) => string,
	) => {
		try {
			toast.success(message(await updateAccount.mutateAsync(input)));
		} catch (error) {
			showErrorToast(errorCodeOf(error));
		}
	};

	return {
		pending: updateAccount.isPending,
		toggleExcluded: () =>
			save({ excludedFromReports: !account.excludedFromReports }, (saved) =>
				t(saved.excludedFromReports ? "accountActions.excluded" : "accountActions.included", {
					name: saved.name,
				}),
			),
		toggleActive: () =>
			save({ active: !account.active }, (saved) =>
				t(saved.active ? "accountActions.reactivated" : "accountActions.deactivated", {
					name: saved.name,
				}),
			),
	};
}
