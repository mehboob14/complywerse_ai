'use client';
// Before the rules run: exactly which rules this review will run, by category, and what each
// one tests — the connected estate directly, or the people in the sample.

import { clsx } from 'clsx';
import type { PickerRule } from '../../_components/RulePicker';
import { byCategory } from '../../_components/RuleResults';
import { Badge, Button, Card, FOCUS, SeverityTag, Spinner } from '../../_components/ui';

export function PlannedRules({ rules, loading, label, onChange }: {
  rules: PickerRule[]; loading: boolean; label: string; onChange: () => void;
}) {
  const estate = rules.filter((r) => r.kind === 'connector').length;
  return (
    <Card title="Rules this review will run" as="h2"
      description={loading ? undefined : `${rules.length} rule${rules.length === 1 ? '' : 's'}${estate ? `: ${estate} test the connected source directly and ${rules.length - estate} test the people in the sample` : ''}. Rule set: ${label}.`}
      actions={<Button size="sm" onClick={onChange}>Change rules</Button>}>
      {loading ? <Spinner label="Loading the rules" /> : !rules.length ? (
        <p role="status" className="text-sm font-medium text-amber-900">No rule can run with this selection. Change the rules before you continue.</p>
      ) : (
        <div role="region" aria-label="Planned rules, by category" tabIndex={0} className={clsx('relative max-h-[420px] overflow-y-auto rounded-lg', FOCUS)}>
          <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
            {byCategory(rules).map(([domain, list]) => (
              <section key={domain} aria-label={domain}>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-700">{domain} <span className="font-normal normal-case">({list.length})</span></h3>
                <ul className="divide-y divide-slate-100">
                  {list.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-sm">
                      <span className="font-mono text-xs text-slate-600">{r.id}</span>
                      <span className="min-w-0 flex-1 text-slate-900">{r.name}</span>
                      {r.kind === 'connector' && <Badge tone="sky">{r.connector_label || 'Source'}</Badge>}
                      <SeverityTag severity={r.severity} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
