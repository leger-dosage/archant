import type { TagData } from "@/hooks/useTags";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ChoiceField } from "@/components/ChoiceField";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useDeleteTag } from "@/hooks/useTags";
import { errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";

// Radix Select refuses an empty value, so Sure's blank prompt needs a token.
const NONE = "none";

type DeleteTagDialogProps = {
	tag: TagData;
	tags: readonly TagData[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

/**
 * Sure's `tag/deletions/new.html.erb`, for a tag some transactions carry:
 * « Sélectionnez l'étiquette » picks a replacement, which « Supprimer et
 * réaffecter » puts on them; without one, « Supprimer "nom" » takes the tag
 * off them, the button destructive as Sure's.
 */
export function DeleteTagDialog({ tag, tags, open, onOpenChange }: DeleteTagDialogProps) {
	const { t } = useTranslation();
	const deleteTag = useDeleteTag();
	const [replacement, setReplacement] = useState(NONE);
	const replacing = replacement !== NONE;

	useEffect(() => {
		if (open) {
			setReplacement(NONE);
		}
	}, [open]);

	const confirm = () => {
		deleteTag.mutate(
			{ id: tag.id, replacementId: replacing ? replacement : null },
			{
				onSuccess: () => {
					toast.success(t("tags.deleteDialog.deleted", { name: tag.name }));
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
					<DialogTitle>{t("tags.deleteDialog.replaceTitle")}</DialogTitle>
					<DialogDescription>
						{t("tags.deleteDialog.explanation", { name: tag.name, count: tag.transactionCount })}
					</DialogDescription>
				</DialogHeader>
				<ChoiceField
					id="delete-tag-replacement"
					label={t("tags.deleteDialog.replacement")}
					value={replacement}
					options={[
						{ value: NONE, label: t("tags.deleteDialog.prompt") },
						...tags
							.filter((other) => other.id !== tag.id)
							.map((other) => ({ value: other.id, label: other.name })),
					]}
					onChange={setReplacement}
				/>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
						{t("common.cancel")}
					</Button>
					<Button
						type="button"
						variant={replacing ? "default" : "destructive"}
						disabled={deleteTag.isPending}
						onClick={confirm}
					>
						{replacing
							? t("tags.deleteDialog.reassign")
							: t("tags.deleteDialog.leave", { name: tag.name })}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
