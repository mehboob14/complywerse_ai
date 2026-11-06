/** The server stamps times in UTC without saying so ("2026-10-07T05:59:42"). `new Date` reads such a string as
 *  local time, so every time on these screens was off by the viewer's offset: a file uploaded at 10:59 in
 *  Karachi said 05:59. A time with no zone is UTC; one that names its zone is left as it is. */
export function parseUtc(value: string | number | Date | null | undefined): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  const hasZone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(value);
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) || hasZone ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "37 s", "2 min 5 s": how long ago something began. */
export function elapsed(since: string | null | undefined, now: number = Date.now()): string {
  const start = parseUtc(since);
  if (!start) return '';
  const seconds = Math.max(0, Math.round((now - start.getTime()) / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}
