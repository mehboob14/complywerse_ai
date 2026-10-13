'use client';

import { Activity, Ban, Coins, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { Stats } from './types';
import { StatCard } from '@/components/ui';
import { REASONS, fmtNumber, fmtTokens, fmtUsd, fmtWhen } from './format';
import type { Overview } from './types';


const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) + '%' : '–');

/** Where the tokens go: the figures that say which cost levers apply, read from the ledger (nothing is estimated). */
function Drivers({ t, features }: { t: Stats; features: Array<Stats & { id: string; label: string }> }) {
  if (t.calls === 0) return null;
  const fresh = Math.max(0, t.input_tokens - t.cached_tokens);
  return (
    <section aria-label="Where the tokens go">
      <h3 className="mb-2 text-sm font-semibold text-slate-900">Where the tokens go</h3>
      <ul className="mb-3 grid gap-x-8 gap-y-1 text-sm text-slate-700 sm:grid-cols-2">
        <li><span className="font-medium text-slate-900">{pct(t.input_tokens, t.tokens)}</span> of tokens are what is sent ({fmtTokens(t.input_tokens)}); {pct(t.output_tokens, t.tokens)} is what comes back ({fmtTokens(t.output_tokens)}).</li>
        <li>Hidden reasoning is <span className="font-medium text-slate-900">{pct(t.reasoning_tokens, t.output_tokens)}</span> of the output ({fmtTokens(t.reasoning_tokens)}).</li>
        <li><span className="font-medium text-slate-900">{pct(t.cached_tokens, t.input_tokens)}</span> of the input was read from the provider&apos;s prompt cache at a reduced rate ({fmtTokens(fresh)} was full price).</li>
        <li>Answered from our own cache: <span className="font-medium text-slate-900">{fmtNumber(t.cache_hits)}</span> calls, saving {fmtTokens(t.saved_tokens)} tokens.</li>
        <li>
          Asked again exactly as before and not cached: <span className="font-medium text-slate-900">{fmtNumber(t.repeat_calls)}</span> calls ({fmtTokens(t.repeat_tokens)} tokens)
          {t.with_hash < t.calls ? <span className="text-slate-700"> · measured on {fmtNumber(t.with_hash)} of {fmtNumber(t.calls)} calls so far</span> : null}.
        </li>
        <li>Retried calls: <span className="font-medium text-slate-900">{fmtNumber(t.retries)}</span>.</li>
      </ul>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-700">
              <th className="px-3 py-2 font-medium">Feature</th>
              <th className="px-3 py-2 text-right font-medium">Calls</th>
              <th className="px-3 py-2 text-right font-medium">In per call</th>
              <th className="px-3 py-2 text-right font-medium">Out per call</th>
              <th className="px-3 py-2 text-right font-medium">Reasoning</th>
              <th className="px-3 py-2 text-right font-medium">Provider cache</th>
              <th className="px-3 py-2 text-right font-medium">Our cache</th>
              <th className="px-3 py-2 text-right font-medium">Repeated</th>
            </tr>
          </thead>
          <tbody>
            {features.map((f) => (
              <tr key={f.id} className="border-b border-slate-100 last:border-0">
                <td className="px-3 py-2">{f.label}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(f.calls)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtTokens(Math.round(f.input_tokens / Math.max(1, f.calls)))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtTokens(Math.round(f.output_tokens / Math.max(1, f.calls)))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{pct(f.reasoning_tokens, f.output_tokens)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{pct(f.cached_tokens, f.input_tokens)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(f.cache_hits)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(f.repeat_calls)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

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

      <Drivers t={t} features={data.use_cases} />

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
