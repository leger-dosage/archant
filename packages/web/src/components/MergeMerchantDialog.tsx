import type { MerchantData } from "@/hooks/useMerchants";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { MerchantCombobox } from "@/components/MerchantCombobox";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMergeMerchant } from "@/hooks/useMerchants";
import { errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";

type MergeMerchantDialogProps = {
	merchant: MerchantData;
	merchants: readonly MerchantData[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

/**
 * Merges a merchant into another, picked from the same combobox as the rows,
 * without « Sans marchand » nor « Créer »: a merge needs an existing target.
 */
export function MergeMerchantDialog({
	merchant,
	merchants,
	open,
	onOpenChange,
}: MergeMerchantDialogProps) {
	const { t } = useTranslation();
	const mergeMerchant = useMergeMerchant();
	const [targetId, setTargetId] = useState<string | null>(null);
	const [picking, setPicking] = useState(false);
	const count = merchant.transactionCount;
	const target = merchants.find((other) => other.id === targetId && other.id !== merchant.id);

	useEffect(() => {
		if (open) {
			setTargetId(null);
		}
	}, [open]);

	const confirm = () => {
		if (target === undefined) {
			return;
		}

		mergeMerchant.mutate(
			{ id: merchant.id, targetId: target.id },
			{
				onSuccess: () => {
					toast.success(
						t("merchants.mergeDialog.merged", { name: merchant.name, target: target.name }),
					);
					onOpenChange(false);
				},
				onError: (error) => showErrorToast(errorCodeOf(error)),
			},
		);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>{t("merchants.mergeDialog.title", { name: merchant.name })}</DialogTitle>
					<DialogDescription>
						{count === 0
							? t("merchants.mergeDialog.descriptionNone", { name: merchant.name })
							: t("merchants.mergeDialog.description", { count, name: merchant.name })}
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="merge-merchant-target">{t("merchants.mergeDialog.target")}</Label>
					<Popover open={picking} onOpenChange={setPicking}>
						<PopoverTrigger asChild>
							<Button
								id="merge-merchant-target"
								type="button"
								variant="outline"
								className="w-full justify-start font-normal"
							>
								<span className={target === undefined ? "text-muted-foreground" : "truncate"}>
									{target?.name ?? t("merchants.mergeDialog.placeholder")}
								</span>
							</Button>
						</PopoverTrigger>
						<PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
							<MerchantCombobox
								merchants={merchants}
								value={targetId}
								mode="target"
								exclude={merchant.id}
								onSelect={(id) => {
									setTargetId(id);
									setPicking(false);
								}}
							/>
						</PopoverContent>
					</Popover>
				</div>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
						{t("common.cancel")}
					</Button>
					<Button
						type="button"
						disabled={target === undefined || mergeMerchant.isPending}
						onClick={confirm}
					>
						{t("merchants.mergeDialog.action")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
