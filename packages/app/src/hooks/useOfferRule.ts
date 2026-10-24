import { useNavigate } from "@tanstack/react-router";
import { createElement, useCallback } from "react";
import { toast } from "sonner";

import { RulePrompt } from "@/components/RulePrompt";
import { api, unwrap } from "@/lib/api";

/** One prompt at a time: a newer one replaces it, as Sure's `turbo_stream.replace("cta")`. */
const RULE_PROMPT_TOAST = "rule-prompt";

/**
 * The prompt's own toaster, at the top as Sure's notification tray: stacked
 * with « Catégorie modifiée » in the corner, it hid that toast's « Annuler ».
 */
export const RULE_PROMPT_TOASTER = "rule-prompt";

/**
 * The latest offer asked: an answer to an older one, or to one withdrawn
 * since, shows nothing, so a slow answer never offers a rule for a category
 * already replaced or undone.
 */
let latestOffer = 0;

/** Closes the prompt, and any offer still waiting for its answer. */
export function withdrawRulePrompt(): void {
	latestOffer += 1;
	toast.dismiss(RULE_PROMPT_TOAST);
}

/** The line just categorised by hand, as saved. */
type Categorised = { id: string; label: string; categoryId: string };

/**
 * Asks the server whether to offer a rule for a line whose category the
 * owner just set by hand, Sure's `needs_rule_notification?`, and shows Sure's
 * prompt if so. A failed read shows nothing: the category is saved anyway.
 */
export function useOfferRule() {
	const navigate = useNavigate();

	return useCallback(
		async ({ id, label, categoryId }: Categorised) => {
			latestOffer += 1;
			const offer = latestOffer;

			try {
				const { offered } = (
					await unwrap(api.transactions[":id"]["rule-prompt"].$get({ param: { id } }))
				).data;

				if (!offered || offer !== latestOffer) {
					return;
				}
			} catch {
				return;
			}

			const close = () => toast.dismiss(RULE_PROMPT_TOAST);

			toast.custom(
				() =>
					createElement(RulePrompt, {
						categoryId,
						onClose: close,
						onCreate: () => {
							close();
							// Sure's `new_rule_path(name:, action_value:)`.
							void navigate({ to: "/rules", search: { name: label, categoryId } });
						},
					}),
				{
					id: RULE_PROMPT_TOAST,
					toasterId: RULE_PROMPT_TOASTER,
					duration: Number.POSITIVE_INFINITY,
				},
			);
		},
		[navigate],
	);
}
