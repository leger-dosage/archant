import { useMutation } from "@tanstack/react-query";
import { CircleCheckIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useCategories } from "@/hooks/useCategories";
import { api, errorCodeOf, unwrap } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";

type RulePromptProps = {
	categoryId: string;
	/** Closes this prompt only, as Sure's X: nothing is saved. */
	onClose: () => void;
	onCreate: () => void;
};

/**
 * Sure's `rules/_category_rule_cta`, offered once a category is set by hand:
 * « Créer une règle » opens the rule form preset for the line, « Masquer
 * pour aujourd'hui » hides every prompt for 24 hours, or for good with
 * « Ne plus afficher » ticked.
 */
export function RulePrompt({ categoryId, onClose, onCreate }: RulePromptProps) {
	const { t } = useTranslation();
	const checkboxId = useId();
	const [disabled, setDisabled] = useState(false);
	const categories = useCategories();
	const name = categories.data?.find((category) => category.id === categoryId)?.name ?? "";
	const dismiss = useMutation({
		mutationFn: async () =>
			(await unwrap(api.preferences["rule-prompt"].$patch({ json: { disabled } }))).data,
		onSuccess: onClose,
		onError: (error) => showErrorToast(errorCodeOf(error)),
	});

	return (
		<div
			role="status"
			className="relative flex w-full gap-3 rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg"
		>
			<Button
				variant="ghost"
				size="icon-sm"
				className="absolute top-2 right-2"
				aria-label={t("common.close")}
				onClick={onClose}
			>
				<XIcon />
			</Button>
			{/* The icon of every success toast: the category is saved. */}
			<CircleCheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
			<div className="flex min-w-0 flex-1 flex-col gap-4 pr-6">
				<div className="flex flex-col gap-1">
					<p className="text-sm font-medium">{t("rules.prompt.message", { name })}</p>
					<p className="text-sm text-muted-foreground">{t("rules.prompt.description")}</p>
				</div>
				<div className="flex items-center gap-2">
					<Checkbox
						id={checkboxId}
						checked={disabled}
						onCheckedChange={(checked) => setDisabled(checked === true)}
					/>
					<Label htmlFor={checkboxId} className="text-xs font-normal text-muted-foreground">
						{t("rules.prompt.dontShowAgain")}
					</Label>
				</div>
				<div className="flex flex-wrap justify-end gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={dismiss.isPending}
						onClick={() => dismiss.mutate()}
					>
						{t("rules.prompt.hideForToday")}
					</Button>
					<Button size="sm" onClick={onCreate}>
						{t("rules.prompt.create")}
					</Button>
				</div>
				<p className="text-right text-xs text-muted-foreground">
					{t("rules.prompt.hideForTodayHint")}
				</p>
			</div>
		</div>
	);
}
