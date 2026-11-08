// The geometry and the words of the trend chart, apart from React so `node --test` pins them (trendModel.test.ts).

/** The segments of a line: runs of consecutive months that have a value, each as "x,y x,y". A month with no score is a gap in the line, not a zero. */
export function runs(values: ReadonlyArray<number | null>, x: (i: number) => number, y: (v: number) => number): string[] {
  const out: string[] = [];
  let current: string[] = [];
  values.forEach((v, i) => {
    if (typeof v === 'number' && Number.isFinite(v)) current.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    else if (current.length) { out.push(current.join(' ')); current = []; }
  });
  if (current.length) out.push(current.join(' '));
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11" -> "Nov 2026"; anything else is left as the server wrote it. */
export function monthWords(month: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(month);
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : month;
}

/** A score as the height on a 0..100 axis, kept inside the picture. */
export const clamp100 = (v: number): number => Math.max(0, Math.min(100, v));
