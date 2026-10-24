import type { MerchantData } from "@/hooks/useMerchants";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { MerchantCombobox } from "@/components/MerchantCombobox";
import { TintedIcon } from "@/components/TintedIcon";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMergeMerchants } from "@/hooks/useMerchants";
import { ApiError } from "@/lib/api";
import { fieldErrorCode } from "@/lib/form-errors";
import { matchesSearch } from "@/lib/search-match";

type MergeMerchantDialogProps = {
	merchants: readonly MerchantData[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

/**
 * Sure's `family_merchants/merge.html.erb`: a target picked from a list to
 * type into, as Sure's searchable select, then the merchants to merge into
 * it, filtered by name. Picking a target unticks it and disables its box, as
 * the category merge's; a merge the server refuses shows its reason above
 * the button.
 */
export function MergeMerchantDialog({ merchants, open, onOpenChange }: MergeMerchantDialogProps) {
	const { t } = useTranslation();
	const mergeMerchants = useMergeMerchants();
	const [targetId, setTargetId] = useState<string | undefined>();
	const [sourceIds, setSourceIds] = useState<readonly string[]>([]);
	const [search, setSearch] = useState("");
	const [picking, setPicking] = useState(false);
	const [refusal, setRefusal] = useState<string | null>(null);
	const target = merchants.find((merchant) => merchant.id === targetId);
	const sources = [...sourceIds];
	const shown = merchants.filter((merchant) => matchesSearch(merchant.name, search));

	useEffect(() => {
		if (open) {
			setTargetId(undefined);
			setSourceIds([]);
			setSearch("");
			setRefusal(null);
		}
	}, [open]);

	const toggle = (id: string, checked: boolean) => {
		setRefusal(null);
		setSourceIds((current) =>
			checked ? [...current, id] : current.filter((sourceId) => sourceId !== id),
		);
	};

	const confirm = () => {
		if (target === undefined || sources.length === 0) {
			return;
		}

		mergeMerchants.mutate(
			{ targetId: target.id, sourceIds: sources },
			{
				onSuccess: ({ merged }) => {
					toast.success(t("merchants.mergeDialog.merged", { count: merged }));
					onOpenChange(false);
				},
				onError: (error) => {
					const apiError = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR");
					const [field] = apiError.fields;

					setRefusal(
						field === undefined
							? t(`errors.${apiError.code}`)
							: t(`errors.fields.${fieldErrorCode({ type: field.code })}`),
					);
				},
			},
		);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>{t("merchants.mergeDialog.title")}</DialogTitle>
					<DialogDescription>{t("merchants.mergeDialog.description")}</DialogDescription>
				</DialogHeader>
				<div className="flex min-h-0 flex-col gap-4">
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
									value={targetId ?? null}
									allowNone={false}
									allowCreate={false}
									onSelect={(next) => {
										if (next !== null) {
											setRefusal(null);
											setTargetId(next);
											setSourceIds((current) => current.filter((id) => id !== next));
										}

										setPicking(false);
									}}
								/>
							</PopoverContent>
						</Popover>
					</div>
					<fieldset className="flex min-h-0 flex-col gap-1.5">
						<legend className="mb-1.5 text-sm font-medium">
							{t("merchants.mergeDialog.sources")}
						</legend>
						<Input
							type="search"
							aria-label={t("merchants.mergeDialog.search")}
							placeholder={t("merchants.mergeDialog.search")}
							value={search}
							onChange={(event) => setSearch(event.target.value)}
						/>
						<ul className="max-h-64 overflow-y-auto rounded-lg border p-1">
							{shown.length === 0 && (
								<li className="px-2 py-1.5 text-sm text-muted-foreground">
									{t("merchants.mergeDialog.noneFound")}
								</li>
							)}
							{shown.map((merchant) => {
								const id = `merge-merchant-source-${merchant.id}`;

								return (
									<li key={merchant.id} className="flex items-center gap-2 rounded-md px-2 py-1.5">
										<Checkbox
											id={id}
											checked={sourceIds.includes(merchant.id)}
											disabled={merchant.id === targetId}
											onCheckedChange={(checked) => toggle(merchant.id, checked === true)}
										/>
										<TintedIcon
											size="sm"
											subject={{ kind: "merchant", name: merchant.name, color: merchant.color }}
										/>
										<Label htmlFor={id} className="min-w-0 flex-1 font-normal">
											<span className="truncate">{merchant.name}</span>
										</Label>
									</li>
								);
							})}
						</ul>
						<p className="text-xs text-muted-foreground">{t("merchants.mergeDialog.hint")}</p>
					</fieldset>
					{refusal !== null && (
						<p role="alert" className="text-sm text-destructive">
							{refusal}
						</p>
					)}
				</div>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
						{t("common.cancel")}
					</Button>
					<Button
						type="button"
						disabled={target === undefined || sources.length === 0 || mergeMerchants.isPending}
						onClick={confirm}
					>
						{t("merchants.mergeDialog.action")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
