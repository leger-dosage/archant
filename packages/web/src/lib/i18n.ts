import { use as registerI18nextPlugin } from "i18next";
import { initReactI18next } from "react-i18next";

import fr from "../locales/fr.json";

export const resources = { fr: { translation: fr } } as const;

declare module "i18next" {
	interface CustomTypeOptions {
		resources: (typeof resources)["fr"];
	}
}

export async function initI18n() {
	await registerI18nextPlugin(initReactI18next).init({
		lng: "fr",
		fallbackLng: "fr",
		resources,
		// React already escapes what it renders.
		interpolation: { escapeValue: false },
	});
}
