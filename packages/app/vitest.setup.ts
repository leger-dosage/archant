// The specs assert the French interface: Node's `navigator.languages` is
// `en-US`, which the interface would follow.
Object.defineProperty(globalThis.navigator, "languages", {
	value: ["fr-FR"],
	configurable: true,
});
