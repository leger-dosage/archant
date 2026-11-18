import { z } from "zod";

import { DATE_FORMATS, isHouseholdCountry, isTimeZone } from "@archant/data/household-preferences";
import { isCurrencyCode } from "@archant/data/money";

export const householdSetupFields = z.object({
	country: z.string().refine(isHouseholdCountry).optional(),
	baseCurrency: z.string().refine(isCurrencyCode).optional(),
	dateFormat: z.enum(DATE_FORMATS).optional(),
});

export const householdPreferencesSchema = z.strictObject({
	country: householdSetupFields.shape.country,
	dateFormat: householdSetupFields.shape.dateFormat,
	timeZone: z.string().max(100).refine(isTimeZone).optional(),
	monthStartDay: z.number().int().min(1).max(28).optional(),
});

export type HouseholdPreferencesInput = z.input<typeof householdPreferencesSchema>;
