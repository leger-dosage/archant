import type { Server } from "node:net";

import { once } from "node:events";
import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { loopbackListener } from "./port.ts";

const held: Server[] = [];

/** Listens on `host` alone, as another development server would. */
async function hold(host: string): Promise<number> {
	const holder = createServer((socket) => socket.destroy());
	holder.listen(0, host);
	await once(holder, "listening");
	held.push(holder);
	const address = holder.address();

	if (address === null || typeof address === "string") {
		throw new Error("No TCP port was assigned.");
	}

	return address.port;
}

async function releaseAll(): Promise<void> {
	await Promise.all(
		held.splice(0).map(async (holder) => {
			holder.close();
			await once(holder, "close");
		}),
	);
}

afterEach(releaseAll);

describe("loopbackListener", () => {
	it("finds a server on the IPv4 loopback", async () => {
		const port = await hold("127.0.0.1");

		await expect(loopbackListener(port)).resolves.toBe("127.0.0.1");
	});

	it("finds a server on the IPv6 loopback", async () => {
		const port = await hold("::1");

		await expect(loopbackListener(port)).resolves.toBe("::1");
	});

	it("answers null when nothing listens", async () => {
		const port = await hold("127.0.0.1");
		await releaseAll();

		await expect(loopbackListener(port)).resolves.toBeNull();
	});
});
