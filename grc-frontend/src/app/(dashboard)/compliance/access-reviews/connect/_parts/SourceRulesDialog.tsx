'use client';
// The rules behind a source's "N rules" badge, readable whether or not the source is connected: what each
// must hold, what it reads, when it fails, how to put it right and the frameworks it relates to. Reading
// them runs nothing; running them is on a connected source's Details, or in a review of it.

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';
import { errorText, useRuleCatalog } from '../../api';
import type { CatalogRule } from '../../types';
import { Dialog } from '../../_components/Dialog';
import { FrameworkChips, byCategory } from '../../_components/RuleResults';
import { Alert, Button, ButtonLink, FOCUS, SeverityTag, Spinner } from '../../_components/ui';
import { plural } from './catalog';

function RuleDetails({ r }: { r: CatalogRule }) {
  const [open, setOpen] = useState(false);
  const id = `source-rule-${r.id}`;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="px-4 py-3">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}
        className={clsx('flex w-full items-start gap-2 rounded text-left', FOCUS)}>
        <Chevron size={16} className="mt-0.5 shrink-0 text-slate-700" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900">{r.name}</span>
          {r.trips && <span className="mt-0.5 block text-xs text-slate-600">Fails when there is {r.trips}.</span>}
        </span>
        <span className="mt-0.5 font-mono text-xs text-slate-600">{r.id}</span>
        <SeverityTag severity={r.severity} />
      </button>
      {open && (
        <div id={id} className="mt-3 grid gap-3 pl-6 text-sm text-slate-800 md:grid-cols-2">
          <section aria-label="What it reads">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700">What it reads</h4>
            <p className="mt-1">{r.reads || '—'}</p>
          </section>
          <section aria-label="When it fails">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700">When it fails</h4>
            <p className="mt-1">{r.trips ? `There is ${r.trips}.` : '—'}</p>
          </section>
          {r.fix && (
            <section aria-label="How to put it right" className="md:col-span-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700">How to put it right</h4>
              <p className="mt-1">{r.fix}</p>
            </section>
          )}
          <section aria-label="Frameworks" className="md:col-span-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700">Frameworks and clauses it relates to</h4>
            <div className="mt-1"><FrameworkChips refs={r.frameworks} total={r.frameworks_total} max={6} /></div>
            {!!r.scf?.length && <p className="mt-1 text-xs text-slate-600">Secure Controls Framework: {r.scf.join(', ')}</p>}
          </section>
        </div>
      )}
    </div>
  );
}

export function SourceRulesDialog({ source, label, connected, limits, onClose, onConnect }: {
  source: string; label: string; connected: boolean; limits?: string; onClose: () => void;
  /** offered while the source is not connected */
  onConnect?: () => void;
}) {
  const catalog = useRuleCatalog(undefined, source);
  const rules = useMemo(() => (catalog.data?.domains ?? []).flatMap((d) =>
    d.rules.filter((r) => r.kind === 'connector' && r.connector === source).map((r) => ({ ...r, domain: d.domain }))), [catalog.data, source]);

  return (
    <Dialog open onClose={onClose} side width="max-w-3xl" title={`Rules for ${label}`}
      description={catalog.isSuccess ? `${plural(rules.length, 'rule')} that test ${label}'s own configuration. Each states what must be true: it passes when that holds and fails when it does not.` : undefined}
      footer={(
        <>
          <Button onClick={onClose}>Close</Button>
          <ButtonLink href={`/compliance/access-reviews/rules?source=${encodeURIComponent(source)}`}>Open in the Rule library</ButtonLink>
          {onConnect && <Button variant="primary" onClick={onConnect}>Connect {label}</Button>}
        </>
      )}>
      <div className="space-y-5">
        {!connected && (
          <Alert tone="warning" title={`${label} is not connected`}>
            None of these rules has run. Connect it with a read-only token, then run them from its Details or in a review.
          </Alert>
        )}
        {limits && <Alert tone="info" title="What these rules cannot see">{limits}</Alert>}
        {catalog.isLoading ? <Spinner label="Loading the rules" />
          : catalog.isError ? <Alert tone="error">{errorText(catalog.error, 'The rules could not be loaded.')}</Alert>
            : !rules.length ? <p className="text-sm text-slate-700">{label} has no rules of its own yet.</p>
              : byCategory(rules).map(([domain, list]) => (
                <section key={domain} aria-label={domain}>
                  <h3 className="mb-2 text-sm font-semibold text-slate-900">{domain} <span className="font-normal text-slate-600">({list.length})</span></h3>
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                    {list.map((r) => <li key={r.id}><RuleDetails r={r} /></li>)}
                  </ul>
                </section>
              ))}
      </div>
    </Dialog>
  );
}
