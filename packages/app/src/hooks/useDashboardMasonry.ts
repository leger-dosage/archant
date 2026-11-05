import type { RefObject } from "react";

import { useEffect } from "react";

const cardsOf = (grid: HTMLElement) =>
	Array.from(grid.querySelectorAll<HTMLElement>(":scope > [data-section-key]"));

/**
 * Sure's `dashboard_masonry_controller.js`: in two columns, each card spans
 * as many 1 px rows as it is tall, plus the column gap, and the grid's dense
 * flow fills the holes. In one column it clears the spans and the cards
 * stack. `layoutKey` names the cards and their widths, so a reorder, a
 * hidden widget or a width change observes the cards again.
 */
export function useDashboardMasonry(grid: RefObject<HTMLElement | null>, layoutKey: string) {
	useEffect(() => {
		const element = grid.current;

		if (element === null) {
			return undefined;
		}

		let frame = 0;

		const layout = () => {
			const styles = getComputedStyle(element);
			const columns = styles.gridTemplateColumns.split(" ").filter(Boolean).length;

			if (columns < 2) {
				for (const card of cardsOf(element)) {
					card.style.gridRowEnd = "";
				}

				return;
			}

			// The row gap is zero in two columns: each card's span carries the
			// column gap instead, or integer spans over a gap leave uneven ones.
			const rowUnit = Number.parseFloat(styles.gridAutoRows) || 1;
			const gapTracks = Math.round((Number.parseFloat(styles.columnGap) || 0) / rowUnit);

			for (const card of cardsOf(element)) {
				const span = Math.max(
					1,
					Math.ceil(card.getBoundingClientRect().height / rowUnit) + gapTracks,
				);
				const next = `span ${span}`;

				if (card.style.gridRowEnd !== next) {
					card.style.gridRowEnd = next;
				}
			}
		};

		const schedule = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(layout);
		};

		const observer = new ResizeObserver(schedule);

		for (const card of cardsOf(element)) {
			observer.observe(card);
		}

		schedule();
		window.addEventListener("resize", schedule);

		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
			window.removeEventListener("resize", schedule);
		};
	}, [grid, layoutKey]);
}
