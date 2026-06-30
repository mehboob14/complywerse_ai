'use client';

// Risk 360° — connects TPRM to the enterprise Risk Register. Shows the real
// third-party `Risk` rows the TPRA lifecycle rolls up (category='third_party'),
// linked back to their vendor and to the register, alongside the ten-domain
// taxonomy and live open-findings concentration. Per-vendor residual radar lives
// on each vendor's profile.

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Shield, AlertCircle, ExternalLink, Layers, ArrowUpRight } from 'lucide-react';
import { tpraApi } from '@/lib/api';
import { PageLoader } from '@/components/ui';
import { DOMAIN_HEX, sevBadgeCls, scoreColor, fmtDate, titleCase } from '../_lib/tprmShared';

interface RegisterRisk {
  id: number; title: string | null; vendor_id: number | null; vendor_name: string | null;
  tier: string | null; inherent_score: number | null; residual_score: number | null;
  status: string | null; register_type: string | null; updated_at: string | null;
}
interface RegisterResp { items: RegisterRisk[]; total: number; open: number; avg_residual: number | null }

interface DomainDef { key: string; label: string; purpose: string; evidence: string[]; }
const DOMAINS: DomainDef[] = [
  { key: 'cybersecurity', label: 'Cybersecurity', purpose: 'Technical safeguards protecting confidentiality, integrity and availability of systems and data.', evidence: ['SOC 2 Type II', 'ISO 27001 cert', 'Pen-test report', 'Vulnerability scans'] },
  { key: 'data_privacy', label: 'Data Privacy', purpose: 'Lawful, transparent handling of personal data and processor obligations.', evidence: ['DPA / SCCs', 'Privacy policy', 'DSAR procedure', 'Subprocessor list'] },
  { key: 'operational', label: 'Operational Resilience', purpose: 'Ability to keep delivering the service through disruption.', evidence: ['BC/DR plan + test', 'RTO/RPO targets', 'Uptime SLAs', 'Incident runbooks'] },
  { key: 'financial', label: 'Financial Viability', purpose: 'Solvency and going-concern strength of a vendor you depend on.', evidence: ['Audited financials', 'Credit rating', 'Insurance certs', 'D&B report'] },
  { key: 'compliance', label: 'Compliance & Regulatory', purpose: 'Adherence to laws, regulations and industry standards in scope.', evidence: ['Certifications', 'Regulatory attestations', 'Audit reports', 'Sanctions screening'] },
  { key: 'reputational', label: 'Reputational', purpose: 'Exposure to adverse media, brand and ethical-conduct risk.', evidence: ['Adverse-media scan', 'Litigation history', 'Code of conduct'] },
  { key: 'geographic', label: 'Geographic / Geopolitical', purpose: 'Country, data-residency and geopolitical exposure of the relationship.', evidence: ['Hosting locations', 'Transfer mechanisms', 'Sanctions / OFAC checks'] },
  { key: 'fourth_party', label: 'Fourth-Party / Concentration', purpose: 'Risk inherited from your vendor’s vendors and over-concentration.', evidence: ['Subprocessor inventory', 'Flow-down clauses', 'Concentration analysis'] },
  { key: 'esg', label: 'ESG & Sustainability', purpose: 'Environmental, social and governance posture and disclosures.', evidence: ['ESG report', 'Modern-slavery statement', 'Diversity disclosures'] },
  { key: 'legal', label: 'Legal & Contractual', purpose: 'Contractual protections — audit rights, liability, exit and data return.', evidence: ['MSA / contract', 'Right-to-audit clause', 'Data-return / destruction terms'] },
];

export default function Risk360Page() {
  const router = useRouter();
  const { data: reg, isLoading, error, refetch } = useQuery({
    queryKey: ['tprm-risk-register'],
    queryFn: async () => (await tpraApi.riskRegister()).data as RegisterResp,
  });
  const { data: dash } = useQuery({
    queryKey: ['tprm-dashboard', 'portfolio'],
    queryFn: async () => (await tpraApi.dashboard('portfolio')).data as { findings_by_domain: Record<string, number> },
  });

  const byDomain = dash?.findings_by_domain || {};
  const maxCount = Math.max(1, ...Object.values(byDomain));
  const risks = reg?.items || [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Risk 360°</h1>
        <p className="text-sm text-gray-500">Third-party risk connected to the enterprise Risk Register — every vendor’s residual risk rolls up here, scored across the ten domains.</p>
      </div>

      {/* ── Third-party risks in the enterprise Risk Register ── */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 p-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Third-party risks in the Risk Register</h3>
            <p className="text-[11px] text-gray-500">Created &amp; updated automatically when a vendor assessment is scored. These are real ERM register entries.</p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            {reg && (
              <>
                <span className="text-gray-500">Total <b className="text-slate-800">{reg.total}</b></span>
                <span className="text-gray-500">Open <b className="text-slate-800">{reg.open}</b></span>
                {reg.avg_residual != null && <span className="text-gray-500">Avg residual <b className="text-slate-800">{reg.avg_residual}</b></span>}
              </>
            )}
            <Link href="/erm/risks/list" className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 font-medium text-gray-700 hover:bg-gray-50">
              <ExternalLink className="h-3.5 w-3.5" /> Risk Register
            </Link>
          </div>
        </div>

        {isLoading ? (
          <div className="flex h-40 items-center justify-center"><PageLoader size="md" label="Loading register…" /></div>
        ) : error ? (
          <div className="flex h-40 flex-col items-center justify-center text-red-500">
            <AlertCircle className="mb-2 h-7 w-7" /><p className="text-sm">Failed to load the register.</p>
            <button onClick={() => refetch()} className="mt-2 text-xs font-medium text-primary-600 hover:underline">Retry</button>
          </div>
        ) : risks.length === 0 ? (
          <div className="p-8 text-center">
            <Shield className="mx-auto mb-2 h-7 w-7 text-gray-400" />
            <p className="text-sm font-medium text-gray-700">No third-party risks in the register yet</p>
            <p className="mx-auto max-w-md text-xs text-gray-500">Run scoring on a vendor’s assessment (Assessments → Risk Analysis &amp; Scoring) and its residual risk will roll up into the enterprise Risk Register here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2.5">Risk</th>
                  <th className="px-4 py-2.5">Vendor</th>
                  <th className="px-4 py-2.5">Tier</th>
                  <th className="px-4 py-2.5">Inherent</th>
                  <th className="px-4 py-2.5">Residual</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Updated</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {risks.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{r.title || `Risk #${r.id}`}</td>
                    <td className="px-4 py-2.5">
                      {r.vendor_id ? (
                        <button onClick={() => router.push(`/vendor-risk/vendors/${r.vendor_id}`)}
                          className="inline-flex items-center gap-1 text-primary-600 hover:underline">
                          {r.vendor_name || `Vendor ${r.vendor_id}`} <ArrowUpRight className="h-3 w-3" />
                        </button>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.tier ? <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${sevBadgeCls(r.tier)}`}>{titleCase(r.tier)}</span> : '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-gray-600">{r.inherent_score ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono font-semibold" style={{ color: scoreColor(r.residual_score) }}>{r.residual_score ?? '—'}</span>
                    </td>
                    <td className="px-4 py-2.5"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{titleCase(r.status || 'open')}</span></td>
                    <td className="px-4 py-2.5 text-[11px] text-gray-500">{fmtDate(r.updated_at)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Link href="/erm/risks/list" className="text-[11px] font-medium text-primary-600 hover:underline">Register →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Domain taxonomy + live open-findings concentration ── */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Layers className="h-4 w-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-900">Risk domains</h3>
          <span className="text-[11px] text-gray-400">The ten domains every assessment scores against</span>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {DOMAINS.map((d) => {
            const count = byDomain[d.key] || 0;
            const hex = DOMAIN_HEX[d.key] || '#64748b';
            return (
              <div key={d.key} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-sm" style={{ background: hex }} />
                    <h4 className="text-sm font-semibold text-slate-900">{d.label}</h4>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${count ? 'bg-orange-50 text-orange-700' : 'bg-gray-100 text-gray-500'}`}>{count} open</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-gray-600">{d.purpose}</p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100" role="img" aria-label={`${d.label}: ${count} open findings`}>
                  <div className="h-full rounded-full" style={{ width: `${(count / maxCount) * 100}%`, background: hex }} />
                </div>
                <div className="mt-3">
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Expected evidence</p>
                  <div className="flex flex-wrap gap-1.5">
                    {d.evidence.map((e) => <span key={e} className="rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600">{e}</span>)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
