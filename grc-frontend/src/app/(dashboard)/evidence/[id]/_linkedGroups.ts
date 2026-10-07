/**
 * What is linked to an evidence record, in the shape the "Links & coverage" pills open onto.
 *
 * Every count on a pill is the length of the list built here, so a number never has nothing behind it:
 * assessments are listed (read-only, with a way to open them) rather than counted and hidden. Controls
 * are the common controls (the SCF library and the organisation's own), each with the framework
 * requirements it fulfils; the framework's own controls are not listed, because a common control covers them.
 */
import type { LcLinkedGroup, LcLinkedItem } from './_LinksCoverage';

/** The framework requirements a common control fulfils, in the frameworks the organisation is assessed against. */
export interface FulfilledRequirements { key: string; label: string; codes: string[] }

export interface MappedControl {
  id: number;
  clause_reference?: string | null;
  coverage_type?: string | null;
  is_locked?: boolean;
  // `scf_id` is the id people know ("IAC-01"); `code` is the table's own ("SCF-IAC-01")
  normalized_control?: { id: number; code: string; name: string; scf_id?: string | null; requirements?: FulfilledRequirements[] } | null;
}

export interface ControlsSource {
  normalized_controls: MappedControl[];
}

export interface LinksSource {
  risks?: { links: Array<{ id: number; risk_id: number; risk: { title: string; status: string; inherent_score: number | null; residual_score: number | null } | null }> };
  assets?: { links: Array<{ id: number; asset_id: number; link_type: string; asset: { name: string; asset_type: string; criticality: string } | null }> };
  incidents?: { links: Array<{ id: number; incident_id: number; link_type: string | null; incident: { title: string; severity: string; status: string } | null }> };
  policy_statements?: { links: Array<{ id: number; policy_statement_id: number; link_type: string | null; policy_statement: { statement_code: string; statement_summary: string | null; document_id?: number | null; document_title?: string | null; source_section?: string | null } | null }> };
  assessments?: { links: Array<{ id: number; assessment_id: number | null; assessment_name: string | null; item_number: string | null; area_domain: string | null; control_description: string | null; link_status: string }> };
  audit_observations?: { links: Array<{ id: number; kind: string; record_id: number; link_type: string | null; code: string | null; title: string | null; status: string | null; priority: string | null; source: string | null }> };
}

export interface Unlinkers {
  control: (mappingId: number) => void;
  risk: (linkId: number) => void;
  asset: (linkId: number) => void;
  incident: (linkId: number) => void;
  policy: (linkId: number) => void;
  audit: (kind: string, linkId: number) => void;
}

const LOCKED = 'This file is a test sample for the control; remove it from the control’s test procedure instead.';

const clip = (s?: string | null, n = 120) => (s && s.length > n ? `${s.slice(0, n).trimEnd()}…` : s || null);
const dot = (...parts: Array<string | number | null | undefined>) => parts.filter((p) => p !== null && p !== undefined && p !== '').join(' · ') || null;

/** An audit observation's id as the recommender numbers it: statutory = its id, issue-register = minus the issue id. */
export const auditObservationId = (kind: string, recordId: number) => (kind === 'issue' ? -recordId : recordId);

export const controlCount = (c?: ControlsSource) => c?.normalized_controls.length ?? 0;

/**
 * What the common controls linked to this evidence add up to: each framework requirement counted once, however many
 * of the linked controls fulfil it. Null when no framework is in scope, so there is nothing to add up.
 */
export function coverageSummary(c?: ControlsSource): string | null {
  const byFramework = new Map<string, { label: string; codes: Set<string> }>();
  (c?.normalized_controls || []).forEach((m) => (m.normalized_control?.requirements || []).forEach((r) => {
    const entry = byFramework.get(r.key) ?? { label: r.label, codes: new Set<string>() };
    r.codes.forEach((code) => entry.codes.add(code));
    byFramework.set(r.key, entry);
  }));
  const total = Array.from(byFramework.values()).reduce((n, f) => n + f.codes.size, 0);
  if (!total) return null;
  return `Together these fulfil ${total} framework requirement${total === 1 ? '' : 's'}: ${Array.from(byFramework.values()).map((f) => `${f.label} ${f.codes.size}`).join(' · ')}.`;
}

function mappingActions(m: MappedControl, unlink: Unlinkers): Pick<LcLinkedItem, 'onUnlink' | 'locked'> {
  return m.is_locked ? { locked: LOCKED } : { onUnlink: () => unlink.control(m.id) };
}

export function linkedGroups(controls: ControlsSource | undefined, links: LinksSource | undefined, unlink: Unlinkers) {
  return {
    common_controls: [{
      items: (controls?.normalized_controls || []).map((m): LcLinkedItem => {
        const nc = m.normalized_control;
        const requirements = nc?.requirements || [];
        return {
          key: `c${m.id}`,
          code: nc?.scf_id ?? nc?.code ?? null,
          title: nc?.name ?? 'Common control',
          subtitle: m.clause_reference ? `Linked as “${m.clause_reference}”` : null,
          tag: m.coverage_type,
          // The framework requirements it fulfils: one chip per framework, counted.
          chips: requirements.map((r) => ({ label: r.label, count: r.codes.length })),
          // Clicking the row opens its details; the page of the control is one more click away.
          control: nc?.scf_id ? { scfId: nc.scf_id, title: nc.name, linkedAs: m.clause_reference, coverage: m.coverage_type, requirements } : undefined,
          href: nc?.scf_id ? `/automation/soc2-controls/${encodeURIComponent(nc.scf_id)}` : undefined,
          ...mappingActions(m, unlink),
        };
      }),
    }],
    policy_statements: [{
      items: (links?.policy_statements?.links || []).map((l): LcLinkedItem => {
        const s = l.policy_statement;
        return {
          key: `p${l.id}`,
          code: s?.statement_code ?? null,
          title: clip(s?.statement_summary) || s?.document_title || `Policy statement #${l.policy_statement_id}`,
          subtitle: dot(s?.document_title, s?.source_section),
          tag: l.link_type,
          href: s?.document_id ? `/governance/documents/${s.document_id}` : undefined,
          onUnlink: () => unlink.policy(l.id),
        };
      }),
    }],
    assessments: [{
      items: (links?.assessments?.links || []).map((l): LcLinkedItem => ({
        key: `a${l.id}`,
        code: l.item_number,
        title: l.assessment_name || `Assessment #${l.assessment_id ?? l.id}`,
        subtitle: dot(l.area_domain, clip(l.control_description, 110)),
        tag: l.link_status,
        href: l.assessment_id ? `/compliance/assessments/${l.assessment_id}` : undefined,
      })),
    }],
    risks: [{
      items: (links?.risks?.links || []).map((l): LcLinkedItem => ({
        key: `r${l.id}`,
        title: l.risk?.title || `Risk #${l.risk_id}`,
        subtitle: dot(l.risk?.status, l.risk?.inherent_score != null ? `inherent ${l.risk.inherent_score}` : null,
          l.risk?.residual_score != null ? `residual ${l.risk.residual_score}` : null),
        href: `/erm/risks/${l.risk_id}`,
        onUnlink: () => unlink.risk(l.id),
      })),
    }],
    assets: [{
      items: (links?.assets?.links || []).map((l): LcLinkedItem => ({
        key: `s${l.id}`,
        title: l.asset?.name || `Asset #${l.asset_id}`,
        subtitle: dot(l.asset?.asset_type, l.asset?.criticality),
        tag: l.link_type,
        href: `/cyber-assurance/assets/${l.asset_id}`,
        onUnlink: () => unlink.asset(l.id),
      })),
    }],
    incidents: [{
      items: (links?.incidents?.links || []).map((l): LcLinkedItem => ({
        key: `i${l.id}`,
        title: l.incident?.title || `Incident #${l.incident_id}`,
        subtitle: dot(l.incident?.severity, l.incident?.status),
        tag: l.link_type,
        href: '/erm/incidents',
        onUnlink: () => unlink.incident(l.id),
      })),
    }],
    audit_observations: [{
      items: (links?.audit_observations?.links || []).map((l): LcLinkedItem => ({
        key: `o${l.kind}${l.id}`,
        code: l.code,
        title: l.title || 'Audit observation',
        subtitle: dot(l.source, l.status, l.priority),
        tag: l.link_type,
        href: l.kind === 'issue' ? `/issues/${l.record_id}` : `/auditor-portal/statutory-audit/${l.record_id}`,
        onUnlink: () => unlink.audit(l.kind, l.id),
      })),
    }],
  };
}
