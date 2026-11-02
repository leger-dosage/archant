import { use as registerI18nextPlugin } from "i18next";
import { initReactI18next } from "react-i18next";

import en from "../locales/en.json";
import fr from "../locales/fr.json";
import { activeLocale } from "./locale";

// French is the reference: `en` is typed from it, so a key missing from the
// English file fails the build rather than showing a key to a reader.
const resources = { fr: { translation: fr }, en: { translation: en satisfies typeof fr } } as const;

declare module "i18next" {
	interface CustomTypeOptions {
		resources: (typeof resources)["fr"];
	}
}

export async function initI18n() {
	document.documentElement.lang = activeLocale;

	await registerI18nextPlugin(initReactI18next).init({
		lng: activeLocale,
		fallbackLng: "en",
		resources,
		// React already escapes what it renders.
		interpolation: { escapeValue: false },
	});
}
