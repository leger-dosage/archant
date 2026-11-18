import { TagsIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { TagFilterEditor } from "@/components/TransactionFilters";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useTags } from "@/hooks/useTags";

export function ReportsTagFilter({
	selected,
	onApply,
}: {
	selected: string[] | undefined;
	onApply: (tag: string[] | undefined) => void;
}) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const tags = useTags();
	const label = t("tags.title");

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="outline" aria-label={label}>
					<TagsIcon aria-hidden="true" />
					{label}
					{selected !== undefined && <span className="tabular-nums">({selected.length})</span>}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" aria-label={label}>
				{tags.data !== undefined ? (
					<TagFilterEditor
						tags={tags.data}
						selectedIds={selected}
						onApply={(tag) => {
							onApply(tag);
							setOpen(false);
						}}
					/>
				) : tags.isError ? (
					<Button variant="outline" onClick={() => void tags.refetch()}>
						{t("common.retry")}
					</Button>
				) : (
					<Skeleton className="h-9 w-full" aria-hidden="true" />
				)}
			</PopoverContent>
		</Popover>
	);
}
