// Optional peers these packages declare for features Archant never imports:
// better-auth's test utilities and schema CLI, env-core's type helpers. pnpm
// links an optional peer whenever the workspace has it, and the link survives
// `pnpm install --prod`: the container image then carried a test runner, Vite,
// drizzle-kit and the TypeScript compiler.
const UNUSED_PEERS = {
	"better-auth": ["vitest", "drizzle-kit"],
	"@t3-oss/env-core": ["typescript"],
};

/**
 * @param {{ name?: string, peerDependencies?: Record<string, string>, peerDependenciesMeta?: Record<string, unknown> }} manifest
 * @returns {typeof manifest}
 */
function readPackage(manifest) {
	for (const name of UNUSED_PEERS[manifest.name] ?? []) {
		delete manifest.peerDependencies?.[name];
		delete manifest.peerDependenciesMeta?.[name];
	}

	return manifest;
}

module.exports = { hooks: { readPackage } };
