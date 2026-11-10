// Insights > Risks (it was Risk 360°), apart from React (`riskModel.test.ts`): the third-party risks of the enterprise Risk Register, with the ten-domain residual breakdown of the supplier's active
// assessment. The rows are `GET /vendor-risk/tpra/risk-register` (the real `Risk` rows the lifecycle rolls up: category third_party, linked back to their supplier); the counts the head says (total,
// open, average residual) are the SERVER's, this file only filters and orders what came. A residual score is worded on the tenant's bands (vendorRules.residualBand: 75 / 50 / 25 unless its
// Policy says otherwise), the one band set of the module: the pages used 70 / 48 / 26 for colour before.
import { buildSchema, type RegisterDef } from '../../../../../components/records/registerModel.ts';
import { riskStatus } from '../../../../../lib/statuses/risk.ts';
import { vendorBand, vendorTier } from '../../../../../lib/statuses/vendor.ts';
import { DOMAIN_KEYS, DOMAIN_LABELS } from '../../_lib/tprmShared.ts';
import { residualBand, SHIPPED_BANDS, type Band, type Bands } from '../../_lib/vendorRules.ts';

export interface DomainScore { residual?: number | null; inherent?: number | null; rating?: string | null; posture?: number | null; answered?: number | null; total?: number | null }

export interface RiskRow {
  id: number;
  title: string | null;
  vendor_id: number | null;
  vendor_name: string | null;
  tier: string | null;
  inherent_score: number | null;
  residual_score: number | null;
  status: string | null;
  register_type: string | null;
  updated_at: string | null;
  domain_scores?: Record<string, DomainScore> | null;
}
export interface RiskAnswer { items: RiskRow[]; total: number; open: number; avg_residual: number | null }

export interface CoverageItem { framework: string; questions: number; controls: number; domains: string[]; templates: string[]; evidence_required: number }
export interface CoverageAnswer { items: CoverageItem[]; frameworks: number; templates: number; total_questions: number; mapped_questions: number; mapping_coverage: number }

const NONE = 'none';

export const statusOf = (r: Pick<RiskRow, 'status'>): string => (r.status || 'open').toLowerCase();
/** The server's own definition of an open risk (`open` of the answer): anything not closed. */
export const isOpen = (r: Pick<RiskRow, 'status'>): boolean => statusOf(r) !== 'closed';
export const bandOf = (r: Pick<RiskRow, 'residual_score'>, bands: Bands = SHIPPED_BANDS): Band => residualBand(r.residual_score, bands);
export const tierOf = (r: Pick<RiskRow, 'tier'>): string => (r.tier ? r.tier.toLowerCase() : NONE);
export const hasDomains = (r: Pick<RiskRow, 'domain_scores'>): boolean => !!r.domain_scores && Object.keys(r.domain_scores).length > 0;

/** The title a risk is shown under: its own, else words (never "Risk #12": an id is not a name). */
export const titleOf = (r: Pick<RiskRow, 'title' | 'vendor_name'>): string => (r.title && r.title.trim()) || (r.vendor_name ? `Third-party risk: ${r.vendor_name}` : 'Third-party risk');

export interface DomainRow {
  key: string;
  label: string;
  /** null: the domain was not assessed */
  residual: number | null;
  /** share of the domain's questions answered, 0 to 100; null when unknown */
  covered: number | null;
  band: Band;
}

/** The ten domains of an assessment, in the module's order, with the residual of each (null when not assessed) and how much of it was answered. */
export function domainRows(r: Pick<RiskRow, 'domain_scores'>, bands: Bands = SHIPPED_BANDS): DomainRow[] {
  return DOMAIN_KEYS.map((key) => {
    const d = r.domain_scores?.[key];
    const residual = typeof d?.residual === 'number' ? d.residual : null;
    const total = d?.total ?? 0;
    return {
      key, label: DOMAIN_LABELS[key], residual,
      covered: total > 0 ? Math.round(((d?.answered ?? 0) / total) * 100) : null,
      band: residualBand(residual, bands),
    };
  });
}

/** What each domain is for and the evidence expected of a supplier in it: the old page's ten static cards, now the Domains drawer. */
export const DOMAIN_INFO: Readonly<Record<string, { purpose: string; evidence: readonly string[] }>> = {
  cybersecurity: { purpose: 'Technical safeguards protecting confidentiality, integrity and availability of systems and data.', evidence: ['SOC 2 Type II', 'ISO 27001 certificate', 'Penetration test report', 'Vulnerability scans'] },
  data_privacy: { purpose: 'Lawful, transparent handling of personal data and processor obligations.', evidence: ['DPA and SCCs', 'Privacy policy', 'Data subject request procedure', 'Subprocessor list'] },
  operational: { purpose: 'Ability to keep delivering the service through disruption.', evidence: ['BC/DR plan and test', 'RTO and RPO targets', 'Uptime SLAs', 'Incident runbooks'] },
  financial: { purpose: 'Solvency and going-concern strength of a vendor you depend on.', evidence: ['Audited financials', 'Credit rating', 'Insurance certificates', 'D&B report'] },
  compliance: { purpose: 'Adherence to laws, regulations and industry standards in scope.', evidence: ['Certifications', 'Regulatory attestations', 'Audit reports', 'Sanctions screening'] },
  reputational: { purpose: 'Exposure to adverse media, brand and ethical-conduct risk.', evidence: ['Adverse-media scan', 'Litigation history', 'Code of conduct'] },
  geographic: { purpose: 'Country, data-residency and geopolitical exposure of the relationship.', evidence: ['Hosting locations', 'Transfer mechanisms', 'Sanctions checks'] },
  fourth_party: { purpose: 'Risk inherited from your vendor’s vendors and over-concentration.', evidence: ['Subprocessor inventory', 'Flow-down clauses', 'Concentration analysis'] },
  esg: { purpose: 'Environmental, social and governance posture and disclosures.', evidence: ['ESG report', 'Modern-slavery statement', 'Diversity disclosures'] },
  legal: { purpose: 'Contractual protections: audit rights, liability, exit and data return.', evidence: ['MSA / contract', 'Right-to-audit clause', 'Data-return and destruction terms'] },
};

/** Open findings per domain from the portfolio dashboard, for the Domains drawer, most first; a domain with none reads 0 (the dashboard counted none). */
export function findingsByDomain(counts: Record<string, number> | null | undefined): Array<{ key: string; label: string; count: number }> {
  return DOMAIN_KEYS.map((key) => ({ key, label: DOMAIN_LABELS[key], count: counts?.[key] ?? 0 }));
}

const TIERS = ['critical', 'high', 'medium', 'low'];
const BANDS: Band[] = ['critical', 'high', 'medium', 'low', 'none'];

/** The register's definition (facets, quick chips, sorts), for the tenant's bands. Built once per set of bands, outside the render. */
export function riskDef(bands: Bands = SHIPPED_BANDS): RegisterDef<RiskRow> {
  return {
    key: 'tprisk',
    noun: { one: 'risk', other: 'risks' },
    idOf: (r) => r.id,
    text: (r) => [titleOf(r), r.vendor_name ?? '', r.status ?? '', r.tier ?? ''].join(' '),
    facets: [
      {
        key: 'status', label: 'Status', defaultOpen: true, values: (r) => [statusOf(r)],
        options: (rows) => Array.from(new Set(rows.map(statusOf).concat('open'))).sort().map((value) => ({ value, label: riskStatus.label(value) })),
      },
      { key: 'band', label: 'Residual score', defaultOpen: true, values: (r) => [bandOf(r, bands)], options: () => BANDS.map((value) => ({ value, label: vendorBand.label(value) })) },
      {
        key: 'tier', label: 'Supplier tier', values: (r) => [tierOf(r)],
        options: () => [...TIERS.map((value) => ({ value, label: vendorTier.label(value) })), { value: NONE, label: 'Not tiered' }],
      },
      { key: 'supplier', label: 'Supplier', values: (r) => [r.vendor_id ? 'linked' : 'none'], options: () => [{ value: 'linked', label: 'A supplier of ours' }, { value: 'none', label: 'Not linked to a supplier' }] },
      { key: 'domains', label: 'Domain breakdown', values: (r) => [hasDomains(r) ? 'has' : 'none'], options: () => [{ value: 'has', label: 'Scored by domain' }, { value: 'none', label: 'Not scored by domain yet' }] },
    ],
    quick: [
      { key: 'open', label: 'Open', test: (r) => isOpen(r), title: 'Every risk that is not closed' },
      { key: 'serious', label: 'Critical or high', test: (r) => bandOf(r, bands) === 'critical' || bandOf(r, bands) === 'high', title: 'A residual score in the critical or high band of the policy' },
      { key: 'unscored', label: 'Not scored', test: (r) => r.residual_score === null, title: 'No residual score yet' },
    ],
    sorts: [
      { key: 'residual', label: 'Residual score (highest first)', firstDir: 'desc', value: (r) => r.residual_score },
      { key: 'inherent', label: 'Inherent score', firstDir: 'desc', value: (r) => r.inherent_score },
      { key: 'title', label: 'Risk', firstDir: 'asc', value: (r) => titleOf(r) },
      { key: 'vendor', label: 'Supplier', firstDir: 'asc', value: (r) => r.vendor_name },
      { key: 'status', label: 'Status', firstDir: 'asc', value: (r) => statusOf(r) },
      { key: 'updated', label: 'Last updated', firstDir: 'desc', value: (r) => r.updated_at },
    ],
    defaultSort: { key: 'residual', dir: 'desc' },
    pageSize: 25,
  };
}

/** The address schema: the same for every set of bands (the facets and chips are the same keys). */
export const RISK_SCHEMA = buildSchema(riskDef());

/** The facts the head says: the server's numbers in words ("87 risks · 61 open · average residual 42"). */
export function headLine(a: Pick<RiskAnswer, 'total' | 'open' | 'avg_residual'>): string {
  const bits = [`${a.total.toLocaleString('en-GB')} ${a.total === 1 ? 'risk' : 'risks'}`, `${a.open.toLocaleString('en-GB')} open`];
  if (a.avg_residual !== null && a.avg_residual !== undefined) bits.push(`average residual ${a.avg_residual}`);
  return bits.join(' · ');
}

/** "Residual 62 of 100, high" for a screen reader or a drawer subtitle. */
export function scoreWords(r: Pick<RiskRow, 'residual_score'>, bands: Bands = SHIPPED_BANDS): string {
  return r.residual_score === null ? 'Not scored yet' : `Residual ${r.residual_score} of 100, ${vendorBand.label(bandOf(r, bands)).toLowerCase()}`;
}
