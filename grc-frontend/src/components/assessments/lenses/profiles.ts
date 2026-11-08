// The profiles of the requirements lens: what makes ASVS, OWASP Testing, MASVS, the maturity assessments, the DCC tool and the PDPL toolkit differ from one another, as data and
// pure functions (the engine, RequirementsLens.tsx, draws them all the same way). Pure (`node --test profiles.test.ts`); relative imports with the .ts extension.
//
// One status vocabulary for every type (audit decision 12): Complied / Partially complied / Not complied / Not answered / Not applicable. A profile says which of the five its
// select offers, what it counts, which facts a row carries and what the tiles say. No profile shows a "score": the score of the assessment is the server's, in the heading.
import { formatCount } from '../../../lib/format.ts';
import type { ControlStatus } from '../workspace/itemModel.ts';
import {
  answerFor, asvsFacts, asvsInScope, asvsLevels, byLeadingNumber, coverageShare, dccType, englishLabel, maturityBand, maturityFacts, maturityStats, masvsFacts, masvsLevels, masvsPlatforms, metShare,
  owaspFacts, pdplFacts, splitBilingual, tally, weightedShare, type LensItem,
} from './lensData.ts';

export type Tone = 'default' | 'success' | 'warning' | 'danger';
export interface Tile { label: string; value: string; unit?: string; note?: string; tone?: Tone; progress?: number | null; info?: string }
export interface Fact { label: string; value: string; long?: boolean; rtl?: boolean }
export interface FacetOption { value: string; label: string }

/** What a profile may look at besides the control: the application whose answers are shown (ASVS on an uploaded workbook), its target level, the partition chosen (MASVS platform). */
export interface Ctx { assetId: number | null; targetLevel: number | null; partition: string }

export interface Profile {
  key: string;
  /** the name of one control in this type, lower case: "requirement", "test", "question", "control" */
  noun: string;
  /** what the groups are called: "category", "domain" */
  groupNoun: string;
  /** which answers the select offers, in this order */
  answers: readonly ControlStatus[];
  /** a maturity scale instead of an answer: the select sets `maturity_score` and the server derives the answer */
  scale: null | { from: 0 | 1; to: 5 };
  /** attaching evidence to a control that is not complied sets it to complied (what ASVS, OWASP, MASVS and the DCC tool always did) */
  passOnEvidence: boolean;
  groupName?: (item: LensItem) => string;
  groupOrder?: (a: string, b: string) => number;
  /** the groups are the workbook's order unless this says otherwise */
  partition?: { label: string; values: (items: readonly LensItem[]) => string[]; of: (item: LensItem) => string };
  /** a multi-choice facet beside the answer filter ("Level") */
  facet?: { label: string; options: (items: readonly LensItem[]) => FacetOption[]; match: (item: LensItem, chosen: readonly string[]) => boolean };
  searchText: (item: LensItem) => string;
  /** the short facts under the control's text: "L2", "Android", "Essential" */
  chips: (item: LensItem) => string[];
  /** the facts a row opens to (level, tools, testing steps...) */
  facts: (item: LensItem) => Fact[];
  /** the applicable controls: the ones outside the application's target level are dropped (ASVS) */
  inScope?: (item: LensItem, ctx: Ctx) => boolean;
  tiles: (items: readonly LensItem[], ctx: Ctx) => Tile[];
  /** the progress shown in a group's heading: "12 of 14 met" */
  meter: (items: readonly LensItem[], ctx: Ctx) => { text: string; value: number | null; target?: number | null };
  /** the one line of help above the list ('' for none) */
  help: string;
}

const ALL_FIVE: readonly ControlStatus[] = ['complied', 'partially_complied', 'not_complied', 'in_progress', 'na'];
const PASS_FAIL: readonly ControlStatus[] = ['complied', 'not_complied', 'in_progress', 'na'];
const count = (n: number): string => formatCount(n);
const metText = (t: ReturnType<typeof tally>): string => `${count(t.complied)} of ${count(Math.max(0, t.total - t.na))} met`;
const plural = (n: number, one: string, other = `${one}s`): string => (n === 1 ? one : other);

// ── OWASP ASVS ──────────────────────────────────────────────────────────────────
export const ASVS: Profile = {
  key: 'asvs', noun: 'requirement', groupNoun: 'category', answers: PASS_FAIL, scale: null, passOnEvidence: true,
  facet: {
    label: 'Level',
    options: () => [{ value: '1', label: 'Level 1' }, { value: '2', label: 'Level 2' }, { value: '3', label: 'Level 3' }],
    match: (it, chosen) => chosen.includes(String(asvsFacts(it.remarks).level ?? 1)),
  },
  searchText: (it) => `${it.number} ${it.description} ${it.sub}`,
  chips: (it) => { const l = asvsFacts(it.remarks).level; return l ? [`Level ${l}`] : []; },
  facts: (it) => { const f = asvsFacts(it.remarks); return [{ label: 'Level', value: f.level ? `Level ${f.level}` : '' }, { label: 'Section', value: it.sub }, { label: 'CWE', value: f.cwe }, { label: 'NIST', value: f.nist }].filter((x) => x.value); },
  inScope: (it, ctx) => asvsInScope(it, ctx.targetLevel),
  tiles: (items, ctx) => {
    const t = tally(items, (i) => answerFor(i, ctx.assetId));
    const { achieved, levels } = asvsLevels(items, (i) => answerFor(i, ctx.assetId));
    return [
      { label: 'Requirements met', value: count(t.complied), unit: `of ${count(Math.max(0, t.total - t.na))}`, progress: metShare(t), note: t.na ? `${count(t.na)} not applicable` : undefined, info: 'The share of applicable requirements that comply. A requirement that does not apply is left out.' },
      { label: 'Level reached', value: achieved ? `Level ${achieved}` : 'None yet', note: ([1, 2, 3] as const).map((l) => `L${l} ${count(levels[l].valid)}/${count(levels[l].total)}`).join(' · '), tone: achieved ? 'success' : 'default', info: 'The highest level whose requirements all comply, counting from level 1.' },
      { label: 'Requirements', value: count(t.total), note: `${count(t.answered)} tested`, info: ctx.targetLevel != null ? `Only the requirements up to level ${ctx.targetLevel} apply to this application.` : undefined },
      { label: 'Not complied', value: count(t.notComplied), tone: t.notComplied ? 'danger' : 'default', note: `${count(t.open)} not tested` },
    ];
  },
  meter: (items, ctx) => { const t = tally(items, (i) => answerFor(i, ctx.assetId)); return { text: metText(t), value: t.total ? metShare(t) : null }; },
  help: 'Set each requirement to Complied or Not complied as it is tested. Attaching a file to a requirement marks it complied.',
};

// ── OWASP Testing Guide ─────────────────────────────────────────────────────────
export const OWASP: Profile = {
  key: 'owasp', noun: 'test', groupNoun: 'category', answers: PASS_FAIL, scale: null, passOnEvidence: true,
  searchText: (it) => `${it.number} ${it.description} ${owaspFacts(it.remarks).desc}`,
  chips: (it) => { const t = owaspFacts(it.remarks).tools; return t ? [t] : []; },
  facts: (it) => { const f = owaspFacts(it.remarks); return [{ label: 'Recommended tools', value: f.tools }, { label: 'Note', value: f.note, long: true }, { label: 'What to test', value: f.desc, long: true }].filter((x) => x.value); },
  tiles: (items) => {
    const t = tally(items);
    return [
      { label: 'Tested', value: count(t.answered), unit: `of ${count(t.total)}`, progress: coverageShare(t), info: 'The share of tests that have a result, whatever it is.' },
      { label: 'Complied', value: count(t.complied), tone: t.complied ? 'success' : 'default' },
      { label: 'Issues found', value: count(t.notComplied), tone: t.notComplied ? 'danger' : 'default', note: 'tests with a result of Not complied' },
      { label: 'Not applicable', value: count(t.na), note: `${count(t.open)} not tested` },
    ];
  },
  meter: (items) => { const t = tally(items); return { text: `${count(t.answered)} of ${count(t.total)} tested`, value: t.total ? coverageShare(t) : null }; },
  help: 'Set each test to Complied or Not complied when it has been run. Attaching a file to a test marks it complied.',
};

// ── OWASP MASVS ─────────────────────────────────────────────────────────────────
export const MASVS: Profile = {
  key: 'mobile', noun: 'requirement', groupNoun: 'category', answers: PASS_FAIL, scale: null, passOnEvidence: true,
  groupOrder: (a, b) => a.localeCompare(b),
  partition: { label: 'Platform', values: masvsPlatforms, of: (it) => masvsFacts(it.remarks).platform },
  facet: {
    label: 'Level',
    options: () => [{ value: 'L1', label: 'L1' }, { value: 'L2', label: 'L2' }, { value: 'R', label: 'Resilience' }],
    match: (it, chosen) => masvsFacts(it.remarks).levels.some((l) => chosen.includes(l)),
  },
  searchText: (it) => `${it.number} ${it.description} ${masvsFacts(it.remarks).mstg}`,
  chips: (it) => masvsFacts(it.remarks).levels,
  facts: (it) => { const f = masvsFacts(it.remarks); return [{ label: 'Platform', value: f.platform }, { label: 'Levels', value: f.levels.join(', ') }, { label: 'MSTG reference', value: f.mstg }, { label: 'How to test', value: f.testing, long: true }].filter((x) => x.value); },
  tiles: (items) => {
    const t = tally(items);
    const { achieved, levels } = masvsLevels(items);
    return [
      { label: 'Requirements met', value: count(t.complied), unit: `of ${count(Math.max(0, t.total - t.na))}`, progress: metShare(t), note: t.na ? `${count(t.na)} not applicable` : undefined },
      { label: 'Level reached', value: achieved || 'None yet', tone: achieved ? 'success' : 'default', note: (['L1', 'L2', 'R'] as const).map((l) => `${l} ${count(levels[l].valid)}/${count(levels[l].total)}`).join(' · '), info: 'L1, then L2 once L1 is fully met. Resilience (R) is counted apart.' },
      { label: 'Requirements', value: count(t.total), note: `${count(t.answered)} tested` },
      { label: 'Not complied', value: count(t.notComplied), tone: t.notComplied ? 'danger' : 'default', note: `${count(t.open)} not tested` },
    ];
  },
  meter: (items) => { const t = tally(items); return { text: metText(t), value: t.total ? metShare(t) : null }; },
  help: 'Choose the platform, then set each requirement to Complied or Not complied. Attaching a file to a requirement marks it complied.',
};

// ── maturity (CSIR, CTI, Incident, IT Security Operations, Digital Operations) ──
export const MATURITY: Profile = {
  key: 'maturity', noun: 'question', groupNoun: 'domain', answers: ALL_FIVE, scale: { from: 1, to: 5 }, passOnEvidence: false,
  searchText: (it) => `${it.number} ${it.description} ${it.sub}`,
  chips: (it) => { const m = maturityFacts(it.remarks); return [m.dimension, m.target != null ? `Target L${m.target}` : ''].filter(Boolean); },
  facts: (it) => { const m = maturityFacts(it.remarks); return [{ label: 'Sub-heading', value: it.sub }, { label: 'Dimension', value: m.dimension }, { label: 'Weight', value: m.weight }, { label: 'Target', value: m.target != null ? `Level ${m.target}` : '' }].filter((x) => x.value); },
  tiles: (items) => {
    const s = maturityStats(items);
    const gap = s.target - s.avg;
    return [
      { label: 'Average maturity', value: s.avg ? s.avg.toFixed(1) : '—', unit: s.avg ? 'of 5' : undefined, progress: s.avg ? (s.avg / 5) * 100 : null, info: 'The average of the questions that have a level of 1 to 5.' },
      s.hasTarget
        ? { label: 'Target', value: s.target.toFixed(1), note: s.answered ? `${gap > 0.05 ? 'Gap' : 'Ahead by'} ${Math.abs(gap).toFixed(1)}` : undefined, info: 'The average target level of the questions, against the average reached.' }
        : { label: 'Answered', value: count(s.answered), unit: `of ${count(s.total)}`, progress: s.total ? Math.round((s.answered / s.total) * 100) : null },
      { label: 'Questions', value: count(s.total), note: `${count(s.answered)} answered` },
      { label: 'Maturity band', value: maturityBand(s.avg).split(' · ')[0], note: maturityBand(s.avg).split(' · ')[1] ?? 'the rounded average level' },
    ];
  },
  meter: (items) => { const s = maturityStats(items); return { text: `${s.avg ? s.avg.toFixed(1) : '—'} of 5 · ${count(s.answered)}/${count(s.total)} answered`, value: s.avg ? (s.avg / 5) * 100 : null, target: s.hasTarget ? (s.target / 5) * 100 : null }; },
  help: 'Choose the level each capability has reached, from 1 (initial) to 5 (optimised). The answer follows the level: 3 and above is complied.',
};

// ── NCA DCC-1:2022 (bilingual) ──────────────────────────────────────────────────
export const DCC: Profile = {
  key: 'dcc', noun: 'control', groupNoun: 'domain', answers: ALL_FIVE, scale: null, passOnEvidence: true,
  groupName: (it) => englishLabel(it.domain), groupOrder: byLeadingNumber,
  facet: {
    label: 'Type',
    options: () => [{ value: 'essential', label: 'Essential' }, { value: 'sub', label: 'Sub-control' }],
    match: (it, chosen) => chosen.includes(dccType(it)),
  },
  searchText: (it) => `${it.number} ${splitBilingual(it.description).en} ${it.sub}`,
  chips: (it) => [dccType(it) === 'essential' ? 'Essential' : 'Sub-control'],
  facts: (it) => { const b = splitBilingual(it.description); return [{ label: 'Sub-domain', value: englishLabel(it.sub) }, { label: 'Arabic text', value: b.ar, long: true, rtl: true }].filter((x) => x.value); },
  tiles: (items) => {
    const t = tally(items);
    const essential = items.filter((i) => dccType(i) === 'essential').length;
    return [
      { label: 'Compliance', value: `${weightedShare(t)}%`, progress: weightedShare(t), info: 'Implemented controls count whole, partly implemented ones count half. A control that does not apply is left out.' },
      { label: 'Controls', value: count(t.total), note: `${count(t.answered)} assessed` },
      { label: 'Essential and sub-controls', value: `${count(essential)} / ${count(t.total - essential)}` },
      { label: 'Implemented', value: count(t.complied), tone: t.complied ? 'success' : 'default' },
    ];
  },
  meter: (items) => { const t = tally(items); return { text: `${count(t.complied)} of ${count(t.total)} implemented`, value: t.total ? weightedShare(t) : null }; },
  help: 'Set each control to its state. Attaching a file to a control marks it implemented.',
};

// ── Saudi PDPL toolkit ──────────────────────────────────────────────────────────
export const PDPL: Profile = {
  key: 'pdpl', noun: 'control', groupNoun: 'domain', answers: ALL_FIVE, scale: { from: 0, to: 5 }, passOnEvidence: false,
  searchText: (it) => `${it.number} ${it.description} ${pdplFacts(it.remarks).ref}`,
  chips: (it) => { const f = pdplFacts(it.remarks); return f.ref ? [f.ref] : []; },
  facts: (it) => { const f = pdplFacts(it.remarks); return [{ label: 'PDPL reference', value: f.ref }, { label: 'Question', value: f.question, long: true }, { label: 'Evidence to look for', value: it.evidenceReference, long: true }].filter((x) => x.value); },
  tiles: (items) => {
    const t = tally(items);
    const assessed = t.complied + t.partial + t.notComplied;
    const pct = assessed ? Math.round(((t.complied + t.partial * 0.5) / assessed) * 100) : 0;
    const scored = items.map((i) => i.maturity).filter((n): n is number => typeof n === 'number');
    const avg = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null;
    return [
      { label: 'Compliance', value: assessed ? `${pct}%` : '—', progress: assessed ? pct : null, info: 'Among the controls assessed: compliant controls count whole, partial ones half.' },
      { label: 'Average maturity', value: avg === null ? '—' : avg.toFixed(1), unit: avg === null ? undefined : 'of 5', note: `${count(scored.length)} scored` },
      { label: 'Gaps', value: count(t.partial + t.notComplied), tone: t.partial + t.notComplied ? 'warning' : 'default', note: `${count(t.notComplied)} not compliant · ${count(t.partial)} partial`, info: 'Controls scored below 3.' },
      { label: 'Not assessed', value: count(t.open), note: `${count(t.complied)} compliant` },
    ];
  },
  meter: (items) => { const t = tally(items); return { text: `${count(t.complied)} of ${count(t.total)} compliant`, value: t.total ? Math.round((t.complied / t.total) * 100) : null }; },
  help: 'Score each control from 0 to 5. The answer follows the score: 3 and above is compliant, 1 and 2 partial, 0 not compliant. Below 3 a gap is recorded.',
};

/** The profile of a format; null for a format that has no requirements lens. */
export function profileFor(format: string | null | undefined): Profile | null {
  switch (format) {
    case 'asvs_checklist': return ASVS;
    case 'owasp_v4_testing_checklist': return OWASP;
    case 'mobile_app_security': return MASVS;
    case 'csir_maturity': case 'cti_maturity': case 'incident_maturity': case 'itsecops_maturity': case 'digital_ops_maturity': return MATURITY;
    case 'nca_dcc_tool': return DCC;
    case 'pdpl_assessment_toolkit': return PDPL;
    default: return null;
  }
}

export const countText = (n: number, p: Profile): string => `${count(n)} ${plural(n, p.noun)}`;
