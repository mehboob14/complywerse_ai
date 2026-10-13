'use client';

import { Activity, Ban, Coins, ShieldCheck, TriangleAlert } from 'lucide-react';
import { StatCard } from '@/components/ui';
import { REASONS, fmtNumber, fmtTokens, fmtUsd, fmtWhen } from './format';
import type { Overview } from './types';

export default function OverviewTab({ data, days, onOpenUseCase }: { data: Overview; days: number; onOpenUseCase: (id: string) => void }) {
  const t = data.totals;
  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-primary-200 bg-primary-50 p-4" aria-label="How your data is protected">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 shrink-0 text-primary-700" size={20} aria-hidden />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">AI requests are checked on this server before they leave</h2>
            <p className="mt-1 text-sm text-slate-700">
              Secrets, card numbers, bank accounts and national ids are removed. Names, organisations, hosts, addresses, e-mails and phone
              numbers are replaced by placeholders, and put back in the answer you read. Pictures and scanned pages are not sent, and
              raw records are never sent. This is always on and cannot be switched off here. A few paths are not covered yet; they are
              marked “Not yet checked” under Features.
            </p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard title="AI calls" value={fmtNumber(t.calls)} subtitle={`last ${days} days`} icon={Activity} />
        <StatCard title="Protected calls" value={fmtNumber(t.protected)} subtitle={`${fmtNumber(t.entities)} items replaced or removed`} icon={ShieldCheck} variant="success" />
        <StatCard title="Blocked" value={fmtNumber(t.blocked)} subtitle="refused before sending" icon={Ban} variant={t.blocked ? 'danger' : 'default'} />
        <StatCard title="Failed" value={fmtNumber(t.failed)} subtitle="the AI did not answer" icon={TriangleAlert} variant={t.failed ? 'warning' : 'default'} />
        <StatCard title="Estimated cost" value={t.cost_configured ? fmtUsd(t.cost_usd) : 'Price not set'} subtitle={`${fmtTokens(t.tokens)} tokens`} icon={Coins} />
      </div>
      {!t.cost_configured && t.calls > 0 && (
        <p className="text-sm text-slate-700">
          Costs show once the price of each model is configured on the server (<code className="text-xs">AI_USAGE_PRICE_CATALOG_JSON</code>). Token counts are exact.
        </p>
      )}
      {data.truncated && <p className="text-sm text-amber-900">Only the most recent 5,000 calls of this period are summarised here.</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Most used features</h3>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-700">
                  <th className="px-3 py-2 font-medium">Feature</th>
                  <th className="px-3 py-2 text-right font-medium">Calls</th>
                  <th className="px-3 py-2 text-right font-medium">Protected</th>
                  <th className="px-3 py-2 text-right font-medium">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {data.use_cases.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-700">No AI calls in this period.</td></tr>
                )}
                {data.use_cases.map((u) => (
                  <tr key={u.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2">
                      {u.id === 'unclassified' ? (
                        <span className="text-slate-700">{u.label}</span>
                      ) : (
                        <button type="button" onClick={() => onOpenUseCase(u.id)} className="text-left font-medium text-primary-700 hover:underline">
                          {u.label}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(u.calls)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(u.protected)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtTokens(u.tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">By module</h3>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-700">
                  <th className="px-3 py-2 font-medium">Module</th>
                  <th className="px-3 py-2 text-right font-medium">Calls</th>
                  <th className="px-3 py-2 text-right font-medium">Blocked</th>
                  <th className="px-3 py-2 text-right font-medium">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {data.modules.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-700">Nothing yet.</td></tr>
                )}
                {data.modules.map((m) => (
                  <tr key={m.module} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2">{m.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(m.calls)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(m.blocked)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtTokens(m.tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Recently refused</h3>
        {data.recent_blocked.length === 0 ? (
          <p className="text-sm text-slate-700">Nothing was refused in this period.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {data.recent_blocked.map((b) => (
              <li key={b.id} className="px-3 py-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-slate-900">{b.use_case}</span>
                  <span className="text-xs text-slate-700">{fmtWhen(b.at)}{b.rule ? ` · rule ${b.rule}` : ''}</span>
                </div>
                <p className="text-slate-700">{(b.reason && REASONS[b.reason]) || 'The request was refused before it was sent.'}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
