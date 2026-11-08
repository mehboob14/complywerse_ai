'use client';

// AI governance > Overview: the protection statement, the headline figures, where the tokens go (read from the ledger, nothing estimated), the most used features and
// modules, and what was refused lately. The kit's tiles, cards and registers; the figures and their meaning are the server's and unchanged.
import { ShieldCheck } from 'lucide-react';
import { EmptyState, Notice, RegisterTable, SectionCard, StatTile, type RegisterColumn } from '@/components/ui/ds';
import { REASONS, fmtNumber, fmtTokens, fmtUsd, fmtWhen } from './format';
import type { Overview, Stats } from './types';

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–');

type Feature = Overview['use_cases'][number];
type Mod = Overview['modules'][number];

function Drivers({ t, features }: { t: Stats; features: Feature[] }) {
  if (t.calls === 0) return null;
  const fresh = Math.max(0, t.input_tokens - t.cached_tokens);
  const columns: RegisterColumn<Feature>[] = [
    { key: 'feature', header: 'Feature', isRowHeader: true, cell: (f) => f.label },
    { key: 'calls', header: 'Calls', align: 'right', card: 'meta', cell: (f) => fmtNumber(f.calls) },
    { key: 'in', header: 'Sent per call', align: 'right', priority: 2, card: 'meta', cell: (f) => fmtTokens(Math.round(f.input_tokens / Math.max(1, f.calls))) },
    { key: 'out', header: 'Returned per call', align: 'right', priority: 2, card: 'meta', cell: (f) => fmtTokens(Math.round(f.output_tokens / Math.max(1, f.calls))) },
    { key: 'reasoning', header: 'Hidden reasoning', align: 'right', priority: 3, cell: (f) => pct(f.reasoning_tokens, f.output_tokens) },
    { key: 'provider', header: 'Read from the provider cache', align: 'right', priority: 3, cell: (f) => pct(f.cached_tokens, f.input_tokens) },
    { key: 'ours', header: 'Answered from our cache', align: 'right', priority: 3, cell: (f) => fmtNumber(f.cache_hits) },
    { key: 'again', header: 'Asked again unchanged', align: 'right', priority: 3, cell: (f) => fmtNumber(f.repeat_calls) },
  ];
  return (
    <SectionCard id="drivers" title="Where the tokens go" info="Read from the record of every call. Nothing here is estimated.">
      <ul className="m-0 mb-[12px] grid list-none gap-x-[24px] gap-y-[4px] p-0 text-ds-body text-ds-fg-body sm:grid-cols-2">
        <li><b className="font-[600] text-ds-fg">{pct(t.input_tokens, t.tokens)}</b> of tokens are what is sent ({fmtTokens(t.input_tokens)}); {pct(t.output_tokens, t.tokens)} is what comes back ({fmtTokens(t.output_tokens)}).</li>
        <li>Hidden reasoning is <b className="font-[600] text-ds-fg">{pct(t.reasoning_tokens, t.output_tokens)}</b> of the output ({fmtTokens(t.reasoning_tokens)}).</li>
        <li><b className="font-[600] text-ds-fg">{pct(t.cached_tokens, t.input_tokens)}</b> of the input was read from the provider&apos;s saved prompts at a reduced rate ({fmtTokens(fresh)} was full price).</li>
        <li>Answered from our own saved results: <b className="font-[600] text-ds-fg">{fmtNumber(t.cache_hits)}</b> calls, saving {fmtTokens(t.saved_tokens)} tokens.</li>
        <li>
          Asked again exactly as before and not saved: <b className="font-[600] text-ds-fg">{fmtNumber(t.repeat_calls)}</b> calls ({fmtTokens(t.repeat_tokens)} tokens)
          {t.with_hash < t.calls ? <span> · measured on {fmtNumber(t.with_hash)} of {fmtNumber(t.calls)} calls so far</span> : null}.
        </li>
        <li>Retried calls: <b className="font-[600] text-ds-fg">{fmtNumber(t.retries)}</b>.</li>
      </ul>
      <RegisterTable caption="Token use per feature" columns={columns} rows={features} getRowId={(f) => f.id} cardTitle={(f) => f.label} />
    </SectionCard>
  );
}

export default function OverviewTab({ data, days, onOpenUseCase }: { data: Overview; days: number; onOpenUseCase: (id: string) => void }) {
  const t = data.totals;
  const features: RegisterColumn<Feature>[] = [
    {
      key: 'feature', header: 'Feature', isRowHeader: true,
      cell: (u) => (u.id === 'unclassified' ? <span className="text-ds-fg-muted">{u.label}</span> : (
        <button type="button" onClick={() => onOpenUseCase(u.id)} className="min-h-ds-control-sm text-left font-[600] text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{u.label}</button>
      )),
    },
    { key: 'calls', header: 'Calls', align: 'right', card: 'meta', cell: (u) => fmtNumber(u.calls) },
    { key: 'protected', header: 'Protected', align: 'right', priority: 2, card: 'meta', cell: (u) => fmtNumber(u.protected) },
    { key: 'tokens', header: 'Tokens', align: 'right', card: 'meta', cell: (u) => fmtTokens(u.tokens) },
  ];
  const modules: RegisterColumn<Mod>[] = [
    { key: 'module', header: 'Module', isRowHeader: true, cell: (m) => m.label },
    { key: 'calls', header: 'Calls', align: 'right', card: 'meta', cell: (m) => fmtNumber(m.calls) },
    { key: 'blocked', header: 'Blocked', align: 'right', priority: 2, card: 'meta', cell: (m) => fmtNumber(m.blocked) },
    { key: 'tokens', header: 'Tokens', align: 'right', card: 'meta', cell: (m) => fmtTokens(m.tokens) },
  ];
  return (
    <div className="flex flex-col gap-[16px]">
      <Notice tone="info" title="AI requests are checked on this server before they leave" icon={ShieldCheck}>
        Secrets, card numbers, bank accounts and national ids are removed. Names, organisations, hosts, addresses, e-mails and phone numbers are replaced by placeholders and put back in
        the answer you read. Pictures and scanned pages are not sent, and raw records are never sent. This is always on and cannot be switched off here. A few paths are not covered yet;
        they are marked “Not yet checked” under Features.
      </Notice>

      <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-5">
        <StatTile label="AI calls" value={fmtNumber(t.calls)} note={`last ${days} days`} />
        <StatTile label="Protected calls" value={fmtNumber(t.protected)} note={`${fmtNumber(t.entities)} items replaced or removed`} tone="success" />
        <StatTile label="Blocked" value={fmtNumber(t.blocked)} note="refused before sending" tone={t.blocked ? 'danger' : 'default'} />
        <StatTile label="Failed" value={fmtNumber(t.failed)} note="the AI did not answer" tone={t.failed ? 'warning' : 'default'} />
        <StatTile label="Estimated cost" value={t.cost_configured ? fmtUsd(t.cost_usd) : null} info={t.cost_configured ? undefined : 'No price is set for the AI yet, so no cost is shown. Token counts are exact.'} note={`${fmtTokens(t.tokens)} tokens`} />
      </div>
      {data.truncated && <Notice tone="warning" title="Only the most recent 5,000 calls of this period are summarised here." />}

      <Drivers t={t} features={data.use_cases} />

      <div className="grid gap-[16px] lg:grid-cols-2">
        <SectionCard id="features" title="Most used features">
          <RegisterTable
            caption="Most used features" columns={features} rows={data.use_cases} getRowId={(u) => u.id} cardTitle={(u) => u.label}
            empty={<EmptyState bare kind="firstUse" title="No AI calls in this period" />}
          />
        </SectionCard>
        <SectionCard id="modules" title="By module">
          <RegisterTable
            caption="AI calls by module" columns={modules} rows={data.modules} getRowId={(m) => m.module} cardTitle={(m) => m.label}
            empty={<EmptyState bare kind="firstUse" title="Nothing yet" />}
          />
        </SectionCard>
      </div>

      <SectionCard id="refused" title="Recently refused">
        {data.recent_blocked.length === 0 ? (
          <p className="m-0 text-ds-body text-ds-fg-muted">Nothing was refused in this period.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {data.recent_blocked.map((b) => (
              <li key={b.id} className="border-t border-ds-border py-[8px] first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-[12px] gap-y-[2px]">
                  <span className="text-ds-body font-[600] text-ds-fg">{b.use_case}</span>
                  <span className="text-ds-label text-ds-fg-muted">{fmtWhen(b.at)}</span>
                </div>
                <p className="m-0 text-ds-body text-ds-fg-body">{(b.reason && REASONS[b.reason]) || 'The request was refused before it was sent.'}</p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
