// The Control Library's rules as pure functions (no React), so `node --test` pins them: how complete a control group is, the headline figures of the page and how they change when the person builds a view of
// some frameworks ("Build your view": a live filter over the whole library, no re-run), and the plain-words reconciliation of how many framework controls the unified controls come from. The formulas are
// the ones the page had; nothing here redefines a number.
//   completion % = 20 for each of: a description, a category, a domain, keywords, at least one control (0 for a group with no control)
//   shared       = a group's unified controls minus its standalone ones (required by two or more frameworks); unique = standalone (required by one)
//   duplicates   = the framework controls the library started from, minus the unified controls
import type { Tone } from '../../../../lib/status.ts';

export interface ControlGroup {
  id: number;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  domain: string | null;
  keywords: string[];
  normalized_control_count: number;
  standalone_control_count: number;
  total_control_count: number;
}
export interface GroupsResponse {
  items: ControlGroup[];
  total: number;
  skip: number;
  limit: number;
  total_mapped_controls?: number;
  total_raw_controls?: number;
  library_framework_count?: number;
}

// Short framework labels, one copy (the library page and a domain page each had their own): the first part of the name that matches wins.
const SHORT: ReadonlyArray<readonly [string, string]> = [
  ['ARAMCO', 'ARAMCO'], ['COBIT', 'COBIT'], ['Health Information', 'DOH ADHIE'], ['ADHIE', 'DOH ADHIE'],
  ['Abu Dhabi', 'ADHICS'], ['DOH', 'DOH ADHIE'], ['HIPAA', 'HIPAA'], ['HITRUST', 'HITRUST'], ['22301', 'ISO 22301'],
  ['42001', 'ISO 42001'], ['27001', 'ISO 27001'], ['MAS', 'MAS TRM'], ['Artificial Intelligence', 'NIST AI RMF'],
  ['800-53', 'NIST 800-53'], ['Cybersecurity Framework', 'NIST CSF'], ['PCI', 'PCI DSS'], ['Qatar', 'Qatar CB'],
  ['SABIC', 'SABIC'], ['SAMA', 'SAMA'], ['SBP Cloud', 'SBP Cloud'], ['ETGRMF', 'SBP ETGRMF'],
  ['Internet Banking', 'SBP IB'], ['SOX', 'SOX'], ['SWIFT', 'SWIFT'], ['Sri Lanka', 'Sri Lanka'],
  ['Personal Data Transfer', 'KSA Transfer'], ['CIS', 'CIS'], ['General Data', 'GDPR'],
  ['National Data', 'KSA NDMO'], ['Digital Operational', 'DORA'], ['NIS2', 'NIS2'], ['SOC', 'SOC 2'],
];
export const shortFramework = (name: string | null | undefined): string => {
  const n = name || '';
  for (const [key, label] of SHORT) if (n.includes(key)) return label;
  return n.split(' ')[0];
};

// ── a group ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function completionOf(g: Pick<ControlGroup, 'total_control_count' | 'description' | 'category' | 'domain' | 'keywords'>): number {
  if (g.total_control_count === 0) return 0;
  return (g.description ? 20 : 0) + (g.category ? 20 : 0) + (g.domain ? 20 : 0) + ((g.keywords?.length || 0) > 0 ? 20 : 0) + 20;
}
/** The tone of a completion bar: 70 and over good, 40 and over needs a look, below that weak. */
export const completionTone = (pct: number): Tone => (pct >= 70 ? 'success' : pct >= 40 ? 'warning' : 'danger');

export const sharedOf = (g: Pick<ControlGroup, 'normalized_control_count' | 'standalone_control_count'>): number =>
  Math.max(0, (g.normalized_control_count ?? 0) - (g.standalone_control_count ?? 0));

/** Shared and unique over a set of groups. */
export function splitOf(groups: readonly ControlGroup[]): { sets: number; standalone: number } {
  return {
    sets: groups.reduce((a, g) => a + sharedOf(g), 0),
    standalone: groups.reduce((a, g) => a + (g.standalone_control_count ?? 0), 0),
  };
}

// ── "Build your view": the framework filter over every group ─────────────────────────────────────────────────────────────────────────────

/** What one group holds, framework by framework: each normalized set as the (short) frameworks in it, and the controls no other framework repeats. Built from GET /groups/{id}/rich. */
export interface GroupCoverage { sets: string[][]; standalone: string[] }
export interface Coverage { byDomain: Record<number, GroupCoverage>; frameworks: string[]; fwTotals: Record<string, number> }

export interface RichForCoverage {
  sets?: Array<{ members?: Array<{ framework: string }> }>;
  standalone_controls?: Array<{ members?: Array<{ framework: string }> }>;
}

export function buildCoverage(results: ReadonlyArray<{ id: number; d: RichForCoverage } | null>): Coverage {
  const byDomain: Record<number, GroupCoverage> = {};
  const fwTotals: Record<string, number> = {};
  for (const res of results) {
    if (!res) continue;
    const sets = (res.d.sets || []).map((s) => Array.from(new Set((s.members || []).map((m) => shortFramework(m.framework)))));
    const standalone = (res.d.standalone_controls || []).map((s) => shortFramework(s.members?.[0]?.framework || ''));
    byDomain[res.id] = { sets, standalone };
    // a set counts once for each framework in it; a standalone control once for its framework
    sets.forEach((fws) => fws.forEach((f) => { fwTotals[f] = (fwTotals[f] || 0) + 1; }));
    standalone.forEach((f) => { fwTotals[f] = (fwTotals[f] || 0) + 1; });
  }
  return { byDomain, frameworks: Object.keys(fwTotals).sort(), fwTotals };
}

/** One group's counts for the picked frameworks: the sets that include at least one, and the standalone controls of a picked framework. */
export function scopedCounts(cov: Coverage, groupId: number, picked: readonly string[]): { sets: number; standalone: number; total: number } | null {
  const c = cov.byDomain[groupId];
  if (!c) return null;
  const sets = c.sets.filter((fws) => fws.some((f) => picked.includes(f))).length;
  const standalone = c.standalone.filter((f) => picked.includes(f)).length;
  return { sets, standalone, total: sets + standalone };
}

export interface Headline {
  scoped: boolean;
  /** the groups to draw (empty ones left out when asked, and under a view only the groups that still have controls) */
  groups: ControlGroup[];
  domains: number;
  controls: number;
  frameworks: number;
  sets: number;
  standalone: number;
  /** the framework controls the unified ones come from */
  rawTotal: number;
  /** raw minus unified: the duplicate copies counting each requirement once removes */
  duplicates: number;
  /** requirements repeated across two or more of the picked frameworks (only under a view) */
  repeated: number;
}

export interface HeadlineInput {
  data: GroupsResponse | undefined;
  showEmpty: boolean;
  picked: readonly string[];
  coverage: Coverage | undefined;
  /** the frameworks the tenant can pick from, when the server did not say how many the library covers */
  availableCount: number;
}

export function headline({ data, showEmpty, picked, coverage, availableCount }: HeadlineInput): Headline {
  const items = data?.items ?? [];
  const totalGroups = data?.total ?? 0;
  const totalControls = data?.total_mapped_controls ?? items.reduce((sum, g) => sum + g.total_control_count, 0);
  const libFrameworks = data?.library_framework_count ?? availableCount;
  const rawAll = data?.total_raw_controls ?? 0;
  const base = showEmpty ? items : items.filter((g) => g.total_control_count > 0);
  const scoped = picked.length > 0 && !!coverage;
  if (!scoped || !coverage) {
    const s = splitOf(items);
    return { scoped: false, groups: base, domains: totalGroups, controls: totalControls, frameworks: libFrameworks, sets: s.sets, standalone: s.standalone, rawTotal: rawAll, duplicates: Math.max(0, rawAll - totalControls), repeated: 0 };
  }
  const groups = base
    .map((g) => {
      const f = scopedCounts(coverage, g.id, picked);
      return f ? { ...g, normalized_control_count: f.total, standalone_control_count: f.standalone, total_control_count: f.total } : null;
    })
    .filter((g): g is ControlGroup => !!g && g.total_control_count > 0);
  const controls = groups.reduce((a, g) => a + g.total_control_count, 0);
  const s = splitOf(groups);
  const rawTotal = picked.reduce((a, f) => a + (coverage.fwTotals[f] ?? 0), 0);
  const repeated = Object.values(coverage.byDomain).reduce((n, d) => n + d.sets.filter((fws) => fws.filter((f) => picked.includes(f)).length >= 2).length, 0);
  return { scoped: true, groups, domains: groups.length, controls, frameworks: picked.length, sets: s.sets, standalone: s.standalone, rawTotal, duplicates: Math.max(0, rawTotal - controls), repeated };
}

/** The sentence that says why the unified count is below the framework count, in numbers (shown whenever duplicates were merged). */
export function reconciliation(h: Headline, frameworksInView: number, availableCount: number): { show: boolean; who: string; repeated: number } {
  return {
    show: h.duplicates > 0 && h.rawTotal > 0,
    who: h.scoped ? `Your ${frameworksInView} frameworks` : `Your ${availableCount} frameworks`,
    repeated: h.scoped ? h.repeated : h.sets,
  };
}

/** The link to a domain keeps the view the person built (?fw=A,B). */
export const domainHref = (id: number, picked: readonly string[]): string =>
  picked.length ? `/control-library/${id}?fw=${encodeURIComponent(picked.join(','))}` : `/control-library/${id}`;

/** The picked frameworks from the address (?fw=A,B): trimmed, without blanks. */
export const parsePicked = (fw: string | null | undefined): string[] => (fw ? fw.split(',').map((s) => s.trim()).filter(Boolean) : []);

/** Distinct, sorted, non-empty values (the category and domain choices come from the real groups: the server's own lists still hold old runs' values). */
export const distinctSorted = (values: ReadonlyArray<string | null | undefined>): string[] => Array.from(new Set(values.filter((v): v is string => !!v))).sort();
