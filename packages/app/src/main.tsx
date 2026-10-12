import { z } from "zod";

// Zod probes `Function("")` when it builds an object schema, which the page's
// Content-Security-Policy blocks and reports as a violation; parsing works the
// same without it. Modules build their schemas as they load, and a bundle runs
// every static import before its own code, so the app comes after, dynamically.
z.config({ jitless: true });

const RELOADED_AT = "archant.reloadedAt";
const RELOAD_GUARD_MS = 10_000;

// A tab opened before an image upgrade still runs the old bundle, and asks for
// chunks the new image no longer has: a route, a chart, a dialog or their CSS
// answer `404`, which would drop the page to « Une erreur est survenue ». Reloading
// fetches the new `index.html`, as Sure does when its assets change. The mark
// lets a failure within ten seconds of that reload through to the route's
// error, so a file really missing never loops, while a tab that lives across
// two upgrades days apart reloads both times. Without storage there is no
// mark, so no reload either. The event is never cancelled: the import still
// rejects, and a second failure reaches the error page.
window.addEventListener("vite:preloadError", () => {
	try {
		const elapsed = Date.now() - Number(sessionStorage.getItem(RELOADED_AT));
		// A mark in the future, from a clock moved back, must not block reloads.
		if (elapsed >= 0 && elapsed < RELOAD_GUARD_MS) {
			return;
		}

		sessionStorage.setItem(RELOADED_AT, String(Date.now()));
	} catch {
		return;
	}

	location.reload();
});

await import("./app");
