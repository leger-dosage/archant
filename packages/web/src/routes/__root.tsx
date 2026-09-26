import type { QueryClient } from "@tanstack/react-query";

import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";

import { RootError } from "@/components/RootError";

export type RouterContext = { queryClient: QueryClient };

// The sidebar layout lives in `_authed.tsx`: setup and sign-in render without it.
// No other route declares an `errorComponent`, so any route error lands on
// `RootError`: a `beforeLoad` that fails with the API down, and a page error too.
export const Route = createRootRouteWithContext<RouterContext>()({
	component: Outlet,
	errorComponent: RootError,
});
