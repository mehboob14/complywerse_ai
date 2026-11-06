// What a clamped text decides, apart from React so `node --test` can pin it (clampModel.test.ts): how many lines, the class that cuts there, whether a text
// really is cut at this width, and when "Show more" is drawn. Used by ClampedText and by the two-line title of a WorkRow. The hook that measures is
// useLineClamped.ts.

export type ClampLines = 1 | 2 | 3 | 4 | 5 | 6;

/** The lines a ClampedText shows when the page does not say. */
export const DEFAULT_LINES: ClampLines = 3;

/** `line-clamp-N` written out whole, so the stylesheet has every one of them (a class built from a number is not found). */
export const CLAMP_CLASS: Record<ClampLines, string> = {
  1: 'line-clamp-1', 2: 'line-clamp-2', 3: 'line-clamp-3', 4: 'line-clamp-4', 5: 'line-clamp-5', 6: 'line-clamp-6',
};

/** A whole number of lines from 1 to 6; anything else (missing, 0, 2.5, text, NaN) is the default. 2.5 is cut down to 2, 9 is held at 6. */
export function clampLines(lines: number | null | undefined): ClampLines {
  if (typeof lines !== 'number' || !Number.isFinite(lines) || lines < 1) return DEFAULT_LINES;
  return Math.min(6, Math.floor(lines)) as ClampLines;
}

/** Is the text cut by its box? Its content is taller than the box it is clamped in (a pixel of rounding is not a cut). */
export function isCut(box: { scrollHeight: number; clientHeight: number }): boolean {
  return box.scrollHeight > box.clientHeight + 1;
}

/** The words of the toggle: what pressing it does. */
export function toggleWords(open: boolean): 'Show more' | 'Show less' {
  return open ? 'Show less' : 'Show more';
}

/** Whether the toggle is drawn: when the text is cut at this width, and while it is open (so it can be shut again, even if a wider window now fits it all). */
export function showsToggle({ cut, open }: { cut: boolean; open: boolean }): boolean {
  return cut || open;
}
