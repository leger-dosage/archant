import { useTranslation } from "react-i18next";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ConfirmDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	/** What will be lost, stated plainly (EXPERIENCE.md). */
	description: string;
	/** Repeats the verb of the action: « Supprimer », « Abandonner ». */
	confirmLabel: string;
	/** « Annuler » unless the choice is a postponement, as « Plus tard ». */
	cancelLabel?: string | undefined;
	onConfirm: () => void;
	destructive?: boolean;
	pending?: boolean;
};

/**
 * The one confirmation layer. Radix's alert dialog puts the initial focus on
 * Annuler, so a stray `Enter` never confirms a destructive action.
 */
export function ConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel,
	cancelLabel,
	onConfirm,
	destructive = false,
	pending = false,
}: ConfirmDialogProps) {
	const { t } = useTranslation();

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>{description}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>{cancelLabel ?? t("common.cancel")}</AlertDialogCancel>
					<AlertDialogAction
						variant={destructive ? "destructive" : "default"}
						disabled={pending}
						onClick={(event) => {
							// The caller closes it once the action has run.
							event.preventDefault();
							onConfirm();
						}}
					>
						{confirmLabel}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
