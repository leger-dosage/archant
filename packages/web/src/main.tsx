import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { t } from "i18next";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";

import "./styles.css";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { errorCodeOf } from "@/lib/api";
import { initI18n } from "@/lib/i18n";
import { initTheme } from "@/lib/theme";

import { routeTree } from "./routeTree.gen";

initTheme();
await initI18n();

const queryClient = new QueryClient({
	// A failed read has no form to show it next to, so it becomes a toast. Writes
	// handle their own errors, where the fields are.
	queryCache: new QueryCache({
		onError: (error) => {
			toast.error(t(`errors.${errorCodeOf(error)}`));
		},
	}),
});

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

const container = document.getElementById("root");

if (container === null) {
	throw new Error("The #root element is missing from index.html.");
}

createRoot(container).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<RouterProvider router={router} />
				<Toaster />
			</TooltipProvider>
		</QueryClientProvider>
	</StrictMode>,
);
