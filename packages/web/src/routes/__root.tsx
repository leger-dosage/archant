import type { QueryClient } from "@tanstack/react-query";

import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";

export type RouterContext = { queryClient: QueryClient };

// The sidebar layout lives in `_authed.tsx`: setup and sign-in render without it.
export const Route = createRootRouteWithContext<RouterContext>()({ component: Outlet });
