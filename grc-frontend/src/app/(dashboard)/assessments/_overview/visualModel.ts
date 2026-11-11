// What the graphs of the Assessments Overview draw, apart from React so `node --test` pins it (visualModel.test.ts): the score by category and by assessment as ranked bars (the server's
// scores in the colour and the word of the server's grade: 85 excellent, 70 good, 50 fair, below poor), and the gaps by state. Every figure is the board's (`GET /overview`); a score that is
// not recorded is "No data" and a bar of nothing, never a 0 that reads as failing; the gap counts add up (open includes overdue: the server's rule), so "within target" is open minus overdue.
import { formatCount } from '../../../../lib/format.ts';
import { grade } from '../../../../lib/statuses/assessments.ts';
import { kindOf } from '../../../../components/assessments/workspace/kinds.ts';
import { gradeOf, workspaceHref, type GradeWord } from '../../../../components/assessments/workspace/workspaceModel.ts';
import { toneColor } from '../../../../components/compliance/overview/graphModel.ts';
import { STATUS } from '../../../../components/overview/charts/palette.ts';
import { categoryHref } from '../_data/categories.ts';
import type { Board } from '../_data/types.ts';

export interface BarItem { key: string; label: string; value: number; valueText?: string; color?: string; note?: string; href?: string }
export interface PartItem { key: string; label: string; value: number; color?: string; href?: string }

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const colorOf = (g: GradeWord | null): string => toneColor(grade.tone(g));
const plural = (n: number, one: string, many: string): string => `${formatCount(n)} ${n === 1 ? one : many}`;
/** Lowest score first, a score that is not recorded after them. */
const byScore = (a: number | null, b: number | null): number => Number(a === null) - Number(b === null) || (a ?? 0) - (b ?? 0);

/** The categories as bars, the weakest first: the server's average score of the group, its grade in words, how many assessments and the SLA score in the note. Each opens the register on that category. */
export function categoryBars(board: Board | undefined): BarItem[] {
  return (board?.categories ?? [])
    .map((c) => ({ c, score: finite(c.score) ? c.score : null }))
    .sort((a, b) => byScore(a.score, b.score) || b.c.count - a.c.count || a.c.category.localeCompare(b.c.category))
    .map(({ c, score }) => {
      const g = gradeOf(score);
      return {
        key: c.category, label: c.category, value: score ?? 0, valueText: score === null ? 'No data' : String(Math.round(score)), color: colorOf(g),
        note: [g ? grade.label(g) : 'No score yet', plural(c.count, 'assessment', 'assessments'), finite(c.sla) ? `SLA ${Math.round(c.sla)}` : null].filter(Boolean).join(' · '), href: categoryHref(c.category),
      };
    });
}

export const ASSESSMENT_LIMIT = 10;

/** Every assessment the board scores, the lowest score first (the ones with no score after them), capped: the content score, the kind in the note, a click opens it. */
export function assessmentBars(board: Board | undefined, limit: number = ASSESSMENT_LIMIT): { rows: BarItem[]; of: number } {
  const all = (board?.categories ?? []).flatMap((c) => c.assessments);
  const ranked = all
    .map((a) => ({ a, score: finite(a.content) ? a.content : null }))
    .sort((x, y) => byScore(x.score, y.score) || x.a.name.localeCompare(y.a.name) || x.a.id - y.a.id);
  const rows = ranked.slice(0, limit).map(({ a, score }) => {
    const g = gradeOf(score);
    return {
      key: String(a.id), label: a.name, value: score ?? 0, valueText: score === null ? 'No data' : String(Math.round(score)), color: colorOf(g),
      note: [g ? grade.label(g) : 'Nothing answered yet', kindOf(a.format).label, finite(a.sla) ? `SLA ${Math.round(a.sla)}` : null].filter(Boolean).join(' · '), href: workspaceHref(a.id),
    };
  });
  return { rows, of: all.length };
}

/** Where the gaps stand: closed, open and within target, overdue (open includes overdue, so within target is open minus overdue). No gap at all is no parts. */
export function gapParts(board: Board | undefined): PartItem[] {
  const s = board?.sla;
  if (!s || !finite(s.gaps) || s.gaps <= 0) return [];
  const closed = finite(s.closed) ? s.closed : 0;
  const overdue = finite(s.overdue) ? s.overdue : 0;
  const open = finite(s.open) ? s.open : 0;
  return [
    { key: 'closed', label: 'Closed', value: closed, color: STATUS.good },
    { key: 'on_track', label: 'Open, within target', value: Math.max(0, open - overdue), color: STATUS.progress },
    { key: 'overdue', label: 'Overdue', value: overdue, color: STATUS.bad, href: '/assessments/register?quick=overdue' },
  ];
}

export type KpiToneName = 'default' | 'success' | 'warning' | 'danger';
/** The colour of a score's figure: the server's grade (excellent success, fair warning, poor danger; good is the plain figure). */
export const gradeTone = (g: GradeWord | null): KpiToneName => (g === 'excellent' ? 'success' : g === 'fair' ? 'warning' : g === 'poor' ? 'danger' : 'default');
