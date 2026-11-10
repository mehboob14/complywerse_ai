// The tone of a badge cell, as a pure function (builderModel.test.ts pins it). The datasets colour their cells with palette classes (emerald / amber / rose ...), which the shell's stylesheet repaints; the
// table reads the colour WORD and draws the cell with the kit's status pill instead (a label is always drawn: the colour only backs it up).
import type { Tone } from '../../../../lib/status.ts';

export function cellTone(classes: string | undefined | null): Tone {
  const c = classes ?? '';
  if (/rose|red/.test(c)) return 'danger';
  if (/amber|orange|yellow/.test(c)) return 'warning';
  if (/emerald|green/.test(c)) return 'success';
  if (/primary|teal|sky|blue/.test(c)) return 'progress';
  return 'neutral';
}
