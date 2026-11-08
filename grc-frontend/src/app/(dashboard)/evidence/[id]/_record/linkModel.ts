// What is linked to a file, in the shape the Linked tab draws, and the suggestions that offer more (linkModel.test.ts). Pure (no React).
//
// Every count on the tab is the length of a list built here, so a number never has nothing behind it. Eight kinds: the common controls (the SCF library and the organisation's own,
// each with the framework requirements it fulfils), the framework requirements the file was linked to one by one (what "Link" on an AI clause suggestion makes; a common control that
// already covers a requirement is not listed twice), the policy statements, the assessment items (read-only: they are linked from the item), the audit observations, the risks, the
// assets and the incidents. No id is ever a title: a record with no name reads "A risk".
import type { AllLinks, ControlsResponse, FulfilledRequirements } from './recordTypes.ts';

export const LINK_TYPES = ['common_controls', 'framework_controls', 'policy_statements', 'assessments', 'audit_observations', 'risks', 'assets', 'incidents'] as const;
export type LinkType = (typeof LINK_TYPES)[number];

export const LINK_LABEL: Record<LinkType, string> = {
  common_controls: 'Common controls', framework_controls: 'Framework requirements', policy_statements: 'Policies', assessments: 'Assessments',
  audit_observations: 'Audit observations', risks: 'Risks', assets: 'Assets', incidents: 'Incidents',
};
/** The singular, for a button ("Link a risk") and an unnamed record ("A risk"). */
export const LINK_ONE: Record<LinkType, string> = {
  common_controls: 'common control', framework_controls: 'framework requirement', policy_statements: 'policy statement', assessments: 'assessment',
  audit_observations: 'audit observation', risks: 'risk', assets: 'asset', incidents: 'incident',
};
/** The kinds a person can link from this page (assessments are linked from the assessment item, and framework requirements from an AI suggestion or a control). */
export const LINKABLE: readonly LinkType[] = ['common_controls', 'policy_statements', 'audit_observations', 'risks', 'assets', 'incidents'];

export const isLinkType = (v: string | null | undefined): v is LinkType => !!v && (LINK_TYPES as readonly string[]).includes(v);

/** The framework requirements a common control fulfils, in the frameworks the organisation is assessed against. */
export type { FulfilledRequirements };

/** One linked record. */
export interface LinkedItem {
  key: string;
  code?: string | null;
  title: string;
  subtitle?: string | null;
  tag?: string | null;
  href?: string;
  /** which mapping / link to remove, by kind: the page holds the request */
  unlink?: { kind: 'control' | 'risk' | 'asset' | 'incident' | 'policy' | 'audit'; id: number; auditKind?: string };
  /** why it cannot be unlinked from here (a test sample) */
  locked?: string;
  /** small counted labels under the title: the frameworks a control fulfils requirements of */
  chips?: Array<{ label: string; count: number }>;
  /** a common control: the row opens its details */
  control?: { scfId: string; title: string; linkedAs?: string | null; coverage?: string | null; requirements: FulfilledRequirements[] };
}

const LOCKED = 'This file is a test sample for the control; remove it from the control’s test procedure instead.';
const clip = (s?: string | null, n = 120) => (s && s.length > n ? `${s.slice(0, n).trimEnd()}…` : s || null);
const dot = (...parts: Array<string | number | null | undefined>) => parts.filter((p) => p !== null && p !== undefined && p !== '').join(' · ') || null;

/** An audit observation's id as the recommender numbers it: statutory = its id, issue-register = minus the issue id. */
export const auditObservationId = (kind: string, recordId: number) => (kind === 'issue' ? -recordId : recordId);

export function linkedItems(controls: ControlsResponse | undefined, links: AllLinks | undefined): Record<LinkType, LinkedItem[]> {
  const frameworkRows: LinkedItem[] = [];
  (controls?.by_framework ?? []).forEach((f) => f.controls.forEach((m) => {
    if (m.normalized_control) return;                                              // already listed under the common controls
    const fc = m.framework_control;
    const pc = m.parsed_control;
    frameworkRows.push({
      key: `f${m.id}`,
      code: fc?.code ?? pc?.control_id ?? null,
      title: fc?.name ?? pc?.title ?? 'A framework requirement',
      subtitle: f.framework_name || null,
      tag: m.coverage_type ?? null,
      unlink: m.is_locked ? undefined : { kind: 'control', id: m.id },
      locked: m.is_locked ? LOCKED : undefined,
    });
  }));
  (controls?.unresolved ?? []).forEach((u) => frameworkRows.push({
    key: `u${u.id}`, code: u.control_code ?? null, title: u.clause_reference || 'A framework requirement', subtitle: u.framework_name ?? null, tag: u.coverage_type ?? null,
    unlink: u.is_locked ? undefined : { kind: 'control', id: u.id }, locked: u.is_locked ? LOCKED : undefined,
  }));

  return {
    common_controls: (controls?.normalized_controls ?? []).map((m): LinkedItem => {
      const nc = m.normalized_control;
      const requirements = nc?.requirements ?? [];
      return {
        key: `c${m.id}`,
        code: nc?.scf_id ?? nc?.code ?? null,
        title: nc?.name ?? 'A common control',
        subtitle: m.clause_reference ? `Linked as “${m.clause_reference}”` : null,
        tag: m.coverage_type ?? null,
        chips: requirements.map((r) => ({ label: r.label, count: r.codes.length })),
        control: nc?.scf_id ? { scfId: nc.scf_id, title: nc.name, linkedAs: m.clause_reference, coverage: m.coverage_type, requirements } : undefined,
        href: nc?.scf_id ? `/automation/soc2-controls/${encodeURIComponent(nc.scf_id)}` : undefined,
        unlink: m.is_locked ? undefined : { kind: 'control', id: m.id },
        locked: m.is_locked ? LOCKED : undefined,
      };
    }),
    framework_controls: frameworkRows,
    policy_statements: (links?.policy_statements?.links ?? []).map((l): LinkedItem => {
      const s = l.policy_statement;
      return {
        key: `p${l.id}`, code: s?.statement_code ?? null, title: clip(s?.statement_summary) || s?.document_title || 'A policy statement',
        subtitle: dot(s?.document_title, s?.source_section), tag: l.link_type,
        href: s?.document_id ? `/governance/documents/${s.document_id}` : undefined, unlink: { kind: 'policy', id: l.id },
      };
    }),
    assessments: (links?.assessments?.links ?? []).map((l): LinkedItem => ({
      key: `a${l.id}`, code: l.item_number, title: l.assessment_name || 'An assessment', subtitle: dot(l.area_domain, clip(l.control_description, 110)), tag: l.link_status,
      href: l.assessment_id ? `/compliance/assessments/${l.assessment_id}` : undefined,
    })),
    audit_observations: (links?.audit_observations?.links ?? []).map((l): LinkedItem => ({
      key: `o${l.kind}${l.id}`, code: l.code, title: l.title || 'An audit observation', subtitle: dot(l.source, l.status, l.priority), tag: l.link_type,
      href: l.kind === 'issue' ? `/issues/${l.record_id}` : `/auditor-portal/statutory-audit/${l.record_id}`, unlink: { kind: 'audit', id: l.id, auditKind: l.kind },
    })),
    risks: (links?.risks?.links ?? []).map((l): LinkedItem => ({
      key: `r${l.id}`, title: l.risk?.title || 'A risk',
      subtitle: dot(l.risk?.status, l.risk?.inherent_score != null ? `inherent ${l.risk.inherent_score}` : null, l.risk?.residual_score != null ? `residual ${l.risk.residual_score}` : null),
      href: `/erm/risks/${l.risk_id}`, unlink: { kind: 'risk', id: l.id },
    })),
    assets: (links?.assets?.links ?? []).map((l): LinkedItem => ({
      key: `s${l.id}`, title: l.asset?.name || 'An asset', subtitle: dot(l.asset?.asset_type, l.asset?.criticality), tag: l.link_type,
      href: `/cyber-assurance/assets/${l.asset_id}`, unlink: { kind: 'asset', id: l.id },
    })),
    incidents: (links?.incidents?.links ?? []).map((l): LinkedItem => ({
      key: `i${l.id}`, title: l.incident?.title || 'An incident', subtitle: dot(l.incident?.severity, l.incident?.status), tag: l.link_type,
      href: '/erm/incidents', unlink: { kind: 'incident', id: l.id },
    })),
  };
}

/** How many records of each kind are linked: the length of the list the tab draws. */
export function linkCounts(controls: ControlsResponse | undefined, links: AllLinks | undefined): Record<LinkType, number> {
  const items = linkedItems(controls, links);
  return Object.fromEntries(LINK_TYPES.map((t) => [t, items[t].length])) as Record<LinkType, number>;
}

/** The number on the Linked tab: all of them. */
export const linkedTotal = (counts: Record<LinkType, number>): number => LINK_TYPES.reduce((n, t) => n + counts[t], 0);

/**
 * What the common controls linked to this file add up to: each framework requirement counted once, however many of the linked controls fulfil it. Null when no framework is in
 * scope, so there is nothing to add up.
 */
export function coverageSummary(controls?: ControlsResponse): string | null {
  const byFramework = new Map<string, { label: string; codes: Set<string> }>();
  (controls?.normalized_controls ?? []).forEach((m) => (m.normalized_control?.requirements ?? []).forEach((r) => {
    const entry = byFramework.get(r.key) ?? { label: r.label, codes: new Set<string>() };
    r.codes.forEach((code) => entry.codes.add(code));
    byFramework.set(r.key, entry);
  }));
  const parts = Array.from(byFramework.values());
  const total = parts.reduce((n, f) => n + f.codes.size, 0);
  if (!total) return null;
  return `Together these fulfil ${total} framework requirement${total === 1 ? '' : 's'}: ${parts.map((f) => `${f.label} ${f.codes.size}`).join(' · ')}.`;
}

/** The frameworks the file answers, by name: those of the controls linked to it (a common control names none). */
export function frameworkNames(controls?: ControlsResponse): string[] {
  const names = new Set<string>();
  (controls?.by_framework ?? []).forEach((f) => { if (f.framework_name) names.add(f.framework_name); });
  (controls?.normalized_controls ?? []).forEach((m) => (m.normalized_control?.requirements ?? []).forEach((r) => { if (r.label) names.add(r.label); }));
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

// ── the suggestions ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const SUGGEST_TARGETS = ['common_controls', 'audit_observations', 'risks', 'assets', 'incidents', 'policy_statements'] as const;
export type SuggestTarget = (typeof SUGGEST_TARGETS)[number];
/** A rule, not a model: asks the control library which controls want a document like this one. It needs no rating, so it runs as soon as the tab opens. */
export const IMMEDIATE: readonly SuggestTarget[] = ['common_controls'];

/** A match from 0-1 or 0-100, as a whole 0-100 number (none is 0). */
export const matchPct = (c?: number | null): number => (c == null ? 0 : c <= 1 ? Math.round(c * 100) : Math.round(c));
/** From this match up a suggestion is "strong": the one-press "Link N strong matches" takes these. */
export const STRONG = 80;
export type MatchBand = 'strong' | 'fair' | 'weak';
export const bandOf = (pct: number): MatchBand => (pct >= STRONG ? 'strong' : pct >= 70 ? 'fair' : 'weak');

export interface Suggestion {
  id: number;
  code?: string | null;
  title?: string | null;
  subtitle?: string | null;
  confidence?: number | null;
  rationale?: string | null;
  meta?: { framework_id?: number; scf_id?: string; artifact_name?: string; kind?: string; record_id?: number } | null;
}

export interface Offered { target: SuggestTarget; rec: Suggestion }

/** Every target's suggestions in one list: without the ones already linked or dismissed, the best match first (ties keep the targets' order). */
export function offered(
  results: ReadonlyArray<{ target: SuggestTarget; recs: readonly Suggestion[] | undefined; linked: ReadonlySet<number> }>,
  dismissed: ReadonlySet<string>,
): Offered[] {
  const all: Offered[] = [];
  results.forEach((r) => (r.recs ?? []).forEach((rec) => {
    if (!r.linked.has(rec.id) && !dismissed.has(`${r.target}:${rec.id}`)) all.push({ target: r.target, rec });
  }));
  return all.map((o, i) => ({ o, i })).sort((a, b) => matchPct(b.o.rec.confidence) - matchPct(a.o.rec.confidence) || a.i - b.i).map((x) => x.o);
}

/** How many suggestions each target has, for the count beside its name. */
export function suggestionCounts(list: readonly Offered[]): Partial<Record<SuggestTarget, number>> {
  const out: Partial<Record<SuggestTarget, number>> = {};
  list.forEach((o) => { out[o.target] = (out[o.target] ?? 0) + 1; });
  return out;
}

/** The strong ones of a list, grouped by target (what "Link N strong matches" sends, one request per kind). */
export function strongByTarget(list: readonly Offered[]): Map<SuggestTarget, Suggestion[]> {
  const out = new Map<SuggestTarget, Suggestion[]>();
  list.filter((o) => matchPct(o.rec.confidence) >= STRONG).forEach((o) => out.set(o.target, [...(out.get(o.target) ?? []), o.rec]));
  return out;
}

/** The linked ids a target subtracts from its suggestions (what it is already linked to). */
export function linkedIdsOf(target: SuggestTarget, controls: ControlsResponse | undefined, links: AllLinks | undefined): Set<number> {
  switch (target) {
    case 'common_controls': return new Set((controls?.normalized_controls ?? []).map((m) => m.normalized_control?.id).filter((x): x is number => typeof x === 'number'));
    case 'audit_observations': return new Set((links?.audit_observations?.links ?? []).map((l) => auditObservationId(l.kind, l.record_id)));
    case 'risks': return new Set((links?.risks?.links ?? []).map((l) => l.risk_id));
    case 'assets': return new Set((links?.assets?.links ?? []).map((l) => l.asset_id));
    case 'incidents': return new Set((links?.incidents?.links ?? []).map((l) => l.incident_id));
    default: return new Set((links?.policy_statements?.links ?? []).map((l) => l.policy_statement_id));
  }
}

export const TARGET_LABEL: Record<SuggestTarget, string> = {
  common_controls: 'Common control', audit_observations: 'Audit observation', risks: 'Risk', assets: 'Asset', incidents: 'Incident', policy_statements: 'Policy',
};

// ── the link sheet's lists ───────────────────────────────────────────────────────────────────────────────────────────────

/** One row the sheet offers to link. */
export interface PickItem { value: string; label: string; sub?: string }
/** How many matches the sheet draws; the rest are one search away ("Showing 100 of 412"). */
export const PICK_SHOWN = 100;
const fold = (s: string): string => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** The rows that match a search (every word has to be in the label or the line under it, accents and case ignored), the first `limit` of them, and how many match in all. */
export function matchItems(items: readonly PickItem[], query: string, limit: number = PICK_SHOWN): { shown: PickItem[]; total: number } {
  const terms = fold(query.trim()).split(/\s+/).filter(Boolean);
  const hit = terms.length === 0 ? items : items.filter((i) => { const text = fold(`${i.label} ${i.sub ?? ''}`); return terms.every((w) => text.includes(w)); });
  return { shown: hit.slice(0, limit), total: hit.length };
}
