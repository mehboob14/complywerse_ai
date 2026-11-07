// Date parsing/formatting for the Reports surfaces. Pure (no JSX) so it can be
// unit-checked in Node — see scripts/reportDates.selfcheck.mjs.

/**
 * Parse a date string the API returns into a correct instant.
 *
 * Two server shapes, two rules:
 *  - A NAIVE datetime ("2026-10-20 20:03:28", no zone) is UTC wall-clock (SQLAlchemy
 *    `datetime.utcnow()`). Parsed as-is JS treats it as LOCAL, so a 20:03 UTC save
 *    shows the PREVIOUS day in +offset zones ("saved 21 Oct" → "Updated 20 Oct").
 *    We normalise it to an explicit UTC instant.
 *  - A pure calendar date ("2026-10-21") means that exact day; `new Date("…")` reads
 *    it as UTC midnight, which is the day BEFORE for viewers west of UTC. We build it
 *    as a LOCAL date so the day is stable in every timezone.
 * Anything already carrying a zone (Z or ±hh:mm) is left untouched.
 */
export function parseServerDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const s = iso.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dateOnly) {
    const d = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  let t = s;
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(t);
  if (!hasZone && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(t)) {
    t = t.replace(' ', 'T') + 'Z';
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Medium calendar date in the viewer's locale/timezone, correct for both server shapes. */
export function fmtDate(iso: string | null | undefined): string {
  const d = parseServerDate(iso);
  return d ? d.toLocaleDateString(undefined, { dateStyle: 'medium' }) : '-';
}
