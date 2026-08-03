'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plug } from 'lucide-react';
import { cloudConnectorsApi, integrationsApi } from '@/lib/api';
import {
  AwsIcon, AzureIcon, GcpIcon, NessusIcon, NexposeIcon,
} from './ProviderIcons';

/**
 * Card-per-platform picker for vulnerability data sources.
 *
 * Mirrors `IdentityProvidersCard` so the /integrations page has a single
 * consistent way of showing "what tools is this product capable of
 * integrating with?". Each card:
 *   - shows the platform's logo tile + name + one-line description,
 *   - reports a live status badge ("Not configured" / "2 connected"),
 *   - clicks through to the right management surface:
 *       cloud connectors (AWS / Azure / GCP) → /admin (Cloud Connectors tab)
 *       legacy scanners  (Nessus / Nexpose)  → /integrations/connections
 *
 * The badge counts are populated from two existing endpoints:
 *   - `cloudConnectorsApi.list()` for the new framework rows,
 *   - `integrationsApi.listConnections()` for the legacy scanner rows.
 *
 * Both queries are tenant-scoped server-side, so this card never leaks
 * counts from other tenants.
 */

type PlatformKind = 'cloud_connector' | 'legacy_scanner';

interface PlatformDef {
  provider: string;
  label: string;
  description: string;
  kind: PlatformKind;
  iconBg: string;
  icon: typeof AwsIcon;
}

const PLATFORMS: PlatformDef[] = [
  {
    provider: 'aws_inspector',
    label: 'AWS Inspector v2',
    description: 'EC2 / ECR / Lambda findings via STS assume-role.',
    kind: 'cloud_connector',
    iconBg: 'bg-orange-50',
    icon: AwsIcon,
  },
  {
    provider: 'azure_defender',
    label: 'Microsoft Defender for Cloud',
    description: 'Subscription-scoped assessments and CVE sub-assessments.',
    kind: 'cloud_connector',
    iconBg: 'bg-blue-50',
    icon: AzureIcon,
  },
  {
    provider: 'gcp_scc',
    label: 'Google Cloud SCC (Premium)',
    description: 'Org-scoped findings from Security Command Center.',
    kind: 'cloud_connector',
    iconBg: 'bg-emerald-50',
    icon: GcpIcon,
  },
  {
    provider: 'nessus',
    label: 'Tenable Nessus',
    description: 'Scanner ingest via Nessus / Tenable.io API.',
    kind: 'legacy_scanner',
    iconBg: 'bg-sky-50',
    icon: NessusIcon,
  },
  {
    provider: 'nexpose',
    label: 'Rapid7 Nexpose',
    description: 'Scanner ingest via Nexpose / InsightVM API.',
    kind: 'legacy_scanner',
    iconBg: 'bg-rose-50',
    icon: NexposeIcon,
  },
];

export function IntegrationPlatformsCard() {
  const router = useRouter();

  const { data: cloudRows } = useQuery({
    queryKey: ['platforms-card-cloud-list'],
    queryFn: () => cloudConnectorsApi.list().then((r) => r.data),
    staleTime: 30 * 1000,
  });

  const { data: legacyRows } = useQuery({
    queryKey: ['platforms-card-legacy-list'],
    queryFn: async () => {
      try {
        const r = await integrationsApi.listConnections();
        return (r?.data || []) as Array<{ integration_type?: string }>;
      } catch {
        return [];
      }
    },
    staleTime: 30 * 1000,
  });

  // Count configured rows per provider for the status chip.
  const counts: Record<string, number> = {};
  (cloudRows || []).forEach((c) => {
    counts[c.provider] = (counts[c.provider] || 0) + 1;
  });
  (legacyRows || []).forEach((c) => {
    const k = (c.integration_type || '').toLowerCase();
    if (k) counts[k] = (counts[k] || 0) + 1;
  });

  const onClick = (p: PlatformDef) => {
    if (p.kind === 'cloud_connector') {
      // Open the Cloud Connectors admin tab with the right provider preselected.
      router.push(`/admin?tab=cloud-connectors&provider=${p.provider}`);
    } else {
      router.push('/integrations/connections');
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Plug size={16} className="text-blue-600" />
          Supported integrations
        </h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {PLATFORMS.map((p) => {
          const configured = counts[p.provider] || 0;
          const isConnected = configured > 0;
          return (
            <button
              key={p.provider}
              type="button"
              onClick={() => onClick(p)}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left hover:border-blue-300 hover:bg-blue-50/30 transition"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded ${p.iconBg}`}>
                  <p.icon size={18} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate flex items-center gap-1.5">
                    {p.label}
                    {p.kind === 'legacy_scanner' && (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700">
                        Legacy
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500 truncate">{p.description}</p>
                </div>
              </div>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${
                isConnected
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-100 text-slate-600'
              }`}>
                {isConnected
                  ? `${configured} connected`
                  : (p.kind === 'cloud_connector' ? 'Add' : 'Manage')}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
