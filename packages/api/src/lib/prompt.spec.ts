import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import { checkNewPassword, closePrompts, promptSecret } from "./prompt.ts";

describe("checkNewPassword", () => {
	it("accepts two identical passwords of a valid length", () => {
		expect(checkNewPassword("12345678", "12345678")).toBeNull();
		expect(checkNewPassword("x".repeat(128), "x".repeat(128))).toBeNull();
	});

	it.each([
		["12345678", "1234567 ", "password_mismatch"],
		["1234567", "1234567", "password_too_short"],
		["x".repeat(129), "x".repeat(129), "password_too_long"],
		// The mismatch is reported first: the length rule of a password that is
		// not the one wanted says nothing useful.
		["1234567", "abcdefgh", "password_mismatch"],
	])("refuses %j and %j with %s", (password, confirmation, problem) => {
		expect(checkNewPassword(password, confirmation)).toBe(problem);
	});
});

describe("promptSecret", () => {
	it("returns what is typed and writes the question but never the answer", async () => {
		const input = new PassThrough();
		const output = new PassThrough();
		const written: string[] = [];
		output.on("data", (chunk: Buffer) => written.push(chunk.toString()));

		const answer = promptSecret("Nouveau mot de passe : ", input, output);
		input.write("correct horse battery\n");

		await expect(answer).resolves.toBe("correct horse battery");
		const shown = written.join("");
		expect(shown).toContain("Nouveau mot de passe : ");
		expect(shown).not.toContain("correct horse");
		closePrompts(input);
	});

	it("reads two answers in a row from one input, as the script asks twice", async () => {
		const input = new PassThrough();
		const output = new PassThrough();
		output.resume();

		// Both lines in one chunk, as a pipe delivers them: the second answer
		// must survive until the second question asks for it.
		const first = promptSecret("Nouveau mot de passe : ", input, output);
		input.write("un\ndeux\n");

		await expect(first).resolves.toBe("un");
		await expect(promptSecret("Confirmer : ", input, output)).resolves.toBe("deux");
		closePrompts(input);
	});

	it("answers an input that closes with nothing, rather than waiting for ever", async () => {
		const input = new PassThrough();
		const output = new PassThrough();
		output.resume();

		const answer = promptSecret("Nouveau mot de passe : ", input, output);
		input.end();

		await expect(answer).resolves.toBe("");
	});
});
