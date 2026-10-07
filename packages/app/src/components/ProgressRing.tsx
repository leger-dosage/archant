import type { TintSubject } from "@/lib/tint";
import type { ReactNode } from "react";

import { formatWholePercent } from "@/lib/percent";
import { useResolvedTheme } from "@/lib/theme";
import { resolveTint } from "@/lib/tint";
import { cn } from "@/lib/utils";

const STROKE = 6;

/** The arc's colour: its subject's tint, or a token Sure names, such as its warning colour. */
type Tone = { subject: TintSubject; color?: never } | { color: string; subject?: never };

/**
 * A share as Sure's ring, a goal's progress or a loan's repayment: the share
 * drawn round a circle, the percentage inside. An image named by a sentence,
 * so a screen reader hears what the ring shows; the arc's colour meets 3:1 as
 * an icon's does.
 */
export function ProgressRing({
	percent,
	label,
	size = 64,
	className,
	children,
	...tone
}: Tone & {
	/** 0 to 100. */
	percent: number;
	/** The sentence the ring is named by, which states the percentage. */
	label: string;
	size?: number;
	className?: string;
	/** What the ring holds in place of the bare percentage; hidden, the label saying it. */
	children?: ReactNode;
}) {
	const mode = useResolvedTheme();
	const stroke = tone.subject === undefined ? tone.color : resolveTint(tone.subject, mode).icon;
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
						stroke={stroke}
						strokeWidth={STROKE}
						strokeLinecap="round"
						strokeDasharray={circumference}
						strokeDashoffset={circumference * (1 - filled)}
					/>
				)}
			</svg>
			<div aria-hidden="true" className="absolute flex flex-col items-center">
				{children ?? (
					<span className="text-xs font-medium tabular-nums">{formatWholePercent(percent)}</span>
				)}
			</div>
		</div>
	);
}
