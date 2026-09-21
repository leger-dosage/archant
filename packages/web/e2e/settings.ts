// Not the dev ports (8787 and 5173): the suite runs beside `pnpm api
// start:dev` and `pnpm web start:dev` without touching their database.
export const API_PORT = 8788;
export const WEB_PORT = 4174;

// The browser and the API agree on which day is today, whatever the zone of
// the machine running the suite.
export const TIME_ZONE = "Europe/Paris";
