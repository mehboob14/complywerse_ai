// RCSA campaign period labels, as the backend stores them in period_label ("Q1 2026" ... "Annual 2026").

export function campaignPeriods(years: readonly number[]): string[] {
  return years.flatMap((y) => [`Q1 ${y}`, `Q2 ${y}`, `Q3 ${y}`, `Q4 ${y}`, `Annual ${y}`]);
}

/** A new campaign runs this year or next. */
export function newCampaignPeriods(today: Date = new Date()): string[] {
  const year = today.getFullYear();
  return campaignPeriods([year, year + 1]);
}

/** Filtering also reaches last year's campaigns. */
export function filterCampaignPeriods(today: Date = new Date()): string[] {
  const year = today.getFullYear();
  return campaignPeriods([year - 1, year, year + 1]);
}
