/** The search param holding a list's page on the account page. */
export type PageParam = "page" | "snapshotsPage" | "importsPage";

/** The search param holding the runs' page on `/rules`. */
export type RulesPageParam = "runsPage";

/**
 * The search params that show `target` of the list behind `param`, leaving the
 * other list's page alone. The first page is the absent param, so a link to it
 * carries none.
 */
export function pageSearch(param: PageParam | RulesPageParam, target: number) {
	const value = target === 1 ? undefined : target;

	return { [param]: value };
}
