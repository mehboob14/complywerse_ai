// The risk register lenses read: the likelihood by impact heat map shared by the DPIA lens and the NCA registers, the DPIA workbook's remarks (a screening answer, a risk with its
// inherent and residual rating), and the NCA registers' rows (one JSON object per control, written by the workbook parser). Pure (`node --test riskModel.test.ts`).
//
// The DPIA scale is its own (score = likelihood x impact: 15 and above critical, 10 high, 5 medium, 1 low): the platform's risk register uses 20 / 12 / 6 and the two are not
// mixed. Every figure the older tabs drew is kept.
import { norm } from '../../../lib/status.ts';
import type { LensItem } from './lensData.ts';

export type Band = 'critical' | 'high' | 'medium' | 'low' | 'none';
export const BAND_LABEL: Record<Band, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', none: '—' };
export const BANDS_ORDER: readonly Band[] = ['critical', 'high', 'medium', 'low'];

/** The DPIA band of a likelihood x impact score. */
export function bandOfScore(score: number): Band {
  if (score >= 15) return 'critical';
  if (score >= 10) return 'high';
  if (score >= 5) return 'medium';
  if (score >= 1) return 'low';
  return 'none';
}

export interface HeatPoint { l: number; i: number; id: string }
export interface HeatCell { l: number; i: number; band: Band; ids: string[] }

/** The 5 x 5 grid, likelihood 5 at the top, impact 1 to 5 across: each cell holds the risks that sit in it. A value outside 1 to 5 is not on the grid. */
export function heatGrid(points: readonly HeatPoint[]): HeatCell[][] {
  return [5, 4, 3, 2, 1].map((l) => [1, 2, 3, 4, 5].map((i) => ({ l, i, band: bandOfScore(l * i), ids: points.filter((p) => p.l === l && p.i === i).map((p) => p.id) })));
}

// ── the DPIA workbook ────────────────────────────────────────────────────────────
/** "Section: risk | L: 3 | ..." -> "risk". */
export const sectionOf = (remarks: string | null | undefined): string => /Section:\s*(\w+)/i.exec(remarks ?? '')?.[1]?.toLowerCase() ?? '';
/** The value of "Key: value" inside the pipe-delimited remarks ('' when absent). */
export const fieldOf = (remarks: string | null | undefined, key: string): string => new RegExp(`${key}:\\s*([^|]+)`, 'i').exec(remarks ?? '')?.[1]?.trim() ?? '';

/** Set or replace one field of the remarks, leaving the others as they are (a new remarks starts as a screening row, as the workbook's own rows do). */
export function withField(remarks: string | null | undefined, key: string, value: string): string {
  const r = remarks || 'Section: screening';
  const re = new RegExp(`${key}:\\s*[^|]*`, 'i');
  return re.test(r) ? r.replace(re, `${key}: ${value} `) : `${r.trim()} | ${key}: ${value}`;
}

export interface Risk {
  itemId: number; id: string; category: string; text: string; subjects: string;
  l: number; i: number; score: number; resL: number; resI: number; resScore: number;
  owner: string; framework: string; status: string; target: string; controls: string;
}
export function toRisk(it: LensItem): Risk {
  const r = it.remarks;
  const n = (k: string): number => { const v = parseInt(fieldOf(r, k), 10); return Number.isNaN(v) ? 0 : v; };
  const l = n('L'), i = n('I'), resL = n('ResL'), resI = n('ResI');
  return {
    itemId: it.id, id: it.number, category: it.domain || 'Uncategorised', text: it.description, subjects: fieldOf(r, 'Subjects'),
    l, i, score: Number(fieldOf(r, 'Inherent')) || l * i, resL, resI, resScore: Number(fieldOf(r, 'Residual')) || resL * resI,
    owner: fieldOf(r, 'Owner'), framework: fieldOf(r, 'Framework'), status: fieldOf(r, 'Status'), target: fieldOf(r, 'Target'), controls: fieldOf(r, 'Controls'),
  };
}

export interface Screening { yes: number; answered: number; total: number; required: boolean }
/** Screening: one "Yes" normally means a full DPIA is required. */
export function screeningVerdict(items: readonly LensItem[]): Screening {
  const rows = items.filter((i) => sectionOf(i.remarks) === 'screening');
  const yes = rows.filter((s) => /yes/i.test(fieldOf(s.remarks, 'Answer'))).length;
  return { yes, answered: rows.filter((s) => fieldOf(s.remarks, 'Answer')).length, total: rows.length, required: yes > 0 };
}
export const answerOfScreening = (it: LensItem): 'yes' | 'no' | '' => { const a = fieldOf(it.remarks, 'Answer').toLowerCase(); return a === 'yes' ? 'yes' : a === 'no' ? 'no' : ''; };

export interface RiskKpis { total: number; critical: number; high: number; avgInherent: number; avgResidual: number }
export function riskKpis(risks: readonly Risk[]): RiskKpis {
  const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    total: risks.length, critical: risks.filter((r) => r.score >= 15).length, high: risks.filter((r) => r.score >= 10 && r.score < 15).length,
    avgInherent: mean(risks.map((r) => r.score)), avgResidual: mean(risks.map((r) => r.resScore || r.score)),
  };
}

// ── the NCA registers ────────────────────────────────────────────────────────────
export type RegisterKind = 'vuln' | 'audit' | 'risk';
export interface RegisterCfg {
  format: string; title: string; noun: string;
  /** the column headers (words that all appear in it) that hold the rating, the likelihood and the impact */
  sev: string[]; like: string[]; imp: string[];
  res: null | { sev: string[]; like: string[]; imp: string[] };
  /** the columns shown as the row's tag, and under its text */
  chips: string[]; inline: string[];
}
export const REGISTERS: Record<RegisterKind, RegisterCfg> = {
  vuln: { format: 'nca_vuln_register', title: 'Vulnerability register', noun: 'vulnerabilities', sev: ['risk level'], like: ['risk likelihood'], imp: ['risk severity'], res: null, chips: ['cve number', 'status'], inline: ['affected assets', 'owner', 'due date'] },
  audit: { format: 'nca_audit_register', title: 'Audit plan', noun: 'audits', sev: [], like: [], imp: [], res: null, chips: ['type of audit'], inline: ['lead auditor', 'team responsible', 'audit start', 'audit end'] },
  risk: { format: 'nca_risk_register', title: 'Risk register', noun: 'risks', sev: ['inherent', 'rating'], like: ['inherent', 'likelihood'], imp: ['inherent', 'magnitude'], res: { sev: ['resid', 'rating'], like: ['resid', 'likelihood'], imp: ['resid', 'magnitude'] }, chips: ['type of treatment'], inline: ['risk owner', 'threat', 'deadline for action'] },
};
export const registerKindOf = (format: string | null | undefined): RegisterKind | null => (Object.keys(REGISTERS) as RegisterKind[]).find((k) => REGISTERS[k].format === format) ?? null;

/** The row the workbook parser stored in `remarks` (an object of column header to text); {} when it is not one. */
export function parseRow(remarks: string | null | undefined): Record<string, string> {
  try { const v = JSON.parse(remarks || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}
/** The value of the column whose header holds ALL of the words. */
export function pick(row: Record<string, string>, words: readonly string[]): string {
  const k = Object.keys(row).find((x) => words.every((w) => x.toLowerCase().includes(w.toLowerCase())));
  return k ? String(row[k] ?? '') : '';
}
export const toNum = (s: string): number => { const n = parseInt(String(s).replace(/[^\d]/g, ''), 10); return Number.isNaN(n) ? 0 : n; };

/** "Very Low", "Critical" ... as the register words it ('' when it names none). */
export type NamedBand = 'Critical' | 'High' | 'Medium' | 'Low' | 'Very Low';
export const NAMED_BANDS: readonly NamedBand[] = ['Critical', 'High', 'Medium', 'Low', 'Very Low'];
export function namedBand(v: string | null | undefined): NamedBand | '' {
  const t = (v ?? '').toLowerCase();
  if (t.includes('critical')) return 'Critical';
  if (t.includes('very low')) return 'Very Low';
  if (t.includes('high')) return 'High';
  if (t.includes('medium')) return 'Medium';
  if (t.includes('low')) return 'Low';
  return '';
}
export const namedBandBand = (b: NamedBand | ''): Band => (b === 'Critical' ? 'critical' : b === 'High' ? 'high' : b === 'Medium' ? 'medium' : b ? 'low' : 'none');

export interface Entry { item: LensItem; row: Record<string, string>; sev: string; l: number; i: number; res: null | { sev: string; l: number; i: number } }
export function entriesOf(items: readonly LensItem[], cfg: RegisterCfg): Entry[] {
  return items.map((item) => {
    const row = parseRow(item.remarks);
    return {
      item, row, sev: cfg.sev.length ? pick(row, cfg.sev) : '', l: cfg.like.length ? toNum(pick(row, cfg.like)) : 0, i: cfg.imp.length ? toNum(pick(row, cfg.imp)) : 0,
      res: cfg.res ? { sev: pick(row, cfg.res.sev), l: toNum(pick(row, cfg.res.like)), i: toNum(pick(row, cfg.res.imp)) } : null,
    };
  });
}
export interface RegisterKpis { total: number; open: number; resolved: number; critHigh: number; distribution: Record<string, number>; inherent: HeatPoint[]; residual: HeatPoint[] }
export function registerKpis(entries: readonly Entry[], cfg: RegisterCfg): RegisterKpis {
  const distribution: Record<string, number> = {};
  for (const e of entries) { const b = namedBand(e.sev); if (b) distribution[b] = (distribution[b] || 0) + 1; }
  return {
    total: entries.length,
    open: entries.filter((e) => norm(e.item.status) === 'in_progress').length,
    resolved: entries.filter((e) => e.item.status === 'complied').length,
    critHigh: entries.filter((e) => /critical|high/i.test(e.sev)).length,
    distribution,
    inherent: entries.filter((e) => e.l >= 1 && e.i >= 1).map((e) => ({ l: e.l, i: e.i, id: e.item.number })),
    residual: cfg.res ? entries.filter((e) => e.res && e.res.l >= 1 && e.res.i >= 1).map((e) => ({ l: e.res!.l, i: e.res!.i, id: e.item.number })) : [],
  };
}
