import { useEffect } from "react";

export const pageCountOf = (data: { total: number; pageSize: number } | undefined) =>
	data === undefined ? 1 : Math.max(1, Math.ceil(data.total / data.pageSize));

/**
 * A page past the end, after deleting the only row of the last page or from
 * an old link, would show an empty list that is not the empty state: go back
 * to the last page instead. `loaded` is `undefined` while a placeholder shows,
 * whose total belongs to another page or filter.
 */
export function useClampPage(
	page: number,
	loaded: { total: number; pageSize: number } | undefined,
	goTo: (lastPage: number) => void,
) {
	const lastPage = loaded === undefined ? undefined : pageCountOf(loaded);

	useEffect(() => {
		if (lastPage !== undefined && page > lastPage) {
			goTo(lastPage);
		}
	}, [goTo, lastPage, page]);
}
