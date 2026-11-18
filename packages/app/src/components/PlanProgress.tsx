import { cn } from "@/lib/utils";

/** The amounts beside the bar already describe the progress. */
export function PlanProgress({
	percent,
	className,
	fill,
}: {
	percent: number;
	className?: string;
	fill?: string | undefined;
}) {
	return (
		<div
			aria-hidden="true"
			className={cn("h-1.5 overflow-hidden rounded-full bg-inset", className)}
		>
			<div
				className={cn("h-full rounded-full bg-foreground", fill)}
				style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }}
			/>
		</div>
	);
}
