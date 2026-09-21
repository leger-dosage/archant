import type { CSSProperties as ReactCSSProperties } from "react";

// Lets inline styles set CSS custom properties (`--sidebar-width`) without a
// cast at every call site. The import above makes this file a module, so the
// block below augments React's types instead of replacing them.
declare module "react" {
	interface CSSProperties {
		[property: `--${string}`]: string | number | undefined;
	}
}

export type StyleWithVariables = ReactCSSProperties;
