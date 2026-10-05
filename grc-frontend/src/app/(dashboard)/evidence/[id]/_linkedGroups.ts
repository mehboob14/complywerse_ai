/**
 * What is linked to an evidence record, in the shape the "Links & coverage" pills open onto.
 *
 * Every count on a pill is the length of the list built here, so a number never has nothing behind it:
 * controls the platform cannot resolve any more (`unresolved`) are listed too, and assessments are listed
 * (read-only, with a way to open them) rather than counted and hidden.
 */
import type { LcLinkedGroup, LcLinkedItem } from './_LinksCoverage';

export interface MappedControl {
  id: number;
  clause_reference?: string | null;
  coverage_type?: string | null;
  is_locked?: boolean;
  // `scf_id` is the id people know ("IAC-01"); `code` is the table's own ("SCF-IAC-01")
  normalized_control?: { id: number; code: string; name: string; scf_id?: string | null } | null;
  framework_control?: { id: number; code: string; name: string } | null;
  parsed_control?: { id: number; control_id: string; title: string } | null;
  // set on `unresolved` rows only
  control_code?: string | null;
  framework_name?: string | null;
}

export interface ControlsSource {
  normalized_controls: MappedControl[];
  by_framework: Array<{ framework_name: string; controls: MappedControl[] }>;
  unresolved?: MappedControl[];
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

/** Counts for the two control pills. A mapping that is both a common and a framework control counts in both. */
export function controlCounts(c?: ControlsSource) {
  return {
    common: c?.normalized_controls.length ?? 0,
    framework: (c?.by_framework || []).reduce((n, f) => n + f.controls.length, 0) + (c?.unresolved?.length ?? 0),
  };
}

function mappingActions(m: MappedControl, unlink: Unlinkers): Pick<LcLinkedItem, 'onUnlink' | 'locked'> {
  return m.is_locked ? { locked: LOCKED } : { onUnlink: () => unlink.control(m.id) };
}

export function linkedGroups(controls: ControlsSource | undefined, links: LinksSource | undefined, unlink: Unlinkers) {
  const frameworkGroups: LcLinkedGroup[] = (controls?.by_framework || []).map((f) => ({
    heading: f.framework_name,
    items: f.controls.map((m) => ({
      key: `f${m.id}`,
      code: m.framework_control?.code ?? m.parsed_control?.control_id ?? null,
      title: m.framework_control?.name ?? m.parsed_control?.title ?? 'Control',
      tag: m.coverage_type,
      ...mappingActions(m, unlink),
    })),
  }));
  const unresolved = (controls?.unresolved || []).map((m): LcLinkedItem => ({
    key: `u${m.id}`,
    code: m.control_code ?? null,
    title: m.clause_reference || m.framework_name || 'Control mapping',
    subtitle: dot(m.framework_name && m.clause_reference ? m.framework_name : null, 'No longer matches a control in the library'),
    tag: 'unmatched',
    ...mappingActions(m, unlink),
  }));

  return {
    controls: [...frameworkGroups, { heading: unresolved.length ? 'Not matched to a control' : undefined, items: unresolved }],
    common_controls: [{
      items: (controls?.normalized_controls || []).map((m): LcLinkedItem => ({
        key: `c${m.id}`,
        code: m.normalized_control?.scf_id ?? m.normalized_control?.code ?? null,
        title: m.normalized_control?.name ?? 'Common control',
        subtitle: m.clause_reference ? `Linked as “${m.clause_reference}”` : null,
        tag: m.coverage_type,
        href: m.normalized_control?.scf_id ? `/automation/soc2-controls/${encodeURIComponent(m.normalized_control.scf_id)}` : undefined,
        ...mappingActions(m, unlink),
      })),
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
