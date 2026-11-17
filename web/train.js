// Accept both historical and 2026 passenger prefixes. Never rewrite a trip's
// recorded service number based on today's timetable or its departure date.
const prefixed = String.raw`(?:DEMO|[XGTDKCSZNVYLA])\s*\d{1,5}`;
export const trainPattern = new RegExp(
  String.raw`(?<![A-Z0-9])(${prefixed})(?![A-Z0-9])`,
  "i",
);
export const routeTrainPattern = new RegExp(
  String.raw`(?<![A-Z0-9])(${prefixed}|\d{3,5})(?![A-Z0-9])`,
  "i",
);
export const exactTrainPattern = new RegExp(
  String.raw`^(?:${prefixed}|\d{3,5})$`,
  "i",
);
