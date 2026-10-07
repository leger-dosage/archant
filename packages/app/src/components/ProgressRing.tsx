import type { TintSubject } from "@/lib/tint";

import { formatWholePercent } from "@/lib/percent";
import { useResolvedTheme } from "@/lib/theme";
import { resolveTint } from "@/lib/tint";
import { cn } from "@/lib/utils";

const STROKE = 6;

/**
 * A share as Sure's ring, a goal's progress or a loan's repayment: the share
 * drawn round a circle in its subject's colour, the percentage inside. An
 * image named by a sentence, so a screen reader hears what the ring shows;
 * the arc's colour meets 3:1 as an icon's does.
 */
export function ProgressRing({
	percent,
	subject,
	label,
	size = 64,
	className,
}: {
	/** 0 to 100. */
	percent: number;
	subject: TintSubject;
	/** The sentence the ring is named by, which states the percentage. */
	label: string;
	size?: number;
	className?: string;
}) {
	const mode = useResolvedTheme();
	const text = formatWholePercent(percent);
	const radius = (size - STROKE) / 2;
	const circumference = 2 * Math.PI * radius;
	const filled = Math.min(Math.max(percent, 0), 100) / 100;

	return (
		<div
			role="img"
			aria-label={label}
			data-slot="progress-ring"
			className={cn("relative grid shrink-0 place-items-center", className)}
			style={{ width: size, height: size }}
		>
			<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
				<circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					fill="none"
					stroke="var(--border)"
					strokeWidth={STROKE}
				/>
				{filled > 0 && (
					<circle
						cx={size / 2}
						cy={size / 2}
						r={radius}
						fill="none"
						stroke={resolveTint(subject, mode).icon}
						strokeWidth={STROKE}
						strokeLinecap="round"
						strokeDasharray={circumference}
						strokeDashoffset={circumference * (1 - filled)}
					/>
				)}
			</svg>
			<span aria-hidden="true" className="absolute text-xs font-medium tabular-nums">
				{text}
			</span>
		</div>
	);
}
