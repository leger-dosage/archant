import type { RuleData } from "@/hooks/useRules";

import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { useReorderRules } from "@/hooks/useRules";
import { errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";

export function RuleOrderDialog({
	rules,
	labelOf,
}: {
	rules: RuleData[];
	labelOf: (rule: RuleData) => string;
}) {
	const { t } = useTranslation();
	const save = useReorderRules();
	const [open, setOpen] = useState(false);
	const [ordered, setOrdered] = useState<RuleData[]>([]);

	const changeOpen = (next: boolean) => {
		if (save.isPending) {
			return;
		}

		if (next) {
			setOrdered(rules);
		}

		setOpen(next);
	};

	const move = (index: number, offset: number) => {
		const rule = ordered[index];
		const target = ordered[index + offset];

		if (rule !== undefined && target !== undefined) {
			setOrdered(ordered.with(index, target).with(index + offset, rule));
		}
	};

	return (
		<Dialog open={open} onOpenChange={changeOpen}>
			<DialogTrigger asChild>
				<Button variant="outline">{t("rules.order.title")}</Button>
			</DialogTrigger>
			<DialogContent
				showCloseButton={false}
				className="max-h-[90dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto"
			>
				<DialogHeader>
					<DialogTitle>{t("rules.order.title")}</DialogTitle>
					<DialogDescription>{t("rules.order.description")}</DialogDescription>
				</DialogHeader>
				<ol className="divide-y divide-line">
					{ordered.map((rule, index) => {
						const name = labelOf(rule);

						return (
							<li key={rule.id} className="flex min-h-14 items-center gap-2">
								<span className="min-w-0 flex-1 wrap-break-word">
									{index + 1}. {name}
								</span>
								<Button
									variant="outline"
									size="icon"
									className="size-11 shrink-0"
									aria-label={t("rules.order.up", { name })}
									disabled={index === 0 || save.isPending}
									onClick={() => move(index, -1)}
								>
									<ArrowUpIcon />
								</Button>
								<Button
									variant="outline"
									size="icon"
									className="size-11 shrink-0"
									aria-label={t("rules.order.down", { name })}
									disabled={index === ordered.length - 1 || save.isPending}
									onClick={() => move(index, 1)}
								>
									<ArrowDownIcon />
								</Button>
							</li>
						);
					})}
				</ol>
				<DialogFooter>
					<Button variant="outline" disabled={save.isPending} onClick={() => setOpen(false)}>
						{t("common.cancel")}
					</Button>
					<Button
						disabled={save.isPending}
						onClick={() =>
							save.mutate(
								ordered.map(({ id }) => id),
								{
									onSuccess: () => {
										toast.success(t("rules.order.saved"));
										setOpen(false);
									},
									onError: (error) => {
										const code = errorCodeOf(error);
										showErrorToast(code);

										if (code === "RULE_ORDER_STALE") {
											setOpen(false);
										}
									},
								},
							)
						}
					>
						{t("rules.order.save")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
