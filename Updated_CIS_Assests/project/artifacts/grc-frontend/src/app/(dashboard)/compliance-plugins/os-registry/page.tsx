'use client';

export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { compliancePluginsApi } from '@/lib/api';
import { Server, ShieldAlert, Loader2 } from 'lucide-react';

// OS Knowledge Registry
// ------------------------------------------------------------------
// Canonical list of every OS family / product / build the system knows
// about — Windows 10 22H2, Windows 10 21H2, Win 11 23H2, Cisco IOS XE
// 17.9, Oracle DB 19c, etc. Each row shows:
//   - normalized_key (what asset.os_normalized must equal)
//   - parent_key (rolls up to the family)
//   - support window (EOL year)
//   - plugin_count (rules tagged for this exact key)
//   - asset_count (live assets at this OS)
// This is the "ground truth" Hassan asked for: every Windows version,
// every Cisco minor, every Linux LTS — listed, supported, mapped to rules.

type RegistryItem = {
  id: number;
  family: string;
  product: string;
  build: string | null;
  normalized_key: string;
  parent_key: string | null;
  display_name: string;
  release_year: number | null;
  eol_year: number | null;
  is_supported: boolean;
  benchmark_hint: string | null;
  plugin_count: number;
  asset_count: number;
};

export default function OsRegistryPage() {
  const [familyFilter, setFamilyFilter] = useState<string>('all');
  const [showEol, setShowEol] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['compliance-plugins', 'os-registry'],
    queryFn: () => compliancePluginsApi.osRegistry().then((r: any) => r.data),
  });

  const items: RegistryItem[] = data?.items || [];

  const families = useMemo(() => {
    const set = new Set<string>();
    items.forEach(i => set.add(i.family));
    return Array.from(set).sort();
  }, [items]);

  const filtered = items
    .filter(i => familyFilter === 'all' || i.family === familyFilter)
    .filter(i => showEol || i.is_supported);

  // Group by parent so the tree is readable (parent rows first, builds nested)
  const grouped = useMemo(() => {
    const parents = filtered.filter(i => !i.parent_key);
    const childrenByParent: Record<string, RegistryItem[]> = {};
    filtered.filter(i => i.parent_key).forEach(c => {
      (childrenByParent[c.parent_key!] ||= []).push(c);
    });
    return parents.map(p => ({ parent: p, children: childrenByParent[p.normalized_key] || [] }));
  }, [filtered]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-gray-900">
          <Server className="h-6 w-6 text-blue-600" />
          OS Knowledge Registry
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">
          Every OS family, product, and build Compliverse recognises — Windows desktop, Windows Server, Linux distros, Cisco IOS XE minors, Oracle DB editions, AWS / Azure / GCP. Each row maps to a normalised key that asset feeds use and that plugins tag against. Rule counts and asset counts are live.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-700">Family</span>
          <select
            value={familyFilter}
            onChange={(e) => setFamilyFilter(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
          >
            <option value="all">All families</option>
            {families.map(f => (<option key={f} value={f}>{f}</option>))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={showEol} onChange={e => setShowEol(e.target.checked)} />
          Show end-of-life
        </label>
        <div className="ml-auto text-xs text-slate-500">
          {filtered.length} entries
        </div>
      </div>

      {/* Loading / error */}
      {isLoading && (
        <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading OS registry…
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Couldn't load the registry. Backend reachable?
        </div>
      )}

      {/* Grouped table */}
      {!isLoading && !error && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Display name</th>
                <th className="px-3 py-2 text-left font-medium">Normalized key</th>
                <th className="px-3 py-2 text-left font-medium">Family</th>
                <th className="px-3 py-2 text-left font-medium">Build</th>
                <th className="px-3 py-2 text-left font-medium">Support</th>
                <th className="px-3 py-2 text-right font-medium">Plugins</th>
                <th className="px-3 py-2 text-right font-medium">Assets</th>
                <th className="px-3 py-2 text-left font-medium">Benchmark hint</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(({ parent, children }) => (
                <ParentBlock key={parent.id} parent={parent} children={children} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ParentBlock({ parent, children }: { parent: RegistryItem; children: RegistryItem[] }) {
  return (
    <>
      <RegistryRow item={parent} indent={0} />
      {children.map(c => <RegistryRow key={c.id} item={c} indent={1} />)}
    </>
  );
}

function RegistryRow({ item, indent }: { item: RegistryItem; indent: number }) {
  return (
    <tr className={`border-t border-slate-100 ${indent ? 'bg-slate-50/40' : ''} hover:bg-slate-50`}>
      <td className="px-3 py-2 text-slate-900" style={{ paddingLeft: 12 + indent * 18 }}>
        {indent === 1 && <span className="mr-1 text-slate-300">└</span>}
        <span className="font-medium">{item.display_name}</span>
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-slate-700">{item.normalized_key}</td>
      <td className="px-3 py-2 text-slate-700 capitalize">{item.family}</td>
      <td className="px-3 py-2 text-slate-700">{item.build || <span className="text-slate-400">-</span>}</td>
      <td className="px-3 py-2">
        {item.is_supported ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
            Supported{item.eol_year ? ` · EOL ${item.eol_year}` : ''}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700">
            <ShieldAlert className="h-3 w-3" />EOL{item.eol_year ? ` ${item.eol_year}` : ''}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right font-mono text-slate-800">{item.plugin_count.toLocaleString()}</td>
      <td className="px-3 py-2 text-right font-mono text-slate-800">{item.asset_count.toLocaleString()}</td>
      <td className="px-3 py-2 truncate text-[11px] text-slate-500" title={item.benchmark_hint || undefined}>
        {item.benchmark_hint || <span className="text-slate-400">-</span>}
      </td>
    </tr>
  );
}
