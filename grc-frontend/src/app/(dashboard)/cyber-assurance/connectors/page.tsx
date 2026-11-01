'use client';

// Integration catalogue — the 40 providers ComplyVerse can collect compliance evidence
// from. Display-only: nothing is connected until the Phase 2 sync backend lands,
// so every card reads "Not connected" and shows its collection scope, never a
// fabricated sync time (see connector-catalogue.ts). Deep-linked with
// ?category=<CONNECTOR_CATEGORY> from elsewhere (e.g. the control library).

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  CONNECTORS,
  CONNECTOR_CATEGORIES,
  type ConnectorCategory,
} from '@/cyber-assurance/components/integrations/connector-catalogue';
import { ConnectorLogo } from '@/cyber-assurance/components/integrations/ConnectorLogo';

function Catalogue() {
  const params = useSearchParams();
  const initial = params.get('category');
  const [active, setActive] = useState<ConnectorCategory | 'All'>(
    CONNECTOR_CATEGORIES.includes(initial as ConnectorCategory)
      ? (initial as ConnectorCategory)
      : 'All',
  );

  const shown = useMemo(
    () => (active === 'All' ? CONNECTORS : CONNECTORS.filter((c) => c.categories.includes(active))),
    [active],
  );

  const tabs = ['All', ...CONNECTOR_CATEGORIES] as const;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold text-slate-900">Integration catalogue</h2>
        <p className="text-sm text-slate-500 mt-1">
          {CONNECTORS.length} providers ComplyVerse can collect compliance evidence from. Connection and
          automated evidence sync arrive with the Phase&nbsp;2 collector — every provider shows as
          <span className="font-medium"> Not connected</span> until then.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setActive(t as ConnectorCategory | 'All')}
            className={
              'rounded-full px-3 py-1 text-xs font-medium border transition ' +
              (active === t
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300')
            }
          >
            {t}
            {t !== 'All' && (
              <span className="ml-1.5 text-[10px] opacity-60">
                {CONNECTORS.filter((c) => c.categories.includes(t as ConnectorCategory)).length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((c) => (
          <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start gap-3">
              <ConnectorLogo provider={c.id} label={c.name} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-slate-900 text-sm truncate">{c.name}</h3>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                    Not connected
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {c.categories.map((cat) => (
                    <span key={cat} className="text-[10px] text-slate-400">
                      {cat}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3">
              {c.syncs.map((s, i) => (
                <li key={i} className="flex gap-1.5 text-[11px] leading-snug text-slate-500">
                  <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-slate-300" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ConnectorsCataloguePage() {
  return (
    <Suspense fallback={<div className="text-sm text-slate-500">Loading catalogue…</div>}>
      <Catalogue />
    </Suspense>
  );
}
