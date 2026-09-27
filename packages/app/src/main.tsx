import { z } from "zod";

// Zod probes `Function("")` when it builds an object schema, which the page's
// Content-Security-Policy blocks and reports as a violation; parsing works the
// same without it. Modules build their schemas as they load, and a bundle runs
// every static import before its own code, so the app comes after, dynamically.
z.config({ jitless: true });
await import("./app");
