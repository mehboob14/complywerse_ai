// What the graphs of the Assessments Overview draw, apart from React so `node --test` pins it (visualModel.test.ts): the categories as small multiples (the server's average score in the colour and the
// word of its grade), the assessments by grade, the five lowest assessments as bars, and the gaps by state and by due date. Every figure is the board's (`GET /overview`) or the gaps' own dates
// (`GET /points`, with the server's due-date rule); a score that is not recorded is "No data" and a ring or bar of nothing, never a 0 that reads as failing; the gap counts add up (open includes overdue:
// the server's rule), so "within target" is open minus overdue. Every part that opens records says where, on the register's own address (?category= ?grade= ?quick= ?sort=).
import { formatCount } from '../../../../lib/format.ts';
import { grade } from '../../../../lib/statuses/assessments.ts';
import { gradeOf, workspaceHref, type GradeWord } from '../../../../components/assessments/workspace/workspaceModel.ts';
import type { AgeBucket } from '../../../../components/assessments/workspace/clockModel.ts';
import { toneColor } from '../../../../components/compliance/overview/graphModel.ts';
import type { AreaTileItem, AreaTone } from '../../../../components/overview/charts/areaModel.ts';
import { STATUS } from '../../../../components/overview/charts/palette.ts';
import { categoryHref } from '../_data/categories.ts';
import type { Board } from '../_data/types.ts';

export interface BarItem { key: string; label: string; value: number; valueText?: string; color?: string; note?: string; href?: string }
export interface PartItem { key: string; label: string; value: number; color?: string; href?: string }

const REGISTER = '/assessments/register';
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const colorOf = (g: GradeWord | null): string => toneColor(grade.tone(g));
const plural = (n: number, one: string, many: string): string => `${formatCount(n)} ${n === 1 ? one : many}`;
/** Lowest score first, a score that is not recorded after them. */
const byScore = (a: number | null, b: number | null): number => Number(a === null) - Number(b === null) || (a ?? 0) - (b ?? 0);

const TILE_TONE: Record<GradeWord, AreaTone> = { excellent: 'good', good: 'good', fair: 'warn', poor: 'bad' };
/** The words of the tiles' colours: the server's grade (85 excellent, 70 good, 50 fair, below poor); excellent and good share the one colour, the tooltip says which. */
export const GRADE_WORDS = { good: 'Good or better', warn: 'Fair', bad: 'Poor', neutral: 'No data' } as const;

/** The categories as small multiples, the weakest first (one with no score last, "No data", a ring that is not scored and never a 0): the server's average score of the group, its grade, how many
 *  assessments and its SLA score in the tooltip. Each opens the register on that category. */
export function categoryTiles(board: Board | undefined): AreaTileItem[] {
  return (board?.categories ?? [])
    .map((c) => ({ c, score: finite(c.score) ? c.score : null }))
    .sort((a, b) => byScore(a.score, b.score) || b.c.count - a.c.count || a.c.category.localeCompare(b.c.category))
    .map(({ c, score }) => {
      const g = gradeOf(score);
      return {
        key: c.category, label: c.category, value: score, tone: g ? TILE_TONE[g] : 'neutral', href: categoryHref(c.category),
        note: [g ? grade.label(g) : null, plural(c.count, 'assessment', 'assessments'), finite(c.sla) ? `SLA ${Math.round(c.sla)}` : null].filter(Boolean).join(' · '),
      };
    });
}

/** The assessments the board scores, by the server's grade of their content score: good or better (excellent and good: one colour), fair, poor, and the ones with nothing answered yet. A part with
 *  none in it stays (a state that has none is a fact); no assessment at all is no parts. Each opens the register on that grade. */
export function gradeParts(board: Board | undefined): PartItem[] {
  const all = (board?.categories ?? []).flatMap((c) => c.assessments);
  if (all.length === 0) return [];
  const n = (...words: Array<GradeWord | null>): number => all.filter((a) => words.includes(gradeOf(finite(a.content) ? a.content : null))).length;
  return [
    { key: 'good', label: 'Good or better', value: n('excellent', 'good'), color: STATUS.good, href: `${REGISTER}?grade=excellent,good` },
    { key: 'fair', label: 'Fair', value: n('fair'), color: STATUS.warn, href: `${REGISTER}?grade=fair` },
    { key: 'poor', label: 'Poor', value: n('poor'), color: STATUS.bad, href: `${REGISTER}?grade=poor` },
    { key: 'none', label: 'Nothing answered', value: n(null), color: STATUS.neutral, href: `${REGISTER}?grade=none` },
  ];
}

export const LOWEST_LIMIT = 5;

/** The lowest assessments as bars, the lowest content score first (the ones with no score after them), at most five: the content score in the colour of its grade, a click opens the assessment; `of` is
 *  how many the board scores, for "See all". */
export function lowestBars(board: Board | undefined, limit: number = LOWEST_LIMIT): { rows: BarItem[]; of: number } {
  const all = (board?.categories ?? []).flatMap((c) => c.assessments);
  const ranked = all
    .map((a) => ({ a, score: finite(a.content) ? a.content : null }))
    .sort((x, y) => byScore(x.score, y.score) || x.a.name.localeCompare(y.a.name) || x.a.id - y.a.id);
  const rows = ranked.slice(0, limit).map(({ a, score }) => ({
    key: String(a.id), label: a.name, value: score ?? 0, valueText: score === null ? 'No data' : String(Math.round(score)), color: colorOf(gradeOf(score)), href: workspaceHref(a.id),
  }));
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
    { key: 'closed', label: 'Closed', value: closed, color: STATUS.good, href: `${REGISTER}?sort=gaps:desc` },
    { key: 'on_track', label: 'Within target', value: Math.max(0, open - overdue), color: STATUS.progress, href: `${REGISTER}?sort=gaps:desc` },
    { key: 'overdue', label: 'Overdue', value: overdue, color: STATUS.bad, href: `${REGISTER}?quick=overdue` },
  ];
}

/** The open gaps by how far off their date is (the clock's buckets, in the colour of their tone): overdue opens the register on the assessments with overdue gaps, the others the register by open gaps
 *  (a gap's date is not a filter of the register). A bucket with nothing in it is left out (the legend names what is there); no open gap is no parts. */
export function agingParts(aging: readonly AgeBucket[]): PartItem[] {
  return aging.filter((b) => b.count > 0).map((b) => ({ key: b.key, label: b.label, value: b.count, color: toneColor(b.tone), href: b.key === 'overdue' ? `${REGISTER}?quick=overdue` : `${REGISTER}?sort=gaps:desc` }));
}

export type KpiToneName = 'default' | 'success' | 'warning' | 'danger';
/** The colour of a score's figure: the server's grade (excellent success, fair warning, poor danger; good is the plain figure). */
export const gradeTone = (g: GradeWord | null): KpiToneName => (g === 'excellent' ? 'success' : g === 'fair' ? 'warning' : g === 'poor' ? 'danger' : 'default');
