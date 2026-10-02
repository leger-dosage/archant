import { CopyIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/**
 * An address the owner pastes somewhere else, with a button that copies it:
 * a bank's redirect address into its portal, `/api/mcp` into an assistant.
 */
export function CopyableAddress({ value, copyLabel }: { value: string; copyLabel: string }) {
	const { t } = useTranslation();

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(value);
			toast.success(t("common.copied"));
		} catch {
			// No clipboard outside a secure context, or permission refused.
			toast.error(t("common.copyFailed"));
		}
	};

	return (
		<div className="flex items-center gap-2">
			<code className="min-w-0 flex-1 rounded bg-muted px-2 py-1 font-mono text-sm break-all select-all">
				{value}
			</code>
			<Button
				type="button"
				variant="outline"
				size="icon"
				aria-label={copyLabel}
				onClick={() => void copy()}
			>
				<CopyIcon aria-hidden />
			</Button>
		</div>
	);
}
