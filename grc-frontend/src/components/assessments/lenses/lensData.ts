// What the type lenses of the assessment workspace read out of a control and how they count. Pure (`node --test lensData.test.ts`); relative imports with the .ts extension.
//
// Every figure the older tabs drew is kept exactly: the share met is complied / max(1, total - n/a), the ASVS level achieved is the highest level whose requirements all pass,
// the maturity average counts only scores of 1 or more, the DCC share gives a partial answer half. A lens shows these as counts and shares of its own type; the score of the
// assessment is the server's and lives in the workspace's heading.
import { norm } from '../../../lib/status.ts';
import { normaliseItem, type ControlStatus, type RawItem, type WorkItem } from '../workspace/itemModel.ts';

/** A control as the detail read sends it: the workspace's fields plus the two a lens uses. */
export interface LensRaw extends RawItem {
  subdomain_name?: string | null;
  /** the answer per application (ASVS on an uploaded workbook): `{ "<asset id>": "complied" }` */
  asset_status?: Record<string, string> | null;
}

export interface LensItem extends WorkItem {
  /** the sub-heading under the domain (a sub-domain, a section) */
  sub: string;
  assetStatus: Record<string, ControlStatus>;
}

const STATUSES: readonly string[] = ['complied', 'partially_complied', 'not_complied', 'in_progress', 'na'];
const asStatus = (s: string | null | undefined): ControlStatus => (STATUSES.includes(norm(s)) ? (norm(s) as ControlStatus) : 'in_progress');

export function toLensItem(raw: LensRaw): LensItem {
  const base = normaliseItem(raw);
  const per: Record<string, ControlStatus> = {};
  for (const [k, v] of Object.entries(raw.asset_status ?? {})) per[k] = asStatus(v);
  return { ...base, sub: (raw.subdomain_name ?? '').trim(), assetStatus: per };
}

/** The answer of a control; for an application of an uploaded workbook, that application's own answer (not answered when it has none). */
export function answerFor(item: LensItem, assetId: number | null): ControlStatus {
  return assetId == null ? item.status : item.assetStatus[String(assetId)] ?? 'in_progress';
}

// ── reading the remarks ─────────────────────────────────────────────────────────
const grab = (text: string, re: RegExp): string => re.exec(text)?.[1]?.trim() ?? '';

/** ASVS: "ASVS Level: 1 | CWE: 285 | NIST: 5.1.1.2". `level` is 1 when the workbook names none (the older tab read it so). */
export function asvsFacts(remarks: string | null | undefined): { level: number | null; cwe: string; nist: string } {
  const r = remarks ?? '';
  const level = grab(r, /ASVS Level:\s*([0-9]+)/i);
  return { level: level ? Number(level) : null, cwe: grab(r, /CWE:\s*([^|]+)/i), nist: grab(r, /NIST:\s*([^|]+)/i) };
}
export const asvsLevel = (item: Pick<WorkItem, 'remarks'>): number => asvsFacts(item.remarks).level ?? 1;

/** OWASP Testing: "Tools: ... | Note: ... | Desc: ..." (Desc is last and may hold bars). */
export function owaspFacts(remarks: string | null | undefined): { tools: string; note: string; desc: string } {
  const r = remarks ?? '';
  return {
    tools: grab(r, /Tools:\s*([^|]+?)(?:\s*\|\s*(?:Note|Desc):|$)/i),
    note: grab(r, /Note:\s*([^|]+?)(?:\s*\|\s*Desc:|$)/i),
    desc: grab(r, /Desc:\s*([\s\S]*)$/i),
  };
}

/** MASVS: "Platform: Android | MASVS: L1,L2 | MSTG: MSTG-ARCH-1 | Testing: ...". */
export function masvsFacts(remarks: string | null | undefined): { platform: string; levels: string[]; mstg: string; testing: string } {
  const r = remarks ?? '';
  const levels = grab(r, /MASVS:\s*([^|]+)/i);
  return { platform: grab(r, /Platform:\s*([^|]+)/i), levels: levels ? levels.split(',').map((s) => s.trim()).filter(Boolean) : [], mstg: grab(r, /MSTG:\s*([^|]+)/i), testing: grab(r, /Testing:\s*([^|]+)/i) };
}

/** Maturity workbooks: "Weighting: ... | Target: 3 | Dimension: ...". */
export function maturityFacts(remarks: string | null | undefined): { weight: string; target: number | null; dimension: string } {
  const r = remarks ?? '';
  const target = grab(r, /Target:\s*([0-9]+)/i);
  return { weight: grab(r, /Weighting:\s*([^|]+)/i), target: target ? Number(target) : null, dimension: grab(r, /Dimension:\s*([^|]+)/i) };
}

/** PDPL: "PDPL Ref: Art. 5 | Risk: High | Q: what to verify" (parts split on bars, key before the first colon). */
export function pdplFacts(remarks: string | null | undefined): { ref: string; risk: string; question: string } {
  const out = { ref: '', risk: '', question: '' };
  if (!remarks) return out;
  for (const part of remarks.split('|')) {
    const [k, ...rest] = part.split(':');
    const key = (k || '').trim().toLowerCase();
    const val = rest.join(':').trim();
    if (key === 'pdpl ref') out.ref = val;
    else if (key === 'risk') out.risk = val;
    else if (key === 'q') out.question = val;
  }
  return out;
}

/** The evidence a PDPL control asks for: the toolkit's "Evidence to Request" cell, split on ; or a new line. */
export function evidenceAsked(evidenceReference: string | null | undefined): string[] {
  return (evidenceReference ?? '').split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
}

// ── the DCC workbook is bilingual ───────────────────────────────────────────────
const ARABIC = /[؀-ۿ]/;
/** A control reads "<Arabic sentence> <English translation>": English first, the Arabic kept as the second line. Arabic only stays visible. */
export function splitBilingual(text: string | null | undefined): { en: string; ar: string } {
  const t = (text ?? '').trim();
  if (!t) return { en: '', ar: '' };
  if (!ARABIC.test(t)) return { en: t, ar: '' };
  let last = -1;
  for (let i = 0; i < t.length; i++) if (ARABIC.test(t[i])) last = i;
  const en = t.slice(last + 1).replace(/^[\s.,:;،؛-]+/, '').trim();
  const ar = t.slice(0, last + 1).trim();
  return en ? { en, ar } : { en: ar, ar: '' };
}
/** A domain reads "<number>- <Arabic> (English name)": "1 · English name". */
export function englishLabel(text: string | null | undefined): string {
  const t = (text ?? '').trim();
  const num = /^(\d+(?:-\d+)?)/.exec(t)?.[1];
  const paren = /\(([^)]+)\)\s*$/.exec(t)?.[1];
  if (paren) return num ? `${num} · ${paren.trim()}` : paren.trim();
  return splitBilingual(t).en || t;
}
/** The DCC control type the workbook stores in priority: high is Essential, anything else Sub. */
export const dccType = (priority: string): 'essential' | 'sub' => (priority === 'high' ? 'essential' : 'sub');

// ── counting ────────────────────────────────────────────────────────────────────
export interface Tally { total: number; complied: number; partial: number; notComplied: number; na: number; open: number; answered: number }

export function tally(items: readonly LensItem[], statusOf: (item: LensItem) => ControlStatus = (i) => i.status): Tally {
  const t: Tally = { total: items.length, complied: 0, partial: 0, notComplied: 0, na: 0, open: 0, answered: 0 };
  for (const it of items) {
    const s = statusOf(it);
    if (s === 'complied') t.complied += 1;
    else if (s === 'partially_complied') t.partial += 1;
    else if (s === 'not_complied') t.notComplied += 1;
    else if (s === 'na') t.na += 1;
    else t.open += 1;
    if (s !== 'in_progress') t.answered += 1;
  }
  return t;
}

/** The share of applicable controls that are met, 0 to 100: complied / max(1, total - n/a). 0 for nothing. ASVS, OWASP, MASVS. */
export const metShare = (t: Tally): number => (t.total ? Math.round((t.complied / Math.max(1, t.total - t.na)) * 100) : 0);
/** The DCC share: a partial answer counts half. */
export const weightedShare = (t: Tally): number => (t.total ? Math.round(((t.complied + t.partial * 0.5) / Math.max(1, t.total - t.na)) * 100) : 0);
/** Tested share (OWASP Testing coverage): anything but "not answered" over all. */
export const coverageShare = (t: Tally): number => (t.total ? Math.round((t.answered / t.total) * 100) : 0);

/** ASVS: per level, how many requirements pass; the level achieved is the highest L where every requirement of L1..L passes (a level with none stops the climb). */
export function asvsLevels(items: readonly LensItem[], statusOf: (item: LensItem) => ControlStatus = (i) => i.status): { achieved: number; levels: Record<1 | 2 | 3, { total: number; valid: number }> } {
  const levels: Record<1 | 2 | 3, { total: number; valid: number }> = { 1: { total: 0, valid: 0 }, 2: { total: 0, valid: 0 }, 3: { total: 0, valid: 0 } };
  for (const it of items) {
    const l = asvsFacts(it.remarks).level;
    if (l === 1 || l === 2 || l === 3) { levels[l].total += 1; if (statusOf(it) === 'complied') levels[l].valid += 1; }
  }
  let achieved = 0;
  for (const l of [1, 2, 3] as const) {
    if (levels[l].total > 0 && levels[l].valid === levels[l].total) achieved = l; else break;
  }
  return { achieved, levels };
}

/** ASVS on an application: the requirements of a level above the application's target are out of scope. No target: all are in scope. */
export const asvsInScope = (item: LensItem, targetLevel: number | null): boolean => targetLevel == null || asvsLevel(item) <= targetLevel;

/** MASVS: per level (L1, L2, R) the applicable requirements and those that pass; achieved is L1, then L2 once L1 is fully passed (R is reported apart). */
export function masvsLevels(items: readonly LensItem[]): { achieved: '' | 'L1' | 'L2'; levels: Record<'L1' | 'L2' | 'R', { total: number; valid: number }> } {
  const levels = { L1: { total: 0, valid: 0 }, L2: { total: 0, valid: 0 }, R: { total: 0, valid: 0 } };
  for (const it of items) {
    if (it.status === 'na') continue;
    for (const l of masvsFacts(it.remarks).levels) {
      if (l === 'L1' || l === 'L2' || l === 'R') { levels[l].total += 1; if (it.status === 'complied') levels[l].valid += 1; }
    }
  }
  let achieved: '' | 'L1' | 'L2' = '';
  if (levels.L1.total > 0 && levels.L1.valid === levels.L1.total) achieved = 'L1';
  if (achieved === 'L1' && levels.L2.total > 0 && levels.L2.valid === levels.L2.total) achieved = 'L2';
  return { achieved, levels };
}

/** The platforms of a MASVS workbook, Android first. */
export function masvsPlatforms(items: readonly LensItem[]): string[] {
  const set: string[] = [];
  for (const it of items) { const p = masvsFacts(it.remarks).platform; if (p && !set.includes(p)) set.push(p); }
  return set.sort((a, b) => (a === 'Android' ? -1 : b === 'Android' ? 1 : a.localeCompare(b)));
}

// ── maturity ────────────────────────────────────────────────────────────────────
export const MATURITY_LEVELS = [
  { n: 1, label: 'Initial', desc: 'Ad-hoc and undocumented. Processes are reactive and unpredictable.' },
  { n: 2, label: 'Established', desc: 'Basic processes are defined, documented and repeatable.' },
  { n: 3, label: 'Business enabling', desc: 'Processes are standardised and proactive across the organization.' },
  { n: 4, label: 'Quantitatively managed', desc: 'Processes are measured and controlled using metrics.' },
  { n: 5, label: 'Optimised', desc: 'Continuous improvement; processes are optimised and adaptive.' },
] as const;

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export interface MaturityStats { avg: number; target: number; hasTarget: boolean; answered: number; total: number }
/** The average of the scores of 1 or more (0 is "not assessed" for the type), the average target, how many are scored. */
export function maturityStats(items: readonly LensItem[]): MaturityStats {
  const scored = items.map((i) => i.maturity).filter((s): s is number => typeof s === 'number' && s >= 1);
  const targets = items.map((i) => maturityFacts(i.remarks).target).filter((t): t is number => typeof t === 'number');
  return { avg: mean(scored), target: mean(targets), hasTarget: targets.length > 0, answered: scored.length, total: items.length };
}
/** "L3 · Business enabling" for a rounded average; "—" below 1. */
export function maturityBand(avg: number): string {
  if (!(avg >= 1)) return '—';
  const n = Math.min(5, Math.max(1, Math.round(avg)));
  return `L${n} · ${MATURITY_LEVELS[n - 1].label}`;
}

// ── PDPL ────────────────────────────────────────────────────────────────────────
export const PDPL_LEVELS = ['Absent', 'Initial', 'Developing', 'Defined', 'Managed', 'Optimised'] as const;
export const PDPL_LEVEL_DESC = [
  'Nothing in place: the control is not implemented.',
  'Ad hoc or informal: some awareness but nothing documented.',
  'Partly implemented: documented but inconsistent or incomplete.',
  'Defined: documented and consistently implemented across the organization.',
  'Managed: implemented and actively monitored, with records.',
  'Optimised: fully embedded, regularly reviewed and improved.',
] as const;
/** What a maturity score makes of the answer (the server does the same on every write): 3 to 5 complied, 1 to 2 partly, 0 not complied, none not answered. */
export function answerFromMaturity(score: number | null | undefined): ControlStatus {
  if (score == null || score < 0) return 'in_progress';
  return score >= 3 ? 'complied' : score <= 0 ? 'not_complied' : 'partially_complied';
}
/** The kind of document a piece of evidence the toolkit asks for is, so the template downloaded has the right shape (a register is a table, a policy has policy sections). */
export function artifactTypeOf(name: string): string {
  const n = name.toLowerCase();
  if (/\b(policy|policies)\b/.test(n)) return 'Policy';
  if (/\b(procedure|process|liaison)\b/.test(n)) return 'Procedure';
  if (/\b(register|records?|ropa|inventory|log|map)\b/.test(n)) return 'Register';
  if (/\b(plan|roadmap)\b/.test(n)) return 'Plan';
  if (/\b(report|assessment|dpia|audit)\b/.test(n)) return 'Report';
  if (/\b(nda|contract|clause|agreement|dpa)\b/.test(n)) return 'Contract';
  if (/\b(letter|appointment|confirmation|attestation|mandate)\b/.test(n)) return 'Attestation';
  if (/\b(raci|matrix|chart)\b/.test(n)) return 'Register';
  if (/\b(form|template|consent)\b/.test(n)) return 'Form/Template';
  return 'Evidence';
}
/** A control only has a gap to record once it is scored below 3. */
export const isGapScore = (score: number | null | undefined): boolean => score != null && score < 3;

// ── grouping, searching ─────────────────────────────────────────────────────────
export interface Group<T> { name: string; items: T[] }
/** The rows grouped by `key`, in the order the workbook lists them (or sorted by `order`). */
export function groupBy<T>(items: readonly T[], key: (item: T) => string, order?: (a: string, b: string) => number): Array<Group<T>> {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = map.get(k);
    if (list) list.push(it); else map.set(k, [it]);
  }
  const groups = Array.from(map.entries()).map(([name, list]) => ({ name, items: list }));
  return order ? groups.sort((a, b) => order(a.name, b.name)) : groups;
}
/** The controls grouped by their domain. */
export const groupOf = <T extends { domain: string }>(items: readonly T[], order?: (a: string, b: string) => number): Array<Group<T>> => groupBy(items, (i) => i.domain, order);
/** "1-2 Governance" before "10 Risk": the number the domain starts with, else last. */
export function byLeadingNumber(a: string, b: string): number {
  const n = (s: string): number => { const m = /^(\d+)/.exec(s); return m ? parseInt(m[1], 10) : 99; };
  return n(a) - n(b) || a.localeCompare(b);
}
export const matchesText = (text: string, q: string): boolean => {
  const needle = q.trim().toLowerCase();
  return !needle || text.toLowerCase().includes(needle);
};
