// One entry per resource, so an invalidation after a write names exactly the
// queries it makes stale.
export const queryKeys = {
	accounts: {
		all: ["accounts"] as const,
	},
};
