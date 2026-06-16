'use client';

/**
 * IP-Group Panel ("room and chair" — inventory-import edition).
 *
 * PRIMARY FLOW:
 *   Assets come in from the bank's third-party inventory system already
 *   registered with IP addresses. Assets sharing the same IP are co-located
 *   on the same physical/virtual host. This panel shows that cluster,
 *   the CIS benchmark available for each member, individual scores, and
 *   the composite risk formula.
 *
 * EXTRA / ADVANCED FLOW (collapsed by default):
 *   Agent-based app discovery — the agent heartbeats detected software and
 *   operators can promote it to child assets. This is a Phase-2 scanning
 *   feature; kept but not the primary UI.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  Network, Server, Database, Globe, Cog, ChevronRight, Loader2,
  ShieldCheck, ShieldAlert, ShieldX, Info, Zap, AlertTriangle,
  ArrowUpRight, CheckCircle2, Minus, PlusCircle, PackageOpen,
  ServerCog, Radio, Boxes, Layers, ChevronDown, Settings2, Save, RotateCcw, X,
} from 'lucide-react';
import { assetsApi, compliancePluginsApi } from '@/lib/api';
import { useRoomScan } from './_room-scan-context';

// ── helpers ─────────────────────────────────────────────────────────────────

const scoreTone = (s: number | null | undefined) => {
  if (s == null) return { text: 'text-gray-400', ring: 'ring-gray-200', bg: 'bg-gray-50', bar: 'bg-gray-300', border: 'border-gray-100' };
  if (s >= 85) return { text: 'text-emerald-600', ring: 'ring-emerald-200', bg: 'bg-emerald-50', bar: 'bg-emerald-500', border: 'border-emerald-100' };
  if (s >= 70) return { text: 'text-lime-600', ring: 'ring-lime-200', bg: 'bg-lime-50', bar: 'bg-lime-500', border: 'border-lime-100' };
  if (s >= 50) return { text: 'text-amber-600', ring: 'ring-amber-200', bg: 'bg-amber-50', bar: 'bg-amber-500', border: 'border-amber-100' };
  return { text: 'text-red-600', ring: 'ring-red-200', bg: 'bg-red-50', bar: 'bg-red-500', border: 'border-red-100' };
};

/** True only for assets whose os_normalized IS a native OS (Windows/Linux),
 *  not apps (Tomcat, IIS, Oracle…) that map to a Linux/Windows runner. */
function isNativeOsPlatform(osNorm: string | null | undefined): boolean {
  if (!osNorm) return false;
  const k = osNorm.toLowerCase();
  return (
    k.startsWith('windows') || k.startsWith('ubuntu') || k.startsWith('linux') ||
    k.startsWith('debian') || k.startsWith('centos') || k.startsWith('rhel') ||
    k.startsWith('amazon-linux') || k.startsWith('rocky') || k.startsWith('almalinux')
  );
}

/** Map os_normalized → Connect Wizard platform id */
function osToWizPlatform(osNorm: string | null | undefined): string | null {
  if (!osNorm) return null;
  const k = osNorm.toLowerCase();
  if (k.startsWith('windows-server') || k.startsWith('windows-11') || k.startsWith('windows-10') || k.startsWith('windows')) return 'windows';
  if (k.startsWith('ubuntu') || k.startsWith('linux') || k.startsWith('debian') || k.startsWith('centos') || k.startsWith('rhel') || k.startsWith('amazon-linux') || k.startsWith('rocky') || k.startsWith('almalinux')) return 'linux';
  if (k.startsWith('postgresql') || k.startsWith('postgres')) return 'postgres';
  if (k.startsWith('mysql') || k.startsWith('mariadb')) return 'mysql';
  if (k.startsWith('mssql') || k.startsWith('sql-server')) return 'mssql';
  if (k.startsWith('oracle-db') || k.startsWith('oracle')) return 'oracle';
  if (k.startsWith('mongodb')) return 'mongodb';
  if (k.startsWith('iis')) return 'windows';
  if (k.startsWith('tomcat') || k.startsWith('apache') || k.startsWith('nginx')) return 'linux';
  if (k.startsWith('cisco')) return null; // no wizard card yet
  return null;
}

const typeIcon = (assetType: string, osNorm: string | null | undefined) => {
  const k = (osNorm || '').toLowerCase();
  if (/sql|postgres|mysql|mongo|cassandra|db2|redis|maria/.test(k)) return Database;
  if (/iis|tomcat|httpd|nginx|web|apache/.test(k)) return Globe;
  if (assetType === 'infrastructure') return Server;
  return Cog;
};

const critLabel: Record<string, string> = {
  low: 'Low', medium: 'Med', high: 'High', critical: 'Crit',
};
const critBadge: Record<string, string> = {
  low: 'bg-gray-50 text-gray-600 ring-gray-200',
  medium: 'bg-amber-50 text-amber-700 ring-amber-200',
  high: 'bg-orange-50 text-orange-700 ring-orange-200',
  critical: 'bg-red-50 text-red-700 ring-red-200',
};

const AGENTLESS_REASON: Record<string, string> = {
  mssql:     'CIS checks query SQL Server internals (sys.* views, DMVs) via a SQL auth connection — an OS agent reading shell or registry cannot reach them.',
  oracle:    'Oracle CIS checks run over TNS/JDBC to query DBA_* views. A host OS agent has no visibility into database internals.',
  postgres:  'PostgreSQL checks use pg_stat_* and psql queries — they need a direct DB connection, not OS-level shell access.',
  mysql:     'MySQL/MariaDB checks query information_schema and performance_schema directly. OS agents cannot inspect database internals.',
  mongodb:   'MongoDB checks connect via the wire protocol to inspect configuration and user privileges. OS agents only see the process, not its data.',
  redis:     'Redis checks connect directly over TCP to query CONFIG GET and server info. OS agents cannot access in-memory data.',
  tomcat:    'Tomcat CIS checks read server.xml and use the JMX/Manager API — they need direct HTTP or JMX access to the app layer.',
  iis:       'IIS checks verify application pool config, handler mappings, and HTTPS bindings via direct WMI/HTTP calls.',
  nginx:     'nginx checks parse config files and probe HTTP headers — they need network access to the service, not just the OS.',
  apache:    'Apache checks read httpd.conf, test .htaccess policies, and probe HTTP responses — they require direct app-layer access.',
  webserver: 'Web server CIS checks probe HTTP responses and config files directly. OS agents read system files only and cannot inspect application config.',
  generic:   'CIS checks for this application require a direct protocol connection to the service. An OS agent reads OS-level config only and cannot inspect application internals.',
};

function getAgentlessReason(name: string, osNorm: string | null | undefined): string {
  const cat = appCategory(name, osNorm);
  return AGENTLESS_REASON[cat] ?? AGENTLESS_REASON.generic;
}

function CritBadge({ criticality, weight, name, osNorm }: {
  criticality: string; weight?: number; name: string; osNorm?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const reason = getCritReason(criticality, name, osNorm);
  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        className={`rounded-full px-2 py-px text-[10px] font-semibold ring-1 cursor-pointer hover:opacity-80 transition ${critBadge[criticality] ?? critBadge.medium}`}
      >
        {critLabel[criticality] ?? criticality}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-50 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-xl">
          <div className="flex items-center justify-between mb-2">
            <span className={`rounded-full px-2 py-px text-[10px] font-semibold ring-1 ${critBadge[criticality] ?? critBadge.medium}`}>
              {critLabel[criticality] ?? criticality} criticality
            </span>
            {weight != null && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                ×{weight} composite weight
              </span>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-gray-600">{reason}</p>
          <button onClick={() => setOpen(false)} className="mt-2 text-[10px] text-blue-500 underline">Close</button>
        </div>
      )}
    </div>
  );
}

function AgentlessNote({ name, osNorm }: { name: string; osNorm?: string | null }) {
  const [open, setOpen] = useState(false);
  const reason = getAgentlessReason(name, osNorm);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600 hover:bg-blue-100 transition"
      >
        <Info className="h-3 w-3 shrink-0" />
        Agentless only
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-xl">
          <p className="mb-1 text-[11px] font-semibold text-gray-800">Why agentless only?</p>
          <p className="text-[11px] leading-relaxed text-gray-500">{reason}</p>
          <button onClick={() => setOpen(false)} className="mt-2 text-[10px] text-blue-500 underline">Close</button>
        </div>
      )}
    </div>
  );
}

function appCategory(name: string, osNorm: string | null | undefined): string {
  const n = (name || '').toLowerCase();
  const o = (osNorm || '').toLowerCase();
  if (/mssql|sql.server|sql server/.test(n) || /mssql|sql-server/.test(o)) return 'mssql';
  if (/oracle/.test(n) || /oracle/.test(o)) return 'oracle';
  if (/postgres/.test(n) || /postgres/.test(o)) return 'postgres';
  if (/mysql|mariadb/.test(n) || /mysql|mariadb/.test(o)) return 'mysql';
  if (/mongo/.test(n) || /mongo/.test(o)) return 'mongodb';
  if (/redis/.test(n) || /redis/.test(o)) return 'redis';
  if (/tomcat/.test(n) || /tomcat/.test(o)) return 'tomcat';
  if (/iis|internet information/.test(n) || /iis/.test(o)) return 'iis';
  if (/nginx/.test(n) || /nginx/.test(o)) return 'nginx';
  if (/apache/.test(n) || /apache/.test(o)) return 'apache';
  if (/web.server|web server/.test(n)) return 'webserver';
  return 'generic';
}

const CRIT_REASON: Record<string, Record<string, string>> = {
  mssql: {
    critical: 'SQL Server stores the organisation\'s core transactional data. A compromise causes immediate data exfiltration, financial fraud, or full data loss — making it the highest-impact asset on the host.',
    high:     'SQL Server holds sensitive business data. Vulnerabilities here risk significant data exposure and regulatory penalties, warranting a high-impact weight.',
    medium:   'SQL Server is a key data store. Misconfigurations can lead to data leakage; medium criticality reflects moderate exposure in this environment.',
    low:      'SQL Server in this role has limited data sensitivity. Hardening is still recommended but its compromise has contained blast radius.',
  },
  oracle: {
    critical: 'Oracle Database is the primary data repository. Exploitation can expose entire financial or customer record sets and trigger audit failures.',
    high:     'Oracle DB holds important application data. Weak hardening can result in privilege escalation and data exfiltration at scale.',
    medium:   'Oracle DB in this context carries moderate data sensitivity. Gaps in CIS controls increase the attack surface for authenticated users.',
    low:      'Oracle DB in this role holds low-sensitivity data. Hardening still reduces insider-threat risk.',
  },
  postgres: {
    critical: 'PostgreSQL is the primary operational database. Unpatched vulnerabilities or misconfigured access controls put core business data at direct risk.',
    high:     'PostgreSQL stores important application data. Misconfigurations such as weak authentication or unencrypted connections expose sensitive records.',
    medium:   'PostgreSQL hosts moderate-sensitivity data. Compliance gaps increase the risk of credential theft and lateral movement.',
    low:      'PostgreSQL in this role has limited exposure. Standard hardening controls are sufficient.',
  },
  mysql: {
    critical: 'MySQL holds transactional or customer-facing data. A breach leads to mass data exposure and potential PCI-DSS or GDPR violations.',
    high:     'MySQL stores significant application data. Weak CIS hardening allows SQL injection impacts and unauthorised read access.',
    medium:   'MySQL carries application data with moderate sensitivity. Gaps increase the risk of authorised-user abuse.',
    low:      'MySQL in this deployment has limited data sensitivity. Basic hardening controls the risk adequately.',
  },
  mongodb: {
    critical: 'MongoDB exposed without proper auth or TLS has been a recurring breach vector. As the primary data store, exploitation risks full collection dumps.',
    high:     'MongoDB stores significant data; misconfigured access controls or missing auth allow data exfiltration without credentials.',
    medium:   'MongoDB holds moderate-sensitivity data. Missing CIS controls increase the risk of authenticated-user abuse.',
    low:      'MongoDB in this role stores low-sensitivity data with limited external exposure.',
  },
  redis: {
    critical: 'Redis with external access is a well-known RCE vector. As an in-memory store it may cache credentials or session tokens.',
    high:     'Redis stores session or cache data. Misconfiguration allows unauthenticated reads, credential theft, and potential code execution.',
    medium:   'Redis caches application data. Weak auth or missing TLS exposes cache contents to network peers.',
    low:      'Redis in this deployment serves a low-sensitivity cache role. Network segmentation limits exposure.',
  },
  tomcat: {
    critical: 'Apache Tomcat serves external-facing web applications. RCE via deserialization, admin console exposure, or weak AJP config makes it a top entry point.',
    high:     'Tomcat hosts web applications exposed to users or the internet. Known CVEs in this version can allow remote code execution if unpatched.',
    medium:   'Tomcat runs internal web services. Misconfigurations such as default manager credentials or verbose error pages increase attack surface.',
    low:      'Tomcat serves a limited internal application. Attack surface is reduced by network isolation.',
  },
  iis: {
    critical: 'IIS is the public-facing web server. Vulnerabilities or misconfigurations directly expose the organisation to remote exploitation.',
    high:     'IIS hosts important web services. Unpatched modules, directory traversal, or weak TLS settings are common high-impact attack paths.',
    medium:   'IIS serves internal web content. Non-default configuration gaps raise the risk of information disclosure or SSRF.',
    low:      'IIS in this role serves a limited audience with minimal external exposure.',
  },
  nginx: {
    critical: 'nginx acts as the primary reverse proxy or internet-facing server. Misconfiguration exposes backend services and enables header injection or SSRF.',
    high:     'nginx forwards traffic to sensitive backend services. Weak TLS or misconfigured proxy headers can bypass authentication controls.',
    medium:   'nginx serves internal traffic. Non-standard configuration may leak backend topology or enable request smuggling.',
    low:      'nginx in this role has limited external exposure; standard hardening suffices.',
  },
  apache: {
    critical: 'Apache HTTP Server is the primary internet-facing web server. Known module vulnerabilities and misconfigurations are active exploit targets.',
    high:     'Apache hosts important web applications. Enabled unused modules, weak .htaccess policies, or missing security headers increase risk.',
    medium:   'Apache serves internal web content. Default configuration gaps raise the risk of directory listing or information disclosure.',
    low:      'Apache in this role serves a restricted internal audience with low sensitivity.',
  },
  webserver: {
    critical: 'This web server is a primary internet-facing entry point. Exploitation leads to full host compromise and lateral movement into backend systems.',
    high:     'This web server handles significant application traffic. Misconfigurations or unpatched software create high-impact entry points.',
    medium:   'This web server handles internal requests. Non-hardened defaults increase the risk of information disclosure or injection.',
    low:      'This web server has limited exposure and handles low-sensitivity traffic.',
  },
  generic: {
    critical: 'This service has been classified as Critical because a successful attack would cause severe, organisation-wide impact — data loss, service outage, or regulatory breach.',
    high:     'This service is rated High because exploitation could significantly affect business operations, expose sensitive data, or enable lateral movement to other systems.',
    medium:   'This service is rated Medium: a compromise would have a contained but meaningful impact. Hardening controls reduce the likelihood of exploitation.',
    low:      'This service has low inherent risk in its current role. Standard CIS controls keep it within acceptable exposure limits.',
  },
};

function getCritReason(criticality: string, name: string, osNorm: string | null | undefined): string {
  const cat = appCategory(name, osNorm);
  const crit = (criticality || 'medium').toLowerCase();
  return CRIT_REASON[cat]?.[crit] ?? CRIT_REASON.generic[crit] ?? '';
}

function ScoreDonut({ score, size = 80, label }: { score: number | null; size?: number; label: string }) {
  const tone = scoreTone(score);
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const filled = score == null ? 0 : (score / 100) * c;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6} className="stroke-gray-100" />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6}
            strokeDasharray={`${filled} ${c - filled}`} strokeLinecap="round"
            className={tone.bar.replace('bg-', 'stroke-')} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-lg font-bold tabular-nums ${tone.text}`}>
            {score == null ? '—' : `${Math.round(score)}%`}
          </span>
        </div>
      </div>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</span>
    </div>
  );
}

// ── legacy agent-panel sub-components (kept as "Advanced" feature) ───────────

const sourceBadge: Record<string, { label: string; cls: string }> = {
  windows_role:      { label: 'Server role', cls: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  registry:          { label: 'Installed',   cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  listening_process: { label: 'Listening',   cls: 'bg-violet-50 text-violet-700 ring-violet-200' },
  dpkg:              { label: 'Package',     cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  rpm:               { label: 'Package',     cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
};

function AgentDiscoveryPanel({ assetId }: { assetId: number }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ msg: string; kind: 'info' | 'warn' | 'error' } | null>(null);

  const detectedQ = useQuery({
    queryKey: ['assets', assetId, 'detected-software'],
    queryFn: () => assetsApi.getDetectedSoftware(assetId).then((r: any) => r.data),
  });

  const promoteMut = useMutation({
    mutationFn: (keys: string[]) => assetsApi.promoteSoftware(assetId, keys).then((r: any) => r.data),
    onSuccess: (d: any) => {
      const created: any[] = d.created ?? [];
      const skipped: any[] = d.skipped ?? [];
      const alreadyPromoted = skipped.filter((s: any) => s.reason === 'already promoted');
      if (created.length === 0 && alreadyPromoted.length > 0) {
        const names = alreadyPromoted.map((s: any) => s.software_key).join(', ');
        const ids = alreadyPromoted.map((s: any) => s.asset_id ? `#${s.asset_id}` : null).filter(Boolean).join(', ');
        setToast({ kind: 'warn', msg: `Already registered: ${names}${ids ? ` (asset ${ids})` : ''}. This application already exists as an asset — it appears in the Co-located assets list above.` });
      } else {
        const skippedNote = alreadyPromoted.length > 0 ? ` (${alreadyPromoted.length} skipped — already existed)` : '';
        setToast({ kind: 'info', msg: `${created.length} app asset(s) created${skippedNote}.` });
      }
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['assets', assetId, 'detected-software'] });
      qc.invalidateQueries({ queryKey: ['assets', assetId, 'ip-peers'] });
    },
    onError: (e: any) => setToast({ kind: 'error', msg: e?.response?.data?.detail || 'Promotion failed — please try again.' }),
  });

  const inv = detectedQ.data;
  const promotable = useMemo(
    () => (inv?.inventory ?? []).filter((e: any) => e.benchmark_available && !e.promoted_asset_id),
    [inv],
  );
  const otherSw = useMemo(
    () => (inv?.inventory ?? []).filter((e: any) => !e.benchmark_available && !e.promoted_asset_id),
    [inv],
  );

  const toggle = (key: string) => {
    setSelected(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };

  if (detectedQ.isLoading) {
    return <div className="flex items-center gap-2 py-4 text-xs text-gray-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading agent inventory…</div>;
  }

  const totalDetected = (inv?.inventory ?? []).length;
  if (totalDetected === 0) {
    return (
      <div className="flex items-center gap-2 py-3 text-xs text-gray-400">
        <PackageOpen className="h-4 w-4" />
        No agent-reported software yet. Connect this host via the agent to populate.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Promotable (benchmark-available) */}
      {promotable.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <h5 className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-amber-600">
              <ShieldAlert className="h-3 w-3" /> Awaiting protection ({promotable.length})
            </h5>
            <button
              onClick={() => promoteMut.mutate(Array.from(selected))}
              disabled={selected.size === 0 || promoteMut.isPending}
              className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
            >
              {promoteMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlusCircle className="h-3 w-3" />}
              Add {selected.size > 0 ? `${selected.size} selected` : 'selected'}
            </button>
          </div>
          <ul className="divide-y divide-amber-100/60 overflow-hidden rounded-lg border border-amber-200/70 bg-amber-50/30">
            {promotable.map((e: any) => {
              const Icon = typeIcon('application', e.software_key);
              const badge = sourceBadge[e.source] ?? { label: e.source, cls: 'bg-gray-50 text-gray-600 ring-gray-200' };
              const checked = selected.has(e.software_key);
              return (
                <li key={e.software_key} onClick={() => toggle(e.software_key)}
                  className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 text-xs transition ${checked ? 'bg-amber-50' : 'hover:bg-amber-50/60'}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(e.software_key)}
                    onClick={ev => ev.stopPropagation()}
                    className="h-3.5 w-3.5 rounded border-gray-300" />
                  <Icon className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-gray-900">{e.name}</span>
                    {e.version && <span className="ml-1 text-gray-400">v{e.version}</span>}
                    <div className="flex items-center gap-1 mt-0.5">
                      <code className="font-mono text-[10px] text-gray-400">{e.software_key}</code>
                      <span className={`rounded-full px-1.5 py-px text-[10px] font-medium ring-1 ${badge.cls}`}>{badge.label}</span>
                    </div>
                  </div>
                  <span className="hidden items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200 sm:inline-flex">
                    <CheckCircle2 className="h-3 w-3" /> CIS ready
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Other detected software */}
      {otherSw.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600">
            <ChevronRight className="h-3 w-3 transition group-open:rotate-90" />
            <Boxes className="h-3 w-3" /> Other detected ({otherSw.length}) — no CIS benchmark
          </summary>
          <ul className="mt-1.5 max-h-48 divide-y divide-gray-50 overflow-y-auto rounded-lg border border-gray-100">
            {otherSw.map((e: any) => {
              const Icon = typeIcon('application', e.software_key);
              const badge = sourceBadge[e.source] ?? { label: e.source, cls: 'bg-gray-50 text-gray-600 ring-gray-200' };
              const checked = selected.has(e.software_key);
              return (
                <li key={e.software_key} onClick={() => toggle(e.software_key)}
                  className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 text-xs transition ${checked ? 'bg-slate-50' : 'hover:bg-gray-50'}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(e.software_key)}
                    onClick={ev => ev.stopPropagation()} className="h-3.5 w-3.5 rounded border-gray-300" />
                  <Icon className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-gray-700">{e.name}</span>
                    {e.version && <span className="ml-1 text-gray-400">v{e.version}</span>}
                    <div><code className="font-mono text-[10px] text-gray-400">{e.software_key}</code>
                      <span className={`ml-1 rounded-full px-1.5 py-px text-[10px] font-medium ring-1 ${badge.cls}`}>{badge.label}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {selected.size > 0 && (
            <button onClick={() => promoteMut.mutate(Array.from(selected))} disabled={promoteMut.isPending}
              className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-40">
              {promoteMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlusCircle className="h-3 w-3" />}
              Add {selected.size} as tracked assets
            </button>
          )}
        </details>
      )}

      {toast && (
        <div className={`flex items-start justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${
          toast.kind === 'warn'  ? 'border-amber-200 bg-amber-50 text-amber-800' :
          toast.kind === 'error' ? 'border-red-200 bg-red-50 text-red-800' :
                                   'border-blue-200 bg-blue-50 text-blue-800'
        }`}>
          <span>{toast.msg}</span>
          <button onClick={() => setToast(null)} className="shrink-0 text-[10px] underline opacity-60 hover:opacity-100">dismiss</button>
        </div>
      )}
    </div>
  );
}

// ── Scan-now button (OS assets only) ─────────────────────────────────────────

function ScanNowButton({ targetAssetId, groupHostAssetId }: { targetAssetId: number; groupHostAssetId: number }) {
  const qc = useQueryClient();
  const [queued, setQueued] = useState(false);

  const mut = useMutation({
    mutationFn: () => compliancePluginsApi.scanAll({ asset_id: targetAssetId }) as Promise<unknown>,
    onSuccess: () => {
      setQueued(true);
      qc.invalidateQueries({ queryKey: ['assets', groupHostAssetId, 'ip-peers'] });
      setTimeout(() => setQueued(false), 4000);
    },
  });

  if (queued) {
    return (
      <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
        <CheckCircle2 className="h-3.5 w-3.5" /> Queued
      </span>
    );
  }

  return (
    <button
      onClick={() => mut.mutate()}
      disabled={mut.isPending}
      title="Run CIS scan now"
      className="flex items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-700 transition hover:bg-teal-100 disabled:opacity-50"
    >
      {mut.isPending
        ? <Loader2 className="h-3 w-3 animate-spin" />
        : <Radio className="h-3 w-3" />}
      {mut.isPending ? 'Scanning…' : 'Scan now'}
    </button>
  );
}

// ── Composite score card (with configurable weights) ─────────────────────────

const WEIGHT_KEYS: Array<{ key: 'low' | 'medium' | 'high' | 'critical'; label: string }> = [
  { key: 'low',      label: 'Low' },
  { key: 'medium',   label: 'Medium' },
  { key: 'high',     label: 'High' },
  { key: 'critical', label: 'Critical' },
];

function CompositeScoreCard({
  composite,
  formula,
  assetId,
  navigate,
}: {
  composite: any;
  formula: any;
  assetId: number;
  navigate: (path: string) => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const weightsQ = useQuery({
    queryKey: ['composite-weights'],
    queryFn: () => assetsApi.getCompositeWeights().then((r: any) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const saveMut = useMutation({
    mutationFn: (w: { low: number; medium: number; high: number; critical: number }) =>
      assetsApi.updateCompositeWeights(w),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['composite-weights'] });
      qc.invalidateQueries({ queryKey: ['assets'] });
      setEditing(false);
    },
  });

  const resetMut = useMutation({
    mutationFn: () => assetsApi.resetCompositeWeights(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['composite-weights'] });
      qc.invalidateQueries({ queryKey: ['assets'] });
      setEditing(false);
    },
  });

  const liveWeights: Record<string, number> =
    weightsQ.data?.weights ?? formula?.criticality_weights ?? { low: 1, medium: 2, high: 3, critical: 4 };
  const isCustom = weightsQ.data?.is_custom ?? false;

  const openEditor = () => {
    setDraft(Object.fromEntries(Object.entries(liveWeights).map(([k, v]) => [k, String(v)])));
    setEditing(true);
  };

  const handleSave = () => {
    const parsed: any = {};
    for (const { key } of WEIGHT_KEYS) {
      const v = parseFloat(draft[key] ?? '');
      if (isNaN(v) || v <= 0) return;
      parsed[key] = v;
    }
    saveMut.mutate(parsed);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">

      {/* ── Score header ──────────────────────────────────────────────── */}
      <div className="bg-slate-50 px-5 py-4">
        <div className="flex flex-wrap items-start gap-4">

          {/* Score donuts */}
          <div className="flex items-center gap-3 shrink-0">
            <ScoreDonut score={composite.host_score ?? null} label="OS Host" />
            <div className="flex flex-col items-center gap-0.5 px-1">
              <div className="flex gap-0.5">{[0,1,2].map(i=><div key={i} className="h-px w-3 rounded-full bg-slate-300"/>)}</div>
              <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">blend</span>
              <div className="flex gap-0.5">{[0,1,2].map(i=><div key={i} className="h-px w-3 rounded-full bg-slate-300"/>)}</div>
            </div>
            <ScoreDonut score={composite.effective_score ?? null} label="Effective" />
          </div>

          {/* Explanation */}
          <div className="flex-1 min-w-[200px]">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-gray-900">Group compliance score</p>
              <button
                onClick={openEditor}
                className="flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-800"
              >
                <Settings2 className="h-3 w-3" />
                Configure weights{isCustom && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-amber-400 inline-block" />}
              </button>
            </div>
            <p className="text-[13px] text-gray-700 leading-relaxed">
              The <strong>host OS</strong> contributes <strong>60%</strong> of this score.
              Applications contribute the remaining <strong>40%</strong>,
              weighted by criticality — shown in each row below.
            </p>
            {(composite.penalties ?? []).length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {(composite.penalties ?? []).map((p: any, i: number) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700 ring-1 ring-red-200">
                    <Minus className="h-3 w-3" />
                    −{p.points} pts: {p.reason}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Weakest link */}
          {composite.weakest && composite.weakest.id !== assetId && (
            <button
              onClick={() => navigate(`/assets/${composite.weakest.id}`)}
              className="shrink-0 flex flex-col items-end gap-0.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-right transition hover:bg-red-100"
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-red-500">Weakest link</span>
              <span className="flex items-center gap-1 text-xs font-bold text-red-800">
                {composite.weakest.name?.split(' @')[0]}
                <ArrowUpRight className="h-3 w-3" />
              </span>
              <span className="text-base font-bold tabular-nums text-red-700">
                {Math.round(composite.weakest.score)}%
              </span>
            </button>
          )}
        </div>

        {/* Weight editor — inline below header */}
        {editing && (
          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-blue-900">Criticality weights</p>
                <p className="text-[12px] text-blue-700 mt-0.5">
                  Higher weight = bigger impact on the composite score.
                </p>
              </div>
              <button onClick={() => setEditing(false)} className="rounded-full p-1 hover:bg-blue-100 text-blue-400 hover:text-blue-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-3">
              {WEIGHT_KEYS.map(({ key, label }) => (
                <div key={key}>
                  <label className="mb-1 block">
                    <span className={`inline-block rounded-full px-2 py-px text-[10px] ring-1 ${critBadge[key] ?? critBadge.medium}`}>
                      {label}
                    </span>
                  </label>
                  <input
                    type="number"
                    min="0.1"
                    step="0.5"
                    value={draft[key] ?? ''}
                    onChange={e => setDraft(prev => ({ ...prev, [key]: e.target.value }))}
                    className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-semibold text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300"
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={saveMut.isPending}
                className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-[12px] font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
              >
                {saveMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Save weights
              </button>
              {isCustom && (
                <button
                  onClick={() => resetMut.mutate()}
                  disabled={resetMut.isPending}
                  className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  {resetMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                  Reset to defaults
                </button>
              )}
              {saveMut.isError && <span className="text-[11px] text-red-600">Failed to save. Try again.</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── main panel ───────────────────────────────────────────────────────────────
// "Scan the room, not the chair": this panel renders the IP group and the
// per-peer checkboxes. The actual scan trigger lives on the existing
// "Scan now" button in ComplianceTab — it reads the selected peers from
// the shared RoomScanContext and folds their CIS rules into the scan call.

export default function HostApplicationsPanel({ assetId }: { assetId: number }) {
  const router = useRouter();
  const navigate = (path: string) => router.push(path);

  const ipPeersQ = useQuery({
    queryKey: ['assets', assetId, 'ip-peers'],
    queryFn: () => assetsApi.getIPPeers(assetId).then((r: any) => r.data),
  });

  const data = ipPeersQ.data;
  const group: any[] = data?.group ?? [];
  const composite = data?.composite;
  const formula = data?.formula;
  const ip = data?.ip_address;

  // Room-scan selection — peer asset ids the user has ticked. Lives in a
  // context shared with ComplianceTab so the existing "Scan now" button can
  // fold the selected peers into its scan call, and the matched-benchmark
  // count can show "host + peers" in real time.
  //
  // CRITICAL: every hook below must live ABOVE the early-return guards for
  // isLoading/isError. React enforces a stable hook count per render — moving
  // any hook below an early return triggers "Rendered more hooks than during
  // the previous render."
  const roomScan = useRoomScan();
  // Pull the stable callbacks out so we don't depend on the whole roomScan
  // object (whose identity flips whenever any state inside the provider
  // changes). Each function below is wrapped in useCallback in the provider,
  // so the references are stable across renders.
  const roomScanClear = roomScan.clearSelection;
  const roomScanReportPeer = roomScan.reportPeer;
  // Clear selection on asset change (the opened asset is the implicit anchor;
  // navigating to a different asset starts a fresh selection).
  useEffect(() => { roomScanClear(); }, [assetId, roomScanClear]);
  // Derive includablePeers via useMemo so its array identity is stable
  // when `group` hasn't changed — otherwise the publish-effect below would
  // fire on every render and slow the panel down.
  const includablePeers = useMemo(
    () => group.filter((g: any) => !g.is_self && g.benchmark_available),
    [group],
  );
  // Publish each includable peer's name + rule count to the context so
  // ComplianceTab can compute "matched + peers" totals AND show a per-peer
  // breakdown in the post-scan toast without re-querying ip-peers.
  useEffect(() => {
    includablePeers.forEach((p: any) => {
      roomScanReportPeer(p.id as number, {
        name: (p.name as string) ?? `Asset ${p.id}`,
        ruleCount: (p.rule_count as number) ?? 0,
      });
    });
  }, [includablePeers, roomScanReportPeer]);

  // Don't render if this is an application-type asset with no group peers
  // (i.e. a solo app — the panel still shows its own benchmark, so always render)
  // Hide completely only while initial load and nothing to show
  if (ipPeersQ.isLoading) {
    return (
      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 p-5 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading IP group…
        </div>
      </section>
    );
  }

  if (ipPeersQ.isError || !data) return null;

  const hostEntry = group.find(g => g.is_host_os);
  const appEntries = group.filter(g => !g.is_host_os);
  const selfEntry = group.find(g => g.is_self);

  const benchmarkCount = group.filter(g => g.benchmark_available).length;
  const hasMultiple = group.length > 1;

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">

      {/* ── Panel header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-gray-100 bg-gradient-to-r from-slate-50 to-white px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900">
            <Network className="h-4 w-4 text-white" />
          </div>
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              {ip ? `IP Group: ${ip}` : 'Asset Benchmarks'}
            </h3>
            <p className="text-[11px] text-gray-500">
              {hasMultiple
                ? `${group.length} assets share this IP — they run on the same host`
                : 'This asset is standalone (no co-located assets at this IP)'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          {hasMultiple && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
              {group.length} assets
            </span>
          )}
          {benchmarkCount > 0 && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-emerald-200">
              {benchmarkCount} benchmark{benchmarkCount !== 1 ? 's' : ''} available
            </span>
          )}
          {/* Room-scan trigger lives on the existing "Scan now" button in the
              ComplianceTab below — that button reads selected peers from the
              shared RoomScanContext and folds them into its scan call, so the
              user has one consistent place to click. */}
          {roomScan.selectedPeerIds.length > 0 && (
            <span
              className="rounded-full bg-teal-50 px-2 py-0.5 font-medium text-teal-700 ring-1 ring-teal-200"
              title="Tick more peers to fold their CIS rules into the next scan"
            >
              {roomScan.selectedPeerIds.length} peer{roomScan.selectedPeerIds.length === 1 ? '' : 's'} selected · +{roomScan.selectedPeerRuleSum} rules
            </span>
          )}
        </div>
      </div>

      <div className="p-5 space-y-5">

        {/* ── Composite score card ──────────────────────────────────────── */}
        {composite && hasMultiple && (
          <CompositeScoreCard
            composite={composite}
            formula={formula}
            assetId={assetId}
            navigate={navigate}
          />
        )}

        {/* ── Asset table ───────────────────────────────────────────────── */}
        <div>
          {hasMultiple && (
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
              <Layers className="h-3.5 w-3.5" /> Co-located assets ({group.length})
            </h4>
          )}
          <ul className="divide-y divide-gray-50 overflow-hidden rounded-lg border border-gray-100">
            {(() => {
              const acByAssetId = Object.fromEntries(
                (composite?.app_contributions ?? []).map((ac: any) => [ac.asset_id, ac])
              );
              return group.map((g: any) => {
              const tone = scoreTone(g.score);
              const Icon = typeIcon(g.asset_type, g.os_normalized);
              const ac = acByAssetId[g.id];
              const wizPlatform = osToWizPlatform(g.os_normalized);
              // OS platforms (windows, linux) → method picker first so the user
              // can choose agent vs agentless. App platforms (mssql, postgres,
              // tomcat, etc.) go straight to the Connect Wizard — only agentless
              // applies to them.
              const _OS_PLATFORMS = new Set(['windows', 'linux']);
              const connectHref = wizPlatform
                ? _OS_PLATFORMS.has(wizPlatform)
                  ? `/admin/integrations/connect?platform=${wizPlatform}&asset_id=${g.id}&hostname=${encodeURIComponent(g.name ?? '')}`
                  : `/admin/integrations/connect?platform=${wizPlatform}&asset_id=${g.id}`
                : null;
              const isSelf = g.is_self;

              const peerIsSelected = roomScan.isSelected(g.id as number);
              // Checkbox gating: a peer is includable when (a) it isn't self,
              // (b) has a resolved CIS benchmark to fold in, AND (c) the IP
              // group has at least one active integration the scan can run
              // through. Without a connection, ticking a peer would queue a
              // scan that backend rejects with "no connection" — show no
              // checkbox at all instead of letting the user click an action
              // that can't succeed.
              const groupConnected = data?.connection_available ?? false;
              const isIncludablePeer = !isSelf && g.benchmark_available && groupConnected;
              // "Already has results" = a previous scan finished against this
              // peer. The checkbox still works (rescan is always allowed); we
              // just relabel the tooltip so the user understands the impact.
              const peerAlreadyScanned = isIncludablePeer && g.score != null;
              return (
                <li key={g.id}
                  className={`flex items-center gap-3 px-4 py-3 transition ${
                    isSelf ? 'bg-blue-50/40'
                    : peerIsSelected ? 'bg-teal-50/40 hover:bg-teal-50/60'
                    : 'bg-white hover:bg-slate-50/60'
                  }`}>

                  {/* Room-scan checkbox cell. Always rendered (even when not
                      a peer with a benchmark) so the rows align in a column.
                      Tooltip distinguishes "include in scan" from "rescan" so
                      the user knows ticking a previously-scanned peer will
                      overwrite its history with a fresh run. */}
                  <div className="w-5 shrink-0 flex items-center justify-center">
                    {isIncludablePeer ? (
                      <input
                        type="checkbox"
                        checked={peerIsSelected}
                        onChange={() => roomScan.togglePeer(g.id as number)}
                        title={peerAlreadyScanned
                          ? `Already scanned (${Math.round(g.score)}%). Tick to RESCAN — adds ${g.rule_count ?? 0} fresh ${g.benchmark_name ?? 'benchmark'} runs.`
                          : `Include this peer's ${g.rule_count ?? 0} ${g.benchmark_name ?? 'benchmark'} rules in the next Scan now`}
                        className="h-3.5 w-3.5 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                      />
                    ) : null}
                  </div>

                  {/* Icon */}
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.bg} ring-1 ${tone.ring}`}>
                    <Icon className={`h-4 w-4 ${tone.text}`} />
                  </div>

                  {/* Name + badges */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        onClick={() => navigate(`/assets/${g.id}`)}
                        className="text-sm font-semibold text-gray-900 hover:text-blue-600 hover:underline text-left leading-tight"
                      >
                        {g.name?.split(' @ ')[0]}
                      </button>
                      {isSelf && <span className="rounded-full bg-blue-100 px-1.5 py-px text-[10px] font-medium text-blue-700">this asset</span>}
                      {g.is_host_os && <span className="rounded-full bg-slate-100 px-1.5 py-px text-[10px] font-medium text-slate-600">host OS</span>}
                      <CritBadge
                        criticality={g.criticality}
                        weight={ac?.weight}
                        name={g.name ?? ''}
                        osNorm={g.os_normalized}
                      />
                    </div>
                    {g.os_normalized && (
                      <code className="mt-0.5 block font-mono text-[10px] text-gray-400">{g.os_normalized}</code>
                    )}
                  </div>

                  {/* Benchmark name — clickable → asset compliance page */}
                  <div className="shrink-0 w-44 text-right">
                    {g.benchmark_available ? (
                      <div>
                        <button
                          onClick={() => navigate(`/assets/${g.id}?tab=compliance`)}
                          className="block w-full truncate text-right text-[11px] font-medium text-emerald-700 hover:text-emerald-900 hover:underline"
                          title={g.benchmark_name ?? 'CIS benchmark'}
                        >
                          {g.benchmark_name ?? 'CIS benchmark'}
                        </button>
                        <span className="text-[10px] text-gray-400">{g.rule_count} rules</span>
                      </div>
                    ) : (
                      <span className="text-[10px] text-gray-300">no benchmark</span>
                    )}
                  </div>

                  {/* Score */}
                  <div className="shrink-0 w-24 text-right">
                    {g.score != null ? (
                      <>
                        <div className="mb-0.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                          <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${g.score}%` }} />
                        </div>
                        <div className="flex items-center justify-end gap-1">
                          <span className={`text-xs font-bold tabular-nums ${tone.text}`}>{Math.round(g.score)}%</span>
                          {peerAlreadyScanned && peerIsSelected && (
                            <span
                              className="inline-flex items-center gap-0.5 rounded-full bg-teal-50 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-teal-700 ring-1 ring-teal-200"
                              title="This peer already has scan results. Running Scan now will create a fresh run set; the existing history stays in the timeline."
                            >
                              <RotateCcw className="h-2.5 w-2.5" /> Rescan
                            </span>
                          )}
                        </div>
                      </>
                    ) : g.benchmark_available ? (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 ring-1 ring-amber-200">
                        <AlertTriangle className="h-2.5 w-2.5" /> Not scanned
                      </span>
                    ) : null}
                  </div>

                  {/* Actions */}
                  <div className="shrink-0 flex items-center gap-1.5">
                    {g.benchmark_available && (
                      g.score != null ? (
                        <>
                          <button
                            onClick={() => navigate(`/assets/${g.id}`)}
                            className="flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-100"
                          >
                            <Zap className="h-3 w-3" /> View
                          </button>
                          {isNativeOsPlatform(g.os_normalized) && (
                            <ScanNowButton targetAssetId={g.id} groupHostAssetId={assetId} />
                          )}
                        </>
                      ) : connectHref ? (
                        <>
                          <button
                            onClick={() => navigate(connectHref)}
                            className="flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-100"
                          >
                            <Zap className="h-3 w-3" /> Set up scan
                          </button>
                          {!_OS_PLATFORMS.has(wizPlatform!) && (
                            <AgentlessNote name={g.name ?? ''} osNorm={g.os_normalized} />
                          )}
                        </>
                      ) : null
                    )}
                    <button onClick={() => navigate(`/assets/${g.id}`)}
                      className="rounded-lg border border-gray-100 p-1 text-gray-300 hover:text-gray-500 transition">
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
              });
            })()}
          </ul>

          {/* No-IP fallback notice */}
          {!ip && (
            <p className="mt-2 flex items-center gap-1 text-[11px] text-gray-400">
              <Info className="h-3 w-3" />
              Assign an IP address to this asset to see co-located assets automatically.
            </p>
          )}
        </div>

        {/* ── Scoring note ─────────────────────────────────────────────── */}
        {hasMultiple && (
          <p className="flex items-start gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-400">
            <Info className="mt-px h-3 w-3 shrink-0" />
            Every asset in this group has its own individual compliance score.
            The <span className="mx-0.5 font-medium text-slate-500">Effective</span> score above is a blended view only — it updates automatically whenever any asset in the group is scanned.
          </p>
        )}


      </div>
    </section>
  );
}
